package reporting

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/sesv2"
	sestypes "github.com/aws/aws-sdk-go-v2/service/sesv2/types"
	"github.com/aws/aws-sdk-go-v2/service/sns"
)

// Destination is the SES event destination Mails manages.
type Destination struct {
	Enabled  bool
	Types    []string
	TopicARN string
}

// AWS is what reporting asks of SES and SNS.
type AWS interface {
	// EnsureTopic creates the topic (or returns the existing one of that
	// name) and lets SES in this account publish to it.
	EnsureTopic(ctx context.Context, name string) (arn string, err error)
	EnsureConfigSet(ctx context.Context, name string) error
	// Destination returns nil, false when the configuration set does not
	// exist, and nil, true when it exists without our destination.
	Destination(ctx context.Context, configSet string) (*Destination, bool, error)
	PutDestination(ctx context.Context, configSet string, d Destination) error
	// Subscription is "confirmed", "pending" or "missing".
	Subscription(ctx context.Context, topicARN, endpoint string) (string, error)
	Subscribe(ctx context.Context, topicARN, endpoint string) error
}

const destinationName = "sns-events"

type awsClient struct {
	ses *sesv2.Client
	sns *sns.Client
}

// NewAWS builds the real client from an AWS config.
func NewAWS(cfg aws.Config) AWS {
	return &awsClient{ses: sesv2.NewFromConfig(cfg), sns: sns.NewFromConfig(cfg)}
}

func (a *awsClient) EnsureTopic(ctx context.Context, name string) (string, error) {
	out, err := a.sns.CreateTopic(ctx, &sns.CreateTopicInput{Name: &name})
	if err != nil {
		return "", fmt.Errorf("create sns topic: %w", err)
	}
	arn := aws.ToString(out.TopicArn)
	parts := strings.Split(arn, ":")
	if len(parts) < 6 {
		return "", fmt.Errorf("unexpected topic arn %q", arn)
	}
	attrs, err := a.sns.GetTopicAttributes(ctx, &sns.GetTopicAttributesInput{TopicArn: &arn})
	if err != nil {
		return "", fmt.Errorf("read topic policy: %w", err)
	}
	var policy struct {
		Version   string           `json:"Version"`
		ID        string           `json:"Id,omitempty"`
		Statement []map[string]any `json:"Statement"`
	}
	policy.Version = "2012-10-17"
	if raw := attrs.Attributes["Policy"]; raw != "" {
		if err := json.Unmarshal([]byte(raw), &policy); err != nil {
			return "", fmt.Errorf("parse topic policy: %w", err)
		}
	}
	for _, st := range policy.Statement {
		if st["Sid"] == "AllowSESPublish" {
			return arn, nil
		}
	}
	// Only SES in this same account may publish, never another account's.
	policy.Statement = append(policy.Statement, map[string]any{
		"Sid": "AllowSESPublish", "Effect": "Allow",
		"Principal": map[string]any{"Service": "ses.amazonaws.com"},
		"Action":    "sns:Publish", "Resource": arn,
		"Condition": map[string]any{"StringEquals": map[string]any{"AWS:SourceAccount": parts[4]}},
	})
	b, _ := json.Marshal(policy)
	if _, err := a.sns.SetTopicAttributes(ctx, &sns.SetTopicAttributesInput{
		TopicArn: &arn, AttributeName: aws.String("Policy"), AttributeValue: aws.String(string(b)),
	}); err != nil {
		return "", fmt.Errorf("allow SES to publish: %w", err)
	}
	return arn, nil
}

func (a *awsClient) EnsureConfigSet(ctx context.Context, name string) error {
	_, err := a.ses.CreateConfigurationSet(ctx, &sesv2.CreateConfigurationSetInput{ConfigurationSetName: &name})
	var exists *sestypes.AlreadyExistsException
	if err != nil && !errors.As(err, &exists) {
		return fmt.Errorf("create configuration set: %w", err)
	}
	return nil
}

func (a *awsClient) Destination(ctx context.Context, configSet string) (*Destination, bool, error) {
	out, err := a.ses.GetConfigurationSetEventDestinations(ctx, &sesv2.GetConfigurationSetEventDestinationsInput{ConfigurationSetName: &configSet})
	var nf *sestypes.NotFoundException
	if errors.As(err, &nf) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, fmt.Errorf("read event destinations: %w", err)
	}
	for _, d := range out.EventDestinations {
		if aws.ToString(d.Name) != destinationName {
			continue
		}
		dest := &Destination{Enabled: d.Enabled}
		for _, t := range d.MatchingEventTypes {
			dest.Types = append(dest.Types, string(t))
		}
		if d.SnsDestination != nil {
			dest.TopicARN = aws.ToString(d.SnsDestination.TopicArn)
		}
		return dest, true, nil
	}
	return nil, true, nil
}

func (a *awsClient) PutDestination(ctx context.Context, configSet string, d Destination) error {
	types := make([]sestypes.EventType, len(d.Types))
	for i, t := range d.Types {
		types[i] = sestypes.EventType(t)
	}
	def := &sestypes.EventDestinationDefinition{
		Enabled: d.Enabled, MatchingEventTypes: types,
		SnsDestination: &sestypes.SnsDestination{TopicArn: &d.TopicARN},
	}
	name := destinationName
	existing, _, err := a.Destination(ctx, configSet)
	if err != nil {
		return err
	}
	if existing != nil {
		_, err = a.ses.UpdateConfigurationSetEventDestination(ctx, &sesv2.UpdateConfigurationSetEventDestinationInput{
			ConfigurationSetName: &configSet, EventDestinationName: &name, EventDestination: def})
	} else {
		_, err = a.ses.CreateConfigurationSetEventDestination(ctx, &sesv2.CreateConfigurationSetEventDestinationInput{
			ConfigurationSetName: &configSet, EventDestinationName: &name, EventDestination: def})
	}
	if err != nil {
		return fmt.Errorf("save event destination: %w", err)
	}
	return nil
}

func (a *awsClient) Subscription(ctx context.Context, topicARN, endpoint string) (string, error) {
	p := sns.NewListSubscriptionsByTopicPaginator(a.sns, &sns.ListSubscriptionsByTopicInput{TopicArn: &topicARN})
	for p.HasMorePages() {
		page, err := p.NextPage(ctx)
		if err != nil {
			return "", fmt.Errorf("list subscriptions: %w", err)
		}
		for _, s := range page.Subscriptions {
			if aws.ToString(s.Endpoint) != endpoint {
				continue
			}
			arn := aws.ToString(s.SubscriptionArn)
			if !strings.HasPrefix(arn, "arn:") {
				return "pending", nil // "PendingConfirmation"
			}
			attrs, err := a.sns.GetSubscriptionAttributes(ctx, &sns.GetSubscriptionAttributesInput{SubscriptionArn: &arn})
			if err != nil {
				return "", fmt.Errorf("read subscription: %w", err)
			}
			if attrs.Attributes["PendingConfirmation"] == "true" {
				return "pending", nil
			}
			return "confirmed", nil
		}
	}
	return "missing", nil
}

func (a *awsClient) Subscribe(ctx context.Context, topicARN, endpoint string) error {
	_, err := a.sns.Subscribe(ctx, &sns.SubscribeInput{TopicArn: &topicARN, Protocol: aws.String("https"), Endpoint: &endpoint})
	if err != nil {
		return fmt.Errorf("subscribe %s: %w", endpoint, err)
	}
	return nil
}

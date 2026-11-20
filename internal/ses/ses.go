// Package ses is the small slice of Amazon SES v2 that Mails uses, behind an
// interface so tests run against sesfake instead of AWS.
package ses

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/sesv2"
	"github.com/aws/aws-sdk-go-v2/service/sesv2/types"
)

// Identity is what SES knows about one domain identity.
type Identity struct {
	Name               string
	Type               string // DOMAIN, EMAIL_ADDRESS, MANAGED_DOMAIN
	VerificationStatus string
	SendingEnabled     bool
	DKIMStatus         string
	DKIMOrigin         string // AWS_SES or EXTERNAL; empty when unknown
	DKIMTokens         []string
	MailFromDomain     string
	MailFromStatus     string
}

// Account is the sending quota and standing of the SES account.
type Account struct {
	ProductionAccess  bool    `json:"production_access"`
	EnforcementStatus string  `json:"enforcement_status"`
	Max24Hour         float64 `json:"max_24_hour"`
	SentLast24Hours   float64 `json:"sent_last_24_hours"`
	MaxSendRate       float64 `json:"max_send_rate"`
}

// RawEmail is a fully built MIME message and its envelope recipients.
type RawEmail struct {
	From             string
	To               []string
	Raw              []byte
	ConfigurationSet string
}

// Client is everything Mails asks of SES.
type Client interface {
	// GetIdentity returns nil, nil when SES has no such identity.
	GetIdentity(ctx context.Context, name string) (*Identity, error)
	ListIdentities(ctx context.Context) ([]Identity, error)
	CreateIdentity(ctx context.Context, name string) error
	DeleteIdentity(ctx context.Context, name string) error
	// PutExternalDKIM switches the identity to a key we generated (BYODKIM).
	// privateKey is base64 PKCS#8 DER.
	PutExternalDKIM(ctx context.Context, domain, selector, privateKey string) (status string, tokens []string, err error)
	SetMailFrom(ctx context.Context, domain, mailFrom string) error
	SendRaw(ctx context.Context, m RawEmail) (messageID string, err error)
	Account(ctx context.Context) (*Account, error)
}

// ErrNotConfigured is returned by every call when no AWS credentials are set.
var ErrNotConfigured = errors.New("SES is not configured: set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY")

type client struct{ api *sesv2.Client }

// Config loads the AWS config every AWS client in Mails shares. With empty
// keys it falls back to the default chain (instance role, shared config).
func Config(ctx context.Context, region, accessKey, secretKey string) (aws.Config, error) {
	opts := []func(*awsconfig.LoadOptions) error{awsconfig.WithRegion(region)}
	if accessKey != "" {
		opts = append(opts, awsconfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(accessKey, secretKey, "")))
	}
	cfg, err := awsconfig.LoadDefaultConfig(ctx, opts...)
	if err != nil {
		return aws.Config{}, fmt.Errorf("load aws config: %w", err)
	}
	return cfg, nil
}

// New builds a real SES client.
func New(cfg aws.Config) Client {
	return &client{api: sesv2.NewFromConfig(cfg)}
}

func (c *client) GetIdentity(ctx context.Context, name string) (*Identity, error) {
	out, err := c.api.GetEmailIdentity(ctx, &sesv2.GetEmailIdentityInput{EmailIdentity: &name})
	var nf *types.NotFoundException
	if errors.As(err, &nf) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("ses get identity %s: %w", name, err)
	}
	id := &Identity{
		Name:               name,
		Type:               string(out.IdentityType),
		VerificationStatus: string(out.VerificationStatus),
		SendingEnabled:     out.VerifiedForSendingStatus,
	}
	if d := out.DkimAttributes; d != nil {
		id.DKIMStatus = string(d.Status)
		id.DKIMOrigin = string(d.SigningAttributesOrigin)
		id.DKIMTokens = d.Tokens
	}
	if m := out.MailFromAttributes; m != nil {
		id.MailFromDomain = aws.ToString(m.MailFromDomain)
		id.MailFromStatus = string(m.MailFromDomainStatus)
	}
	return id, nil
}

func (c *client) ListIdentities(ctx context.Context) ([]Identity, error) {
	var out []Identity
	p := sesv2.NewListEmailIdentitiesPaginator(c.api, &sesv2.ListEmailIdentitiesInput{PageSize: aws.Int32(100)})
	for p.HasMorePages() {
		page, err := p.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("ses list identities: %w", err)
		}
		for _, i := range page.EmailIdentities {
			if i.IdentityName == nil {
				continue
			}
			out = append(out, Identity{
				Name:               *i.IdentityName,
				Type:               string(i.IdentityType),
				VerificationStatus: string(i.VerificationStatus),
				SendingEnabled:     i.SendingEnabled,
			})
		}
	}
	return out, nil
}

func (c *client) CreateIdentity(ctx context.Context, name string) error {
	_, err := c.api.CreateEmailIdentity(ctx, &sesv2.CreateEmailIdentityInput{
		EmailIdentity:         &name,
		DkimSigningAttributes: &types.DkimSigningAttributes{NextSigningKeyLength: types.DkimSigningKeyLengthRsa2048Bit},
	})
	if err != nil {
		return fmt.Errorf("ses create identity %s: %w", name, err)
	}
	return nil
}

func (c *client) DeleteIdentity(ctx context.Context, name string) error {
	if _, err := c.api.DeleteEmailIdentity(ctx, &sesv2.DeleteEmailIdentityInput{EmailIdentity: &name}); err != nil {
		return fmt.Errorf("ses delete identity %s: %w", name, err)
	}
	return nil
}

func (c *client) PutExternalDKIM(ctx context.Context, domain, selector, privateKey string) (string, []string, error) {
	out, err := c.api.PutEmailIdentityDkimSigningAttributes(ctx, &sesv2.PutEmailIdentityDkimSigningAttributesInput{
		EmailIdentity:           &domain,
		SigningAttributesOrigin: types.DkimSigningAttributesOriginExternal,
		SigningAttributes: &types.DkimSigningAttributes{
			DomainSigningSelector:   &selector,
			DomainSigningPrivateKey: &privateKey,
		},
	})
	if err != nil {
		return "", nil, fmt.Errorf("ses put dkim %s: %w", domain, err)
	}
	return string(out.DkimStatus), out.DkimTokens, nil
}

func (c *client) SetMailFrom(ctx context.Context, domain, mailFrom string) error {
	_, err := c.api.PutEmailIdentityMailFromAttributes(ctx, &sesv2.PutEmailIdentityMailFromAttributesInput{
		EmailIdentity:       &domain,
		MailFromDomain:      &mailFrom,
		BehaviorOnMxFailure: types.BehaviorOnMxFailureUseDefaultValue,
	})
	if err != nil {
		return fmt.Errorf("ses set mail from %s: %w", domain, err)
	}
	return nil
}

func (c *client) SendRaw(ctx context.Context, m RawEmail) (string, error) {
	in := &sesv2.SendEmailInput{
		FromEmailAddress: &m.From,
		Destination:      &types.Destination{ToAddresses: m.To},
		Content:          &types.EmailContent{Raw: &types.RawMessage{Data: m.Raw}},
	}
	if m.ConfigurationSet != "" {
		in.ConfigurationSetName = &m.ConfigurationSet
	}
	out, err := c.api.SendEmail(ctx, in)
	if err != nil {
		return "", fmt.Errorf("ses send: %w", err)
	}
	return aws.ToString(out.MessageId), nil
}

func (c *client) Account(ctx context.Context) (*Account, error) {
	out, err := c.api.GetAccount(ctx, &sesv2.GetAccountInput{})
	if err != nil {
		return nil, fmt.Errorf("ses get account: %w", err)
	}
	a := &Account{ProductionAccess: out.ProductionAccessEnabled, EnforcementStatus: aws.ToString(out.EnforcementStatus)}
	if q := out.SendQuota; q != nil {
		a.Max24Hour, a.SentLast24Hours, a.MaxSendRate = q.Max24HourSend, q.SentLast24Hours, q.MaxSendRate
	}
	return a, nil
}

// MessageIDHost is the host of the Message-ID SES writes on mail it sends
// (<id@host>): email.amazonses.com in us-east-1, <region>.amazonses.com
// elsewhere.
func MessageIDHost(region string) string {
	if region == "" || region == "us-east-1" {
		return "email.amazonses.com"
	}
	return region + ".amazonses.com"
}

// Permanent reports whether a send error will fail the same way on retry
// (bad address, rejected content, unverified sender), so the job should stop.
func Permanent(err error) bool {
	var (
		rejected *types.MessageRejected
		notVer   *types.MailFromDomainNotVerifiedException
		bad      *types.BadRequestException
		paused   *types.AccountSuspendedException
	)
	return errors.As(err, &rejected) || errors.As(err, &notVer) || errors.As(err, &bad) || errors.As(err, &paused)
}

// Status maps an SES status string onto the domain_status enum.
func Status(v string) string {
	switch strings.ToUpper(v) {
	case "SUCCESS", "VERIFIED":
		return "verified"
	case "FAILED":
		return "failed"
	case "TEMPORARY_FAILURE":
		return "temporary_failure"
	case "NOT_STARTED":
		return "not_started"
	default:
		return "pending"
	}
}

// Explain turns an AWS error into a sentence the owner can act on. The raw
// error stays in the logs.
func Explain(err error) string {
	msg := err.Error()
	switch {
	case strings.Contains(msg, "no EC2 IMDS role found"), strings.Contains(msg, "failed to refresh cached credentials"),
		strings.Contains(msg, "failed to retrieve credentials"), strings.Contains(msg, "no valid providers in chain"):
		return "AWS keys are not set. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, then restart Mails."
	case strings.Contains(msg, "InvalidClientTokenId"), strings.Contains(msg, "UnrecognizedClient"),
		strings.Contains(msg, "SignatureDoesNotMatch"):
		return "AWS refused the keys. Check AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY."
	case strings.Contains(msg, "AccessDenied"), strings.Contains(msg, "not authorized to perform"):
		return "The AWS keys are not allowed to do this. " + msg
	}
	return msg
}

// Package config reads every setting from the environment once, at start.
package config

import (
	"strings"

	"github.com/caarlos0/env/v11"
)

type Config struct {
	Addr        string `env:"ADDR" envDefault:":3000"`
	AppURL      string `env:"APP_URL" envDefault:"http://localhost:3000"`
	DatabaseURL string `env:"DATABASE_URL,required"`
	// Key for encrypting stored integration secrets. 32+ random bytes.
	Secret string `env:"SECRET,required"`

	GitHubClientID     string `env:"GITHUB_CLIENT_ID,required"`
	GitHubClientSecret string `env:"GITHUB_CLIENT_SECRET,required"`

	AWSRegion          string `env:"AWS_REGION" envDefault:"us-east-1"`
	AWSAccessKeyID     string `env:"AWS_ACCESS_KEY_ID"`
	AWSSecretAccessKey string `env:"AWS_SECRET_ACCESS_KEY"`
	SESConfigSet       string `env:"SES_CONFIGURATION_SET"`
	SESSNSTopicARN     string `env:"SES_SNS_TOPIC_ARN"`
	SESMailFromPrefix  string `env:"SES_MAIL_FROM_PREFIX" envDefault:"mail"`
	SESDKIMSelector    string `env:"SES_DKIM_SELECTOR" envDefault:"mail"`

	InboundSecret string `env:"INBOUND_WEBHOOK_SECRET,required"`

	R2AccountID       string `env:"R2_ACCOUNT_ID"`
	R2AccessKeyID     string `env:"R2_ACCESS_KEY_ID"`
	R2SecretAccessKey string `env:"R2_SECRET_ACCESS_KEY"`
	R2Bucket          string `env:"R2_BUCKET" envDefault:"mail-attachments"`

	VAPIDPublicKey  string `env:"VAPID_PUBLIC_KEY"`
	VAPIDPrivateKey string `env:"VAPID_PRIVATE_KEY"`
	VAPIDSubject    string `env:"VAPID_SUBJECT" envDefault:"mailto:admin@localhost"`

	RunMigrations bool `env:"RUN_MIGRATIONS_ON_BOOT" envDefault:"true"`
}

// Load reads the environment. Missing required values are reported together.
func Load() (*Config, error) {
	c, err := env.ParseAs[Config]()
	if err != nil {
		return nil, err
	}
	c.AppURL = strings.TrimRight(c.AppURL, "/")
	return &c, nil
}

// Secure reports whether cookies should carry the Secure flag.
func (c *Config) Secure() bool { return strings.HasPrefix(c.AppURL, "https://") }

-- Delivery reporting set up from the dashboard: the SES configuration set
-- mail is sent with, and the SNS topic it reports to. Env vars of the same
-- meaning override these.

-- +goose Up
ALTER TABLE settings ADD COLUMN ses_configuration_set text, ADD COLUMN ses_sns_topic_arn text;

-- +goose Down
ALTER TABLE settings DROP COLUMN ses_configuration_set, DROP COLUMN ses_sns_topic_arn;

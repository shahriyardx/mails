-- Domains the owner removed while keeping their SES identity. The list's
-- automatic sync from SES skips them; an explicit import or add clears it.

-- +goose Up
CREATE TABLE removed_domain (
  name        text PRIMARY KEY,
  removed_at  timestamptz NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE removed_domain;

-- Sender pictures found by the server (Gravatar, BIMI brand logos, site
-- icons), cached so each is fetched once. found = false caches a miss.

-- +goose Up
CREATE TABLE avatar (
  key           text PRIMARY KEY,   -- "g:<address>" (Gravatar) or "d:<domain>" (brand logo or icon)
  found         boolean NOT NULL,
  content_type  text,
  data          bytea,
  fetched_at    timestamptz NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE avatar;

-- The dashboard has a light theme as well as the dark one.

-- +goose Up
ALTER TABLE preference ADD COLUMN theme text NOT NULL DEFAULT 'dark' CHECK (theme IN ('dark', 'light', 'system'));

-- +goose Down
ALTER TABLE preference DROP COLUMN theme;

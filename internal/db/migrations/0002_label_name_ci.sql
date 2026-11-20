-- Labels are looked up by name without regard to case, so two names that
-- differ only in case would be ambiguous.

-- +goose Up
CREATE UNIQUE INDEX label_name_lower_idx ON label (lower(name));

-- +goose Down
DROP INDEX label_name_lower_idx;

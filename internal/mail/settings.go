package mail

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/shahriyardx/mails/internal/addr"
	"github.com/shahriyardx/mails/internal/httpx"
	"github.com/shahriyardx/mails/internal/id"
	"github.com/shahriyardx/mails/internal/page"
)

// ---- Labels ---------------------------------------------------------------

var hexColor = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

const defaultLabelColor = "#8a8a8a"

func (s *Service) ListLabels(ctx context.Context) ([]*Label, error) {
	rows, _ := s.DB.Query(ctx, `SELECT id, name, color, created_at FROM label ORDER BY lower(name)`)
	list, err := pgx.CollectRows(rows, pgx.RowToAddrOfStructByName[Label])
	if err != nil {
		return nil, fmt.Errorf("list labels: %w", err)
	}
	for _, l := range list {
		l.Object = "label"
	}
	return list, nil
}

// GetLabel finds a label by id or name.
func (s *Service) GetLabel(ctx context.Context, idOrName string) (*Label, error) {
	rows, _ := s.DB.Query(ctx, `SELECT id, name, color, created_at FROM label WHERE id = $1 OR lower(name) = lower($1)`, idOrName)
	l, err := pgx.CollectExactlyOneRow(rows, pgx.RowToAddrOfStructByName[Label])
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, httpx.NotFound("No such label")
	}
	if err != nil {
		return nil, fmt.Errorf("get label: %w", err)
	}
	l.Object = "label"
	return l, nil
}

// LabelInput creates or changes a label. Empty fields stay on update.
type LabelInput struct {
	Name  string `json:"name" validate:"max=100"`
	Color string `json:"color"`
}

func checkLabel(in *LabelInput, creating bool) error {
	in.Name = strings.TrimSpace(in.Name)
	if creating && in.Name == "" {
		return httpx.Invalid("name", "name: Required")
	}
	if in.Color != "" && !hexColor.MatchString(in.Color) {
		return httpx.Invalid("color", "color: A hex value like #64748b")
	}
	return httpx.Validate(in)
}

func (s *Service) CreateLabel(ctx context.Context, in LabelInput) (*Label, error) {
	if err := checkLabel(&in, true); err != nil {
		return nil, err
	}
	if in.Color == "" {
		in.Color = defaultLabelColor
	}
	newID := id.New("lbl")
	if _, err := s.DB.Exec(ctx, `INSERT INTO label (id, name, color) VALUES ($1, $2, $3)`, newID, in.Name, in.Color); err != nil {
		if unique(err) {
			return nil, httpx.Conflict("A label with that name exists")
		}
		return nil, fmt.Errorf("create label: %w", err)
	}
	return s.GetLabel(ctx, newID)
}

func (s *Service) UpdateLabel(ctx context.Context, idOrName string, in LabelInput) (*Label, error) {
	l, err := s.GetLabel(ctx, idOrName)
	if err != nil {
		return nil, err
	}
	if err := checkLabel(&in, false); err != nil {
		return nil, err
	}
	_, err = s.DB.Exec(ctx, `UPDATE label SET name = coalesce(nullif($2, ''), name), color = coalesce(nullif($3, ''), color) WHERE id = $1`,
		l.ID, in.Name, in.Color)
	if unique(err) {
		return nil, httpx.Conflict("A label with that name exists")
	}
	if err != nil {
		return nil, fmt.Errorf("update label: %w", err)
	}
	return s.GetLabel(ctx, l.ID)
}

func (s *Service) DeleteLabel(ctx context.Context, idOrName string) (*Label, error) {
	l, err := s.GetLabel(ctx, idOrName)
	if err != nil {
		return nil, err
	}
	if _, err := s.DB.Exec(ctx, `DELETE FROM label WHERE id = $1`, l.ID); err != nil {
		return nil, fmt.Errorf("delete label: %w", err)
	}
	return l, nil
}

func unique(err error) bool {
	var pg *pgconn.PgError
	return errors.As(err, &pg) && pg.Code == "23505"
}

// ---- Filters --------------------------------------------------------------

// Filter is a rule run on each inbound message (see inbound.applyFilters).
type Filter struct {
	ID             string    `json:"id" db:"id"`
	Name           string    `json:"name" db:"name" validate:"required,max=100"`
	Enabled        bool      `json:"enabled" db:"enabled"`
	Priority       int       `json:"priority" db:"priority"`
	MatchFrom      *string   `json:"match_from" db:"match_from" validate:"omitempty,max=500"`
	MatchTo        *string   `json:"match_to" db:"match_to" validate:"omitempty,max=500"`
	MatchSubject   *string   `json:"match_subject" db:"match_subject" validate:"omitempty,max=500"`
	MatchBody      *string   `json:"match_body" db:"match_body" validate:"omitempty,max=500"`
	ActionFolder   *string   `json:"action_folder" db:"action_folder" validate:"omitempty,oneof=inbox archive spam trash"`
	ActionLabelID  *string   `json:"action_label_id" db:"action_label_id"`
	ActionMarkRead bool      `json:"action_mark_read" db:"action_mark_read"`
	ActionStar     bool      `json:"action_star" db:"action_star"`
	CreatedAt      time.Time `json:"created_at" db:"created_at"`
}

const filterColumns = `id, name, enabled, priority, match_from, match_to, match_subject, match_body,
	action_folder::text AS action_folder, action_label_id, action_mark_read, action_star, created_at`

func (s *Service) ListFilters(ctx context.Context) ([]*Filter, error) {
	rows, _ := s.DB.Query(ctx, `SELECT `+filterColumns+` FROM filter_rule ORDER BY priority DESC, created_at`)
	list, err := pgx.CollectRows(rows, pgx.RowToAddrOfStructByName[Filter])
	if err != nil {
		return nil, fmt.Errorf("list filters: %w", err)
	}
	return list, nil
}

func checkFilter(f *Filter) error {
	if err := httpx.Validate(f); err != nil {
		return err
	}
	for _, m := range []*string{f.MatchFrom, f.MatchTo, f.MatchSubject, f.MatchBody} {
		if m != nil && strings.TrimSpace(*m) != "" {
			return nil
		}
	}
	return httpx.Invalid("match_from", "A filter needs at least one condition")
}

// SaveFilter creates a filter (empty ID) or replaces one.
func (s *Service) SaveFilter(ctx context.Context, f Filter) (*Filter, error) {
	if err := checkFilter(&f); err != nil {
		return nil, err
	}
	if f.ActionLabelID != nil && *f.ActionLabelID != "" {
		l, err := s.GetLabel(ctx, *f.ActionLabelID)
		if err != nil {
			return nil, httpx.Invalid("action_label_id", "action_label_id: No such label")
		}
		f.ActionLabelID = &l.ID
	} else {
		f.ActionLabelID = nil
	}
	if f.ID == "" {
		f.ID = id.New("flt")
		_, err := s.DB.Exec(ctx, `INSERT INTO filter_rule (id, name, enabled, priority, match_from, match_to, match_subject, match_body,
			action_folder, action_label_id, action_mark_read, action_star) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
			f.ID, f.Name, f.Enabled, f.Priority, f.MatchFrom, f.MatchTo, f.MatchSubject, f.MatchBody, f.ActionFolder, f.ActionLabelID, f.ActionMarkRead, f.ActionStar)
		if err != nil {
			return nil, fmt.Errorf("create filter: %w", err)
		}
	} else {
		tag, err := s.DB.Exec(ctx, `UPDATE filter_rule SET name = $2, enabled = $3, priority = $4, match_from = $5, match_to = $6,
			match_subject = $7, match_body = $8, action_folder = $9, action_label_id = $10, action_mark_read = $11, action_star = $12 WHERE id = $1`,
			f.ID, f.Name, f.Enabled, f.Priority, f.MatchFrom, f.MatchTo, f.MatchSubject, f.MatchBody, f.ActionFolder, f.ActionLabelID, f.ActionMarkRead, f.ActionStar)
		if err != nil {
			return nil, fmt.Errorf("update filter: %w", err)
		}
		if tag.RowsAffected() == 0 {
			return nil, httpx.NotFound("No such filter")
		}
	}
	rows, _ := s.DB.Query(ctx, `SELECT `+filterColumns+` FROM filter_rule WHERE id = $1`, f.ID)
	return pgx.CollectExactlyOneRow(rows, pgx.RowToAddrOfStructByName[Filter])
}

func (s *Service) DeleteFilter(ctx context.Context, filterID string) error {
	tag, err := s.DB.Exec(ctx, `DELETE FROM filter_rule WHERE id = $1`, filterID)
	if err != nil {
		return fmt.Errorf("delete filter: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return httpx.NotFound("No such filter")
	}
	return nil
}

// ---- Contacts -------------------------------------------------------------

type Contact struct {
	Object       string    `json:"object" db:"-"`
	ID           string    `json:"id" db:"id"`
	Address      string    `json:"address" db:"address"`
	Name         *string   `json:"name" db:"name"`
	MessageCount int       `json:"message_count" db:"message_count"`
	LastSeenAt   time.Time `json:"last_seen_at" db:"last_seen_at"`
}

// ListContacts pages contacts, recent first or (order "frequent") by count.
func (s *Service) ListContacts(ctx context.Context, q, order string, p page.Params) (page.List[*Contact], error) {
	var w where
	if q != "" {
		like := "%" + likeEscape(q) + "%"
		w.add("(address ILIKE ? OR name ILIKE ?)", like, like)
	}
	sortCol, sortVal := "last_seen_at", func(c *Contact) int64 { return c.LastSeenAt.UnixMicro() }
	switch order {
	case "", "recent":
		if c := p.Cursor; c != nil {
			w.add("(last_seen_at, id) < (?, ?)", c.Time(), c.ID)
		}
	case "frequent":
		sortCol, sortVal = "message_count", func(c *Contact) int64 { return int64(c.MessageCount) }
		if c := p.Cursor; c != nil {
			w.add("(message_count, id) < (?, ?)", c.Value, c.ID)
		}
	default:
		return page.List[*Contact]{}, httpx.Invalid("order", "order: One of recent, frequent")
	}
	limit := w.arg(p.Limit + 1)
	rows, _ := s.DB.Query(ctx, `SELECT id, address, name, message_count, last_seen_at FROM contact `+w.sql()+
		` ORDER BY `+sortCol+` DESC, id DESC LIMIT `+limit, w.args...)
	list, err := pgx.CollectRows(rows, pgx.RowToAddrOfStructByName[Contact])
	if err != nil {
		return page.List[*Contact]{}, fmt.Errorf("list contacts: %w", err)
	}
	for _, c := range list {
		c.Object = "contact"
	}
	return page.Build(list, p.Limit, func(c *Contact) (int64, string) { return sortVal(c), c.ID }), nil
}

// ---- Remote image trust ---------------------------------------------------

// ImageChoices returns the remembered choice for each sender that has one.
func (s *Service) ImageChoices(ctx context.Context, senders []string) (map[string]bool, error) {
	out := map[string]bool{}
	if len(senders) == 0 {
		return out, nil
	}
	lower := make([]string, len(senders))
	for i, a := range senders {
		lower[i] = strings.ToLower(strings.TrimSpace(a))
	}
	rows, _ := s.DB.Query(ctx, `SELECT sender, allowed FROM image_trust WHERE sender = ANY($1)`, lower)
	var sender string
	var allowed bool
	_, err := pgx.ForEachRow(rows, []any{&sender, &allowed}, func() error {
		out[sender] = allowed
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("image choices: %w", err)
	}
	return out, nil
}

// TrustImages remembers whether to load remote images from sender.
func (s *Service) TrustImages(ctx context.Context, sender string, allowed bool) error {
	sender = strings.ToLower(strings.TrimSpace(sender))
	if !addr.Valid(sender) {
		return httpx.Invalid("sender", "sender: Not an email address")
	}
	_, err := s.DB.Exec(ctx, `INSERT INTO image_trust (sender, allowed) VALUES ($1, $2)
		ON CONFLICT (sender) DO UPDATE SET allowed = excluded.allowed, updated_at = now()`, sender, allowed)
	if err != nil {
		return fmt.Errorf("trust images: %w", err)
	}
	return nil
}

// ---- Preferences ----------------------------------------------------------

// Preferences are the owner's display choices.
type Preferences struct {
	Theme         string `json:"theme" validate:"omitempty,oneof=dark light system"`
	Density       string `json:"density" validate:"omitempty,oneof=comfortable compact"`
	ReadingLayout string `json:"reading_layout" validate:"omitempty,oneof=split stacked"`
	NavCollapsed  *bool  `json:"nav_collapsed"`
	// UndoSendSeconds is how long a dashboard send waits so it can be
	// called back. 0 sends at once.
	UndoSendSeconds *int `json:"undo_send_seconds" validate:"omitnil,oneof=0 5 10 20 30"`
}

func (s *Service) GetPreferences(ctx context.Context, userID string) (*Preferences, error) {
	p := &Preferences{Theme: "dark", Density: "comfortable", ReadingLayout: "split", NavCollapsed: new(bool), UndoSendSeconds: new(10)}
	err := s.DB.QueryRow(ctx, `SELECT theme, density, reading_layout, nav_collapsed, undo_send_seconds FROM preference WHERE user_id = $1`, userID).
		Scan(&p.Theme, &p.Density, &p.ReadingLayout, p.NavCollapsed, p.UndoSendSeconds)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("get preferences: %w", err)
	}
	return p, nil
}

// SavePreferences merges p into the stored choices.
func (s *Service) SavePreferences(ctx context.Context, userID string, p Preferences) (*Preferences, error) {
	if err := httpx.Validate(p); err != nil {
		return nil, err
	}
	_, err := s.DB.Exec(ctx, `INSERT INTO preference (user_id, density, reading_layout, nav_collapsed, theme, undo_send_seconds)
		VALUES ($1, coalesce(nullif($2, ''), 'comfortable'), coalesce(nullif($3, ''), 'split'), coalesce($4, false), coalesce(nullif($5, ''), 'dark'), coalesce($6, 10))
		ON CONFLICT (user_id) DO UPDATE SET density = coalesce(nullif($2, ''), preference.density),
			reading_layout = coalesce(nullif($3, ''), preference.reading_layout),
			nav_collapsed = coalesce($4, preference.nav_collapsed),
			theme = coalesce(nullif($5, ''), preference.theme),
			undo_send_seconds = coalesce($6, preference.undo_send_seconds), updated_at = now()`,
		userID, p.Density, p.ReadingLayout, p.NavCollapsed, p.Theme, p.UndoSendSeconds)
	if err != nil {
		return nil, fmt.Errorf("save preferences: %w", err)
	}
	return s.GetPreferences(ctx, userID)
}

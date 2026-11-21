package mail

import (
	"strings"
	"time"
)

// Term is one recognised filter in a search box query ("from:ada").
type Term struct {
	Op    string `json:"op"`
	Value string `json:"value"`
}

// Search is a parsed q: the filters it names plus the words left over,
// which are searched as free text. The dashboard renders Terms as chips
// with its own copy of this parser; testdata/search.json keeps the two
// in step.
type Search struct {
	Terms []Term `json:"terms"`
	Text  string `json:"text"`
}

// ParseSearch reads Gmail-style filters out of q: from:, to:, subject:,
// label: (any text, "quoted" to hold spaces), has:attachment, is:unread,
// is:read, is:starred, in:<folder>, before: and after: (YYYY-MM-DD).
// Anything else, unknown operators and bad values included, stays free text.
func ParseSearch(q string) Search {
	var s Search
	var text []string
	for _, tok := range tokens(q) {
		op, raw, ok := strings.Cut(tok, ":")
		if t, valid := term(strings.ToLower(op), unquote(raw)); ok && valid {
			s.Terms = append(s.Terms, t)
		} else {
			text = append(text, tok)
		}
	}
	s.Text = strings.Join(text, " ")
	return s
}

func term(op, v string) (Term, bool) {
	switch op {
	case "from", "to", "subject", "label":
		return Term{op, v}, v != ""
	case "has":
		v = strings.ToLower(v)
		return Term{op, "attachment"}, v == "attachment" || v == "attachments"
	case "is":
		v = strings.ToLower(v)
		return Term{op, v}, v == "unread" || v == "read" || v == "starred"
	case "in":
		v = strings.ToLower(v)
		return Term{op, v}, views[v]
	case "before", "after":
		d, err := time.Parse("2006-01-02", strings.ReplaceAll(v, "/", "-"))
		return Term{op, d.Format("2006-01-02")}, err == nil
	}
	return Term{}, false
}

// views are the lists in:<view> may name.
var views = map[string]bool{"inbox": true, "sent": true, "drafts": true, "archive": true, "spam": true,
	"trash": true, "starred": true, "snoozed": true, "all": true}

// tokens splits q on spaces, keeping "quoted text" (alone or as an
// operator's value) in one piece. An unclosed quote runs to the end.
func tokens(q string) []string {
	var out []string
	var b strings.Builder
	quoted := false
	for _, r := range q {
		switch {
		case r == '"':
			quoted = !quoted
			b.WriteRune(r)
		case !quoted && (r == ' ' || r == '\t' || r == '\n'):
			if b.Len() > 0 {
				out = append(out, b.String())
				b.Reset()
			}
		default:
			b.WriteRune(r)
		}
	}
	if b.Len() > 0 {
		out = append(out, b.String())
	}
	return out
}

func unquote(v string) string {
	return strings.TrimSpace(strings.Trim(v, `"`))
}

// The expressions the trigram indexes in 0014_search.sql are built on:
// a query must spell them the same way to use them.
const (
	fromExpr = `(coalesce(m.from_name, '') || ' ' || m.from_address)`
	toExpr   = `jsonb_path_query_array(m.to_addrs || m.cc_addrs || m.bcc_addrs, '$[*].*')::text`
)

// messageConds adds what one message must match (alias m): free text,
// from, to, subject and dates. Every condition has an index path:
// search_vector, the trigram indexes, or message_thread_idx for dates.
func (s Search) messageConds(w *where) {
	if s.Text != "" {
		like := "%" + likeEscape(s.Text) + "%"
		w.add(`(m.search_vector @@ websearch_to_tsquery('english', ?) OR `+fromExpr+` ILIKE ? OR m.subject ILIKE ?)`, s.Text, like, like)
	}
	for _, t := range s.Terms {
		like := "%" + likeEscape(t.Value) + "%"
		switch t.Op {
		case "from":
			w.add(fromExpr+` ILIKE ?`, like)
		case "to":
			w.add(toExpr+` ILIKE ?`, like)
		case "subject":
			w.add(`m.subject ILIKE ?`, like)
		case "before", "after":
			d, _ := time.Parse("2006-01-02", t.Value)
			if t.Op == "before" {
				w.add(`m.received_at < ?`, d)
			} else {
				w.add(`m.received_at >= ?`, d)
			}
		}
	}
}

// view is the list in: names, "" when none.
func (s Search) view() string {
	v := ""
	for _, t := range s.Terms {
		if t.Op == "in" {
			v = t.Value
		}
	}
	return v
}

// threadConds adds the thread-level filters (alias t) and wraps the
// message-level ones in one EXISTS, so a single message matches them all.
func (s Search) threadConds(w *where) {
	if parts := w.nested(s.messageConds); len(parts) > 0 {
		w.parts = append(w.parts, `EXISTS (SELECT 1 FROM message m WHERE m.thread_id = t.id AND `+strings.Join(parts, " AND ")+`)`)
	}
	for _, t := range s.Terms {
		switch t.Op + ":" + t.Value {
		case "has:attachment":
			w.add("t.has_attachments")
		case "is:unread":
			w.add("t.unread_count > 0")
		case "is:read":
			w.add("t.unread_count = 0")
		case "is:starred":
			w.add("t.is_starred")
		}
		if t.Op == "label" {
			w.add(labelCond("t.id"), t.Value, t.Value)
		}
	}
}

// listConds adds every filter for a message list (alias m).
func (s Search) listConds(w *where) {
	s.messageConds(w)
	for _, t := range s.Terms {
		switch t.Op + ":" + t.Value {
		case "has:attachment":
			w.add("EXISTS (SELECT 1 FROM attachment a WHERE a.message_id = m.id AND NOT a.is_inline)")
		case "is:unread":
			w.add("NOT m.is_read")
		case "is:read":
			w.add("m.is_read")
		case "is:starred", "in:starred":
			w.add("m.is_starred")
		case "in:snoozed":
			w.add("m.thread_id IN (SELECT id FROM thread WHERE snoozed_until IS NOT NULL)")
		}
		if t.Op == "label" {
			w.add(labelCond("m.thread_id"), t.Value, t.Value)
		}
	}
}

func labelCond(threadCol string) string {
	return "EXISTS (SELECT 1 FROM thread_label tl JOIN label l ON l.id = tl.label_id WHERE tl.thread_id = " + threadCol +
		" AND (l.id = ? OR lower(l.name) = lower(?)))"
}

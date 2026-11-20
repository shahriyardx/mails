// Package page is cursor pagination, the one way every list pages.
//
// A cursor is a sort value and an id joined by a pipe ("<micros>|<id>" for
// time-sorted lists). Callers treat it as opaque. The id breaks ties so
// paging stays stable when many rows share a timestamp.
package page

import (
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/shahriyardx/mails/internal/httpx"
)

const (
	DefaultLimit = 25
	MaxLimit     = 100
)

// List is one page in the public API shape.
type List[T any] struct {
	Object     string  `json:"object"`
	Data       []T     `json:"data"`
	HasMore    bool    `json:"has_more"`
	NextCursor *string `json:"next_cursor"`
}

// Cursor is a decoded position: rows strictly after (Value, ID) in a
// descending walk.
type Cursor struct {
	Value int64
	ID    string
}

// Time returns Value as a time (microseconds since the epoch).
func (c *Cursor) Time() time.Time { return time.UnixMicro(c.Value) }

// Params are the paging inputs of a request.
type Params struct {
	Limit  int
	Cursor *Cursor
}

// Parse reads limit and cursor from a query string.
func Parse(q url.Values) (Params, error) {
	p := Params{Limit: DefaultLimit}
	if v := q.Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 {
			return p, httpx.Invalid("limit", "limit: Must be a positive number")
		}
		p.Limit = min(n, MaxLimit)
	}
	if v := q.Get("cursor"); v != "" {
		value, id, ok := strings.Cut(v, "|")
		n, err := strconv.ParseInt(value, 10, 64)
		if !ok || err != nil || id == "" {
			return p, httpx.Invalid("cursor", "cursor: Not a cursor this API returned")
		}
		p.Cursor = &Cursor{Value: n, ID: id}
	}
	return p, nil
}

// Build turns limit+1 fetched rows into a page. key returns a row's sort
// value and id.
func Build[T any](rows []T, limit int, key func(T) (int64, string)) List[T] {
	l := List[T]{Object: "list", Data: rows}
	if l.Data == nil {
		l.Data = []T{}
	}
	if len(rows) > limit {
		l.Data, l.HasMore = rows[:limit], true
		v, id := key(rows[limit-1])
		c := strconv.FormatInt(v, 10) + "|" + id
		l.NextCursor = &c
	}
	return l
}

// Of wraps a one-shot list (no paging) in the same shape.
func Of[T any](rows []T) List[T] {
	if rows == nil {
		rows = []T{}
	}
	return List[T]{Object: "list", Data: rows}
}

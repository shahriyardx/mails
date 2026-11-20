// Package httpx holds the JSON and error helpers every handler uses.
//
// Errors always have the shape {"error": "...", "code": "..."} with optional
// extra fields, matching the public API docs (web/src/docs/api/errors.md).
package httpx

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
)

// Error is an error that knows its HTTP status and API code.
type Error struct {
	Status  int
	Code    string
	Message string
	Extra   map[string]any
}

func (e *Error) Error() string { return e.Message }

func NotFound(msg string) *Error     { return &Error{Status: 404, Code: "not_found", Message: msg} }
func Unauthorized(msg string) *Error { return &Error{Status: 401, Code: "unauthorized", Message: msg} }
func Forbidden(msg string) *Error    { return &Error{Status: 403, Code: "forbidden", Message: msg} }
func Conflict(msg string) *Error     { return &Error{Status: 409, Code: "conflict", Message: msg} }
func RateLimited(msg string) *Error  { return &Error{Status: 429, Code: "rate_limited", Message: msg} }

// Invalid reports a bad field; param names it.
func Invalid(param, msg string) *Error {
	e := &Error{Status: 422, Code: "invalid_request", Message: msg}
	if param != "" {
		e.Extra = map[string]any{"param": param}
	}
	return e
}

// JSON writes v with the given status.
func JSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// Fail writes err. An *Error keeps its status and code; anything else is
// logged and becomes a 500 without leaking its text.
func Fail(w http.ResponseWriter, r *http.Request, err error) {
	var e *Error
	if !errors.As(err, &e) {
		slog.Error("request failed", "method", r.Method, "path", r.URL.Path, "err", err)
		e = &Error{Status: 500, Code: "server_error", Message: "The server failed to handle this request"}
	}
	body := map[string]any{"error": e.Message, "code": e.Code}
	for k, v := range e.Extra {
		body[k] = v
	}
	JSON(w, e.Status, body)
}

// Decode reads a JSON body (at most 32 MB) into v, rejecting unknown fields
// so a misspelled or unsupported field is an error, not silently ignored.
func Decode(r *http.Request, v any) error {
	dec := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 32<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			return &Error{Status: 413, Code: "payload_too_large", Message: "Request body is over 32 MB"}
		}
		return Invalid("", "Request body is not valid JSON for this endpoint: "+err.Error())
	}
	return nil
}

// Handler adapts a function that returns an error into an http.Handler.
type Handler func(w http.ResponseWriter, r *http.Request) error

func (h Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if err := h(w, r); err != nil {
		Fail(w, r, err)
	}
}

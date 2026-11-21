package httpx

import (
	"encoding/json"
	"errors"
	"net/http"
	"reflect"
	"strings"

	"github.com/go-playground/validator/v10"
)

var validate = func() *validator.Validate {
	v := validator.New(validator.WithRequiredStructEnabled())
	// Report fields by their JSON name, which is what the caller sent.
	v.RegisterTagNameFunc(func(f reflect.StructField) string {
		name, _, _ := strings.Cut(f.Tag.Get("json"), ",")
		if name == "-" {
			return ""
		}
		return name
	})
	return v
}()

// Bind decodes a JSON body into v and runs its `validate` struct tags. A
// failure is a 422 naming every bad field, with param set to the first.
func Bind(r *http.Request, v any) error {
	if err := Decode(r, v); err != nil {
		return err
	}
	return Validate(v)
}

// Validate runs v's `validate` struct tags.
func Validate(v any) error {
	err := validate.Struct(v)
	var verrs validator.ValidationErrors
	if !errors.As(err, &verrs) {
		return err
	}
	msgs := make([]string, len(verrs))
	for i, fe := range verrs {
		msgs[i] = fe.Field() + ": " + describe(fe)
	}
	return Invalid(verrs[0].Field(), strings.Join(msgs, ", "))
}

func describe(fe validator.FieldError) string {
	switch fe.Tag() {
	case "required":
		return "Required"
	case "email":
		return "Not an email address"
	case "url", "http_url":
		return "Not a URL"
	case "max":
		return "At most " + fe.Param()
	case "min":
		return "At least " + fe.Param()
	case "oneof":
		return "One of: " + fe.Param()
	default:
		return "Fails " + fe.Tag()
	}
}

// Opt is a JSON field in a PATCH body that tells apart "not sent", "sent as
// null" and "sent with a value".
type Opt[T any] struct {
	Set   bool
	Null  bool
	Value T
}

func (o *Opt[T]) UnmarshalJSON(b []byte) error {
	o.Set = true
	if string(b) == "null" {
		o.Null = true
		return nil
	}
	return jsonUnmarshal(b, &o.Value)
}

// MarshalJSON writes it back as sent (null or the value), so a change can
// be echoed in a webhook. Tag the field omitzero to leave it out when unset.
func (o Opt[T]) MarshalJSON() ([]byte, error) {
	if o.Null {
		return []byte("null"), nil
	}
	return json.Marshal(o.Value)
}

// IsZero reports "not sent", for omitzero.
func (o Opt[T]) IsZero() bool { return !o.Set }

// Ptr is the value as a pointer: nil when null. Only meaningful when Set.
func (o Opt[T]) Ptr() *T {
	if o.Null {
		return nil
	}
	return &o.Value
}

package send

import (
	"bytes"
	"fmt"
	"strings"
	"time"

	gomail "github.com/wneessen/go-mail"

	"github.com/shahriyardx/mails/internal/addr"
	"github.com/shahriyardx/mails/internal/httpx"
)

// File is one attachment going into a message.
type File struct {
	Name        string
	ContentType string
	ContentID   string // set: embedded inline, referenced as cid:<id>
	Data        []byte
}

// Mail is everything that goes into the MIME message. Bcc is deliberately
// absent: blind copies travel only in the SES envelope.
type Mail struct {
	From       addr.Address
	To, Cc     []addr.Address
	ReplyTo    string
	Subject    string
	Text, HTML string
	MessageID  string // without angle brackets
	InReplyTo  string
	References []string
	Headers    map[string]string
	Files      []File
	Date       time.Time
}

// reserved headers are set by Mails; a caller may not override them.
var reserved = map[string]bool{
	"from": true, "to": true, "cc": true, "bcc": true, "subject": true, "date": true, "message-id": true,
	"reply-to": true, "in-reply-to": true, "references": true, "mime-version": true, "sender": true,
	"return-path": true, "content-type": true, "content-transfer-encoding": true, "content-disposition": true,
	"dkim-signature": true, "received": true, "authentication-results": true,
}

// CheckHeaders rejects extra headers that would override ours or inject
// new lines.
func CheckHeaders(h map[string]string) error {
	for k, v := range h {
		if k == "" || strings.ContainsAny(k, " :\t\r\n") || reserved[strings.ToLower(k)] {
			return httpx.Invalid("headers", fmt.Sprintf("headers: %q cannot be set", k))
		}
		for _, r := range k {
			if r < 33 || r > 126 {
				return httpx.Invalid("headers", fmt.Sprintf("headers: %q is not a header name", k))
			}
		}
		if strings.ContainsAny(v, "\r\n") {
			return httpx.Invalid("headers", fmt.Sprintf("headers: %q has a line break", k))
		}
	}
	return nil
}

// Build renders m as RFC 5322 bytes: multipart/alternative text and HTML,
// with inline files related and other files attached.
func Build(m Mail) ([]byte, error) {
	if err := CheckHeaders(m.Headers); err != nil {
		return nil, err
	}
	msg := gomail.NewMsg(gomail.WithNoDefaultUserAgent())
	if err := msg.FromFormat(m.From.Name, m.From.Address); err != nil {
		return nil, httpx.Invalid("from", "from: "+err.Error())
	}
	for _, a := range m.To {
		if err := msg.AddToFormat(a.Name, a.Address); err != nil {
			return nil, httpx.Invalid("to", fmt.Sprintf("to: %s: %v", a.Address, err))
		}
	}
	for _, a := range m.Cc {
		if err := msg.AddCcFormat(a.Name, a.Address); err != nil {
			return nil, httpx.Invalid("cc", fmt.Sprintf("cc: %s: %v", a.Address, err))
		}
	}
	if m.ReplyTo != "" {
		if err := msg.ReplyTo(m.ReplyTo); err != nil {
			return nil, httpx.Invalid("reply_to", "reply_to: "+err.Error())
		}
	}
	msg.Subject(m.Subject)
	msg.SetMessageIDWithValue(m.MessageID)
	msg.SetDateWithValue(m.Date)
	if m.InReplyTo != "" {
		msg.SetGenHeader(gomail.HeaderInReplyTo, m.InReplyTo)
	}
	if len(m.References) > 0 {
		msg.SetGenHeader(gomail.HeaderReferences, strings.Join(m.References, " "))
	}
	for k, v := range m.Headers {
		msg.SetGenHeader(gomail.Header(k), v)
	}
	switch {
	case m.Text != "" && m.HTML != "":
		msg.SetBodyString(gomail.TypeTextPlain, m.Text)
		msg.AddAlternativeString(gomail.TypeTextHTML, m.HTML)
	case m.HTML != "":
		msg.SetBodyString(gomail.TypeTextHTML, m.HTML)
	default:
		msg.SetBodyString(gomail.TypeTextPlain, m.Text)
	}
	for _, f := range m.Files {
		opts := []gomail.FileOption{gomail.WithFileContentType(gomail.ContentType(nonEmpty(f.ContentType, "application/octet-stream")))}
		var err error
		if f.ContentID != "" {
			opts = append(opts, gomail.WithFileContentID(f.ContentID))
			err = msg.EmbedReader(f.Name, bytes.NewReader(f.Data), opts...)
		} else {
			err = msg.AttachReader(f.Name, bytes.NewReader(f.Data), opts...)
		}
		if err != nil {
			return nil, fmt.Errorf("attach %s: %w", f.Name, err)
		}
	}
	var buf bytes.Buffer
	if _, err := msg.WriteTo(&buf); err != nil {
		return nil, fmt.Errorf("write mime: %w", err)
	}
	return buf.Bytes(), nil
}

func nonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

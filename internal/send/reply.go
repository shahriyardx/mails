package send

import (
	"context"
	"html"
	"strings"

	"github.com/microcosm-cc/bluemonday"

	"github.com/shahriyardx/mails/internal/addr"
	"github.com/shahriyardx/mails/internal/httpx"
	"github.com/shahriyardx/mails/internal/mail"
)

// ReplyInput answers a thread. Unset fields are worked out from the last
// message: recipients, subject and threading headers.
type ReplyInput struct {
	Text        string            `json:"text"`
	HTML        string            `json:"html"`
	ReplyAll    bool              `json:"reply_all"`
	To          *Recipients       `json:"to"`
	Cc          *Recipients       `json:"cc"`
	Bcc         *Recipients       `json:"bcc"`
	Subject     *string           `json:"subject"`
	Quote       *bool             `json:"quote"`
	Headers     map[string]string `json:"headers"`
	Attachments []Upload          `json:"attachments" validate:"max=20,dive"`

	APIKeyID string   `json:"-"`
	Allowed  []string `json:"-"`
}

// Reply sends an answer to the last message of a thread, from the thread's
// mailbox.
func (s *Service) Reply(ctx context.Context, threadID string, in ReplyInput) (*Result, error) {
	t, err := s.Mail.GetThread(ctx, in.Allowed, threadID, true)
	if err != nil {
		return nil, err
	}
	var last *mail.Message
	for _, m := range t.Messages {
		if !m.IsDraft {
			last = m
		}
	}
	if last == nil {
		return nil, httpx.Invalid("", "This thread has no message to reply to")
	}
	out := Input{
		From: t.Mailbox, Text: in.Text, HTML: in.HTML, Headers: in.Headers, Attachments: in.Attachments,
		ThreadID: t.ID, APIKeyID: in.APIKeyID, Allowed: in.Allowed,
	}
	out.To, out.Cc = ReplyRecipients(last, t.Mailbox, in.ReplyAll)
	if in.To != nil {
		out.To = *in.To
	}
	if in.Cc != nil {
		out.Cc = *in.Cc
	}
	if in.Bcc != nil {
		out.Bcc = *in.Bcc
	}
	out.Subject = addr.ReplySubject(last.Subject)
	if in.Subject != nil {
		out.Subject = *in.Subject
	}
	out.InReplyTo, out.References = ThreadingHeaders(last)
	if in.Quote == nil || *in.Quote {
		if out.HTML == "" {
			out.HTML = addr.TextToHTML(out.Text)
		}
		out.HTML += Quote(last)
	}
	return s.Send(ctx, out)
}

// ReplyRecipients works out who a reply goes to. Answering mail we received
// goes to its Reply-To, else its sender; answering our own message goes to
// the same people again. Reply-all adds everyone else, never ourselves.
func ReplyRecipients(last *mail.Message, self string, all bool) (to, cc []addr.Address) {
	if last.IsOutbound {
		to, cc = last.To, nil
		if all {
			cc = last.Cc
		}
	} else {
		to = []addr.Address{last.From}
		if last.ReplyTo != nil {
			if rt := addr.ParseList(*last.ReplyTo); len(rt) > 0 {
				to = rt
			}
		}
		if all {
			cc = append(append([]addr.Address{}, last.To...), last.Cc...)
		}
	}
	seen := map[string]bool{strings.ToLower(self): true}
	keep := func(list []addr.Address) []addr.Address {
		var out []addr.Address
		for _, a := range list {
			k := strings.ToLower(a.Address)
			if !seen[k] {
				seen[k] = true
				out = append(out, a)
			}
		}
		return out
	}
	to = keep(to)
	cc = keep(cc)
	return to, cc
}

// ThreadingHeaders are In-Reply-To and References for answering m. SES
// replaces the Message-ID we wrote on our own mail with its own, so a reply
// to our message points at that one.
func ThreadingHeaders(m *mail.Message) (inReplyTo string, refs []string) {
	switch {
	case m.IsOutbound && m.SESMessageID != nil:
		inReplyTo = "<" + *m.SESMessageID + "@email.amazonses.com>"
	case m.RFCMessageID != nil:
		inReplyTo = *m.RFCMessageID
	}
	refs = append(refs, m.References...)
	if inReplyTo != "" {
		refs = append(refs, inReplyTo)
	}
	return inReplyTo, refs
}

// quotePolicy cleans a received message before it goes back out inside a
// reply: no scripts, forms or event handlers travel onward under our name.
var quotePolicy = func() *bluemonday.Policy {
	p := bluemonday.UGCPolicy()
	p.AllowStyling()
	p.AllowAttrs("style").Globally()
	return p
}()

// Quote is the quoted original appended to a reply, styled inline and
// marked gmail_quote, which is what clients look for to fold it away.
func Quote(m *mail.Message) string {
	body := ""
	switch {
	case m.HTML != nil && *m.HTML != "":
		body = quotePolicy.Sanitize(*m.HTML)
	case m.Text != nil:
		body = addr.TextToHTML(*m.Text)
	}
	return `<br><br><div class="gmail_quote"><div class="gmail_attr">On ` +
		html.EscapeString(m.ReceivedAt.UTC().Format("Mon, 2 Jan 2006 at 15:04")) + `, ` + html.EscapeString(m.From.String()) +
		` wrote:<br></div><blockquote class="gmail_quote" style="margin:0 0 0 0.8ex;border-left:1px solid #ccc;padding-left:1ex">` +
		body + `</blockquote></div>`
}

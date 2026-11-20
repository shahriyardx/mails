package apiv1

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/shahriyardx/mails/internal/addr"
	"github.com/shahriyardx/mails/internal/apikey"
	"github.com/shahriyardx/mails/internal/events"
	"github.com/shahriyardx/mails/internal/httpx"
	"github.com/shahriyardx/mails/internal/mail"
	"github.com/shahriyardx/mails/internal/send"
)

// senderReach returns the mailboxes a send may use. A key that holds a
// whole domain may send from any address on it, so the mailbox is created
// (as SES allows) before the reach list is read.
func (a *API) senderReach(ctx context.Context, c *caller, from string) ([]string, error) {
	allowed, err := a.reach(ctx, c)
	if err != nil || allowed == nil {
		return allowed, err
	}
	f, ok := addr.Parse(from)
	if !ok {
		return nil, httpx.Invalid("from", "from: Not an email address")
	}
	if m, err := a.Mailboxes.Get(ctx, f.Address); err == nil {
		if within(allowed, m.ID) {
			return allowed, nil
		}
		return nil, httpx.Forbidden("This API key cannot send as " + f.Address)
	}
	covers, err := apikey.CoversDomainOf(ctx, a.DB, c.key.Reach, f.Address)
	if err != nil {
		return nil, err
	}
	if !covers {
		return nil, httpx.Forbidden("This API key cannot send as " + f.Address)
	}
	m, err := a.Mailboxes.ForSending(ctx, f.Address)
	if err != nil {
		return nil, httpx.Invalid("from", "from: "+f.Address+" is not on a domain verified for sending")
	}
	return append(allowed, m.ID), nil
}

func (a *API) doSend(ctx context.Context, c *caller, in send.Input) (*send.Result, error) {
	allowed, err := a.senderReach(ctx, c, in.From)
	if err != nil {
		return nil, err
	}
	in.Allowed, in.APIKeyID = allowed, c.key.ID
	return a.Send.Send(ctx, in)
}

func (a *API) sendEmail(w http.ResponseWriter, r *http.Request, c *caller) (int, any, error) {
	body, err := readBody(w, r)
	if err != nil {
		return 0, nil, err
	}
	var in send.Input
	if err := decodeStrict(body, &in); err != nil {
		return 0, nil, err
	}
	return a.idempotent(w, r, c, body, func() (int, any, error) {
		res, err := a.doSend(r.Context(), c, in)
		return 202, res, err
	})
}

type batchItem struct {
	Index    int     `json:"index"`
	OK       bool    `json:"ok"`
	ID       string  `json:"id,omitempty"`
	ThreadID string  `json:"thread_id,omitempty"`
	Status   *string `json:"delivery_status,omitempty"`
	Error    string  `json:"error,omitempty"`
	Code     int     `json:"status,omitempty"`
}

func (a *API) sendBatch(w http.ResponseWriter, r *http.Request, c *caller) (int, any, error) {
	body, err := readBody(w, r)
	if err != nil {
		return 0, nil, err
	}
	var list []json.RawMessage
	if json.Unmarshal(body, &list) != nil {
		var wrapped struct {
			Emails []json.RawMessage `json:"emails"`
		}
		if err := decodeStrict(body, &wrapped); err != nil {
			return 0, nil, err
		}
		list = wrapped.Emails
	}
	if len(list) == 0 || len(list) > 100 {
		return 0, nil, httpx.Invalid("emails", "Send 1 to 100 messages")
	}
	return a.idempotent(w, r, c, body, func() (int, any, error) {
		out := make([]batchItem, len(list))
		sent := 0
		// One at a time: SES meters sends per second.
		for i, raw := range list {
			out[i].Index = i
			var in send.Input
			err := decodeStrict(raw, &in)
			var res *send.Result
			if err == nil {
				res, err = a.doSend(r.Context(), c, in)
			}
			if err != nil {
				var he *httpx.Error
				out[i].Error, out[i].Code = err.Error(), 500
				if errors.As(err, &he) {
					out[i].Code = he.Status
				} else {
					out[i].Error = "The server failed to send this message"
				}
				continue
			}
			sent++
			out[i].OK, out[i].ID, out[i].ThreadID, out[i].Status = true, res.ID, res.ThreadID, &res.Status
		}
		status := 202
		if sent < len(list) {
			status = 207
		}
		return status, map[string]any{"object": "batch", "sent": sent, "failed": len(list) - sent, "data": out}, nil
	})
}

func (a *API) listEmails(_ http.ResponseWriter, r *http.Request, c *caller) (int, any, error) {
	f, err := mail.ParseMessageFilter(r.URL.Query())
	if err != nil {
		return 0, nil, err
	}
	if f.Allowed, err = a.reach(r.Context(), c); err != nil {
		return 0, nil, err
	}
	no := false
	f.Direction, f.Drafts, f.WithBody = "outbound", &no, false
	list, err := a.Mail.ListMessages(r.Context(), f)
	return 200, list, err
}

// messageID resolves an id or an SES message id to our id.
func (a *API) messageID(ctx context.Context, ref string) string {
	var id string
	if err := a.DB.QueryRow(ctx, `SELECT id FROM message WHERE id = $1 OR ses_message_id = $1 LIMIT 1`, ref).Scan(&id); err != nil {
		return ref
	}
	return id
}

func (a *API) getEmail(_ http.ResponseWriter, r *http.Request, c *caller) (int, any, error) {
	allowed, err := a.reach(r.Context(), c)
	if err != nil {
		return 0, nil, err
	}
	m, err := a.Mail.GetMessage(r.Context(), allowed, a.messageID(r.Context(), chi.URLParam(r, "id")))
	if err == nil && !m.IsOutbound {
		err = httpx.NotFound("No such email")
	}
	return 200, m, err
}

func (a *API) cancelEmail(_ http.ResponseWriter, r *http.Request, c *caller) (int, any, error) {
	allowed, err := a.reach(r.Context(), c)
	if err != nil {
		return 0, nil, err
	}
	id := a.messageID(r.Context(), chi.URLParam(r, "id"))
	if err := a.Send.Cancel(r.Context(), allowed, id); err != nil {
		return 0, nil, err
	}
	m, err := a.Mail.GetMessage(r.Context(), allowed, id)
	return 200, m, err
}

func (a *API) listThreads(_ http.ResponseWriter, r *http.Request, c *caller) (int, any, error) {
	f, err := mail.ParseThreadFilter(r.URL.Query())
	if err != nil {
		return 0, nil, err
	}
	if f.Allowed, err = a.reach(r.Context(), c); err != nil {
		return 0, nil, err
	}
	list, err := a.Mail.ListThreads(r.Context(), f)
	return 200, list, err
}

func (a *API) getThread(_ http.ResponseWriter, r *http.Request, c *caller) (int, any, error) {
	allowed, err := a.reach(r.Context(), c)
	if err != nil {
		return 0, nil, err
	}
	t, err := a.Mail.GetThread(r.Context(), allowed, chi.URLParam(r, "id"), r.URL.Query().Get("include_body") != "false")
	return 200, t, err
}

func (a *API) patchThread(_ http.ResponseWriter, r *http.Request, c *caller) (int, any, error) {
	var in mail.ThreadChange
	if err := httpx.Decode(r, &in); err != nil {
		return 0, nil, err
	}
	allowed, err := a.reach(r.Context(), c)
	if err != nil {
		return 0, nil, err
	}
	id := chi.URLParam(r, "id")
	if _, err := a.Mail.ChangeThreads(r.Context(), allowed, []string{id}, in); err != nil {
		return 0, nil, err
	}
	t, err := a.Mail.GetThread(r.Context(), allowed, id, false)
	if err != nil {
		return 0, nil, err
	}
	t.Messages = nil
	events.Emit(r.Context(), a.Events, events.Event{Type: "thread.updated", MailboxID: t.MailboxID,
		Data: map[string]any{"thread": t, "changes": in}})
	return 200, t, nil
}

func (a *API) replyThread(w http.ResponseWriter, r *http.Request, c *caller) (int, any, error) {
	var in send.ReplyInput
	if err := httpx.Bind(r, &in); err != nil {
		return 0, nil, err
	}
	allowed, err := a.reach(r.Context(), c)
	if err != nil {
		return 0, nil, err
	}
	in.Allowed, in.APIKeyID = allowed, c.key.ID
	res, err := a.Send.Reply(r.Context(), chi.URLParam(r, "id"), in)
	return 202, res, err
}

func (a *API) deleteThread(_ http.ResponseWriter, r *http.Request, c *caller) (int, any, error) {
	allowed, err := a.reach(r.Context(), c)
	if err != nil {
		return 0, nil, err
	}
	out, err := a.Mail.DeleteThreads(r.Context(), allowed, []string{chi.URLParam(r, "id")}, boolQuery(r, "permanent"))
	if err != nil {
		return 0, nil, err
	}
	return 200, out[0], nil
}

func (a *API) listMessages(_ http.ResponseWriter, r *http.Request, c *caller) (int, any, error) {
	f, err := mail.ParseMessageFilter(r.URL.Query())
	if err != nil {
		return 0, nil, err
	}
	if f.Allowed, err = a.reach(r.Context(), c); err != nil {
		return 0, nil, err
	}
	list, err := a.Mail.ListMessages(r.Context(), f)
	return 200, list, err
}

func (a *API) getMessage(_ http.ResponseWriter, r *http.Request, c *caller) (int, any, error) {
	allowed, err := a.reach(r.Context(), c)
	if err != nil {
		return 0, nil, err
	}
	m, err := a.Mail.GetMessage(r.Context(), allowed, a.messageID(r.Context(), chi.URLParam(r, "id")))
	return 200, m, err
}

func (a *API) patchMessage(_ http.ResponseWriter, r *http.Request, c *caller) (int, any, error) {
	var in mail.MessageChange
	if err := httpx.Decode(r, &in); err != nil {
		return 0, nil, err
	}
	allowed, err := a.reach(r.Context(), c)
	if err != nil {
		return 0, nil, err
	}
	m, err := a.Mail.ChangeMessage(r.Context(), allowed, chi.URLParam(r, "id"), in)
	return 200, m, err
}

func (a *API) rawMessage(w http.ResponseWriter, r *http.Request, c *caller) (int, any, error) {
	allowed, err := a.reach(r.Context(), c)
	if err != nil {
		return 0, nil, err
	}
	id := chi.URLParam(r, "id")
	obj, err := a.Mail.Raw(r.Context(), allowed, id)
	if err != nil {
		return 0, nil, err
	}
	mail.ServeObject(w, obj, id+".eml", "message/rfc822", false)
	return 0, nil, nil
}

func (a *API) getAttachment(w http.ResponseWriter, r *http.Request, c *caller) (int, any, error) {
	allowed, err := a.reach(r.Context(), c)
	if err != nil {
		return 0, nil, err
	}
	att, err := a.Mail.GetAttachment(r.Context(), allowed, chi.URLParam(r, "id"))
	if err != nil {
		return 0, nil, err
	}
	if boolQuery(r, "download") {
		obj, err := a.Mail.Open(r.Context(), att)
		if err != nil {
			return 0, nil, err
		}
		mail.ServeObject(w, obj, att.Filename, att.ContentType, false)
		return 0, nil, nil
	}
	u, err := a.Mail.DownloadURL(r.Context(), att)
	if err != nil {
		return 0, nil, err
	}
	return 200, struct {
		*mail.Attachment
		DownloadURL       string `json:"download_url"`
		DownloadExpiresIn int    `json:"download_url_expires_in"`
	}{att, u, int(mail.URLTTL.Seconds())}, nil
}

// mailboxInReach checks a mailbox id or address is one the key reaches.
func (a *API) mailboxInReach(ctx context.Context, c *caller, ref string) (string, error) {
	allowed, err := a.reach(ctx, c)
	if err != nil {
		return "", err
	}
	var id string
	err = a.DB.QueryRow(ctx, `SELECT id FROM mailbox WHERE id = $1 OR address = lower($1)`, ref).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && !within(allowed, id)) {
		return "", httpx.NotFound("No such mailbox")
	}
	if err != nil {
		return "", fmt.Errorf("find mailbox: %w", err)
	}
	return id, nil
}

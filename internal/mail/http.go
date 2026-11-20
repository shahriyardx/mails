package mail

import (
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/shahriyardx/mails/internal/auth"
	"github.com/shahriyardx/mails/internal/httpx"
	"github.com/shahriyardx/mails/internal/page"
	"github.com/shahriyardx/mails/internal/storage"
)

// ParseThreadFilter reads the thread list query string shared by the
// dashboard and /api/v1/threads.
func ParseThreadFilter(q url.Values) (ThreadFilter, error) {
	f := ThreadFilter{
		MailboxID: first(q, "mailbox_id", "mailbox"), Domain: q.Get("domain"), Folder: q.Get("folder"),
		Label: first(q, "label_id", "label"), Query: strings.TrimSpace(q.Get("q")),
		Participant: q.Get("participant"), Subject: q.Get("subject"),
	}
	var err error
	if f.Unread, err = boolParam(q, "unread"); err != nil {
		return f, err
	}
	if f.Starred, err = boolParam(q, "starred"); err != nil {
		return f, err
	}
	if f.HasAttachments, err = boolParam(q, "has_attachments"); err != nil {
		return f, err
	}
	if f.Since, err = timeParam(q, "since"); err != nil {
		return f, err
	}
	if f.Until, err = timeParam(q, "until"); err != nil {
		return f, err
	}
	f.Page, err = page.Parse(q)
	return f, err
}

// ParseMessageFilter reads the message list query string.
func ParseMessageFilter(q url.Values) (MessageFilter, error) {
	f := MessageFilter{
		MailboxID: first(q, "mailbox_id", "mailbox"), Domain: q.Get("domain"), Direction: q.Get("direction"),
		Folder: q.Get("folder"), ThreadID: q.Get("thread_id"), From: q.Get("from"), To: q.Get("to"),
		Subject: q.Get("subject"), Query: strings.TrimSpace(q.Get("q")), WithBody: q.Get("include_body") == "true",
	}
	var err error
	for name, dst := range map[string]**bool{"drafts": &f.Drafts, "unread": &f.Unread, "starred": &f.Starred} {
		if *dst, err = boolParam(q, name); err != nil {
			return f, err
		}
	}
	if f.Since, err = timeParam(q, "since"); err != nil {
		return f, err
	}
	if f.Until, err = timeParam(q, "until"); err != nil {
		return f, err
	}
	f.Page, err = page.Parse(q)
	return f, err
}

func first(q url.Values, keys ...string) string {
	for _, k := range keys {
		if v := q.Get(k); v != "" {
			return v
		}
	}
	return ""
}

func boolParam(q url.Values, name string) (*bool, error) {
	v := q.Get(name)
	if v == "" {
		return nil, nil
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return nil, httpx.Invalid(name, name+": true or false")
	}
	return &b, nil
}

func timeParam(q url.Values, name string) (*time.Time, error) {
	v := q.Get(name)
	if v == "" {
		return nil, nil
	}
	if t, err := time.Parse(time.RFC3339, v); err == nil {
		return &t, nil
	}
	if ms, err := strconv.ParseInt(v, 10, 64); err == nil {
		t := time.UnixMilli(ms)
		return &t, nil
	}
	return nil, httpx.Invalid(name, name+": An ISO 8601 time or milliseconds since 1970")
}

// ServeObject streams a stored file with a safe disposition. Inline is
// allowed only for images, which the dashboard shows in place.
func ServeObject(w http.ResponseWriter, obj *storage.Object, filename, contentType string, inline bool) {
	defer obj.Body.Close()
	kind := "attachment"
	if inline && strings.HasPrefix(contentType, "image/") && contentType != "image/svg+xml" {
		kind = "inline"
	}
	h := w.Header()
	h.Set("Content-Type", contentType)
	h.Set("Content-Disposition", storage.Disposition(kind, filename))
	h.Set("Content-Security-Policy", "default-src 'none'; sandbox")
	h.Set("Cache-Control", "private, max-age=300")
	if obj.Size > 0 {
		h.Set("Content-Length", strconv.FormatInt(obj.Size, 10))
	}
	_, _ = io.Copy(w, obj.Body)
}

type idsBody struct {
	IDs []string `json:"ids" validate:"required,min=1,max=500"`
}

// Routes is the dashboard API for mail, mounted at /api/app. The owner
// reaches every mailbox, so allowed is nil throughout.
func Routes(s *Service) http.Handler {
	r := chi.NewRouter()
	h := func(method, path string, fn httpx.Handler) { r.Method(method, path, fn) }

	h("GET", "/threads", func(w http.ResponseWriter, r *http.Request) error {
		f, err := ParseThreadFilter(r.URL.Query())
		if err != nil {
			return err
		}
		list, err := s.ListThreads(r.Context(), f)
		if err != nil {
			return err
		}
		httpx.JSON(w, 200, list)
		return nil
	})
	h("GET", "/threads/{id}", func(w http.ResponseWriter, r *http.Request) error {
		t, err := s.GetThread(r.Context(), nil, chi.URLParam(r, "id"), true)
		if err != nil {
			return err
		}
		httpx.JSON(w, 200, t)
		return nil
	})
	// Bulk change: {"ids": [...], "folder": "archive", ...}.
	h("PATCH", "/threads", func(w http.ResponseWriter, r *http.Request) error {
		var in struct {
			idsBody
			ThreadChange
		}
		if err := httpx.Bind(r, &in); err != nil {
			return err
		}
		ids, err := s.ChangeThreads(r.Context(), nil, in.IDs, in.ThreadChange)
		if err != nil {
			return err
		}
		httpx.JSON(w, 200, map[string]any{"ids": ids})
		return nil
	})
	h("POST", "/threads/restore", func(w http.ResponseWriter, r *http.Request) error {
		var in idsBody
		if err := httpx.Bind(r, &in); err != nil {
			return err
		}
		ids, err := s.RestoreThreads(r.Context(), nil, in.IDs)
		if err != nil {
			return err
		}
		httpx.JSON(w, 200, map[string]any{"ids": ids})
		return nil
	})
	h("POST", "/threads/delete", func(w http.ResponseWriter, r *http.Request) error {
		var in struct {
			idsBody
			Permanent bool `json:"permanent"`
		}
		if err := httpx.Bind(r, &in); err != nil {
			return err
		}
		out, err := s.DeleteThreads(r.Context(), nil, in.IDs, in.Permanent)
		if err != nil {
			return err
		}
		httpx.JSON(w, 200, map[string]any{"data": out})
		return nil
	})
	h("POST", "/trash/empty", func(w http.ResponseWriter, r *http.Request) error {
		n, err := s.EmptyTrash(r.Context(), nil, r.URL.Query().Get("mailbox"), r.URL.Query().Get("domain"))
		if err != nil {
			return err
		}
		httpx.JSON(w, 200, map[string]any{"threads": n})
		return nil
	})
	h("GET", "/counts", func(w http.ResponseWriter, r *http.Request) error {
		c, err := s.Counts(r.Context(), nil, r.URL.Query().Get("mailbox"), r.URL.Query().Get("domain"))
		if err != nil {
			return err
		}
		httpx.JSON(w, 200, c)
		return nil
	})

	h("GET", "/messages/{id}", func(w http.ResponseWriter, r *http.Request) error {
		m, err := s.GetMessage(r.Context(), nil, chi.URLParam(r, "id"))
		if err != nil {
			return err
		}
		httpx.JSON(w, 200, m)
		return nil
	})
	h("PATCH", "/messages/{id}", func(w http.ResponseWriter, r *http.Request) error {
		var c MessageChange
		if err := httpx.Bind(r, &c); err != nil {
			return err
		}
		m, err := s.ChangeMessage(r.Context(), nil, chi.URLParam(r, "id"), c)
		if err != nil {
			return err
		}
		httpx.JSON(w, 200, m)
		return nil
	})
	h("GET", "/messages/{id}/raw", func(w http.ResponseWriter, r *http.Request) error {
		obj, err := s.Raw(r.Context(), nil, chi.URLParam(r, "id"))
		if err != nil {
			return err
		}
		ServeObject(w, obj, chi.URLParam(r, "id")+".eml", "message/rfc822", false)
		return nil
	})

	h("GET", "/attachments/{id}", func(w http.ResponseWriter, r *http.Request) error {
		a, err := s.GetAttachment(r.Context(), nil, chi.URLParam(r, "id"))
		if err != nil {
			return err
		}
		obj, err := s.Open(r.Context(), a)
		if err != nil {
			return err
		}
		ServeObject(w, obj, a.Filename, a.ContentType, r.URL.Query().Get("inline") == "true")
		return nil
	})
	h("POST", "/uploads", func(w http.ResponseWriter, r *http.Request) error {
		a, err := stageFromMultipart(w, r, s)
		if err != nil {
			return err
		}
		httpx.JSON(w, 201, a)
		return nil
	})

	h("GET", "/labels", func(w http.ResponseWriter, r *http.Request) error {
		list, err := s.ListLabels(r.Context())
		if err != nil {
			return err
		}
		httpx.JSON(w, 200, page.Of(list))
		return nil
	})
	h("POST", "/labels", func(w http.ResponseWriter, r *http.Request) error {
		var in LabelInput
		if err := httpx.Decode(r, &in); err != nil {
			return err
		}
		l, err := s.CreateLabel(r.Context(), in)
		if err != nil {
			return err
		}
		httpx.JSON(w, 201, l)
		return nil
	})
	h("PATCH", "/labels/{id}", func(w http.ResponseWriter, r *http.Request) error {
		var in LabelInput
		if err := httpx.Decode(r, &in); err != nil {
			return err
		}
		l, err := s.UpdateLabel(r.Context(), chi.URLParam(r, "id"), in)
		if err != nil {
			return err
		}
		httpx.JSON(w, 200, l)
		return nil
	})
	h("DELETE", "/labels/{id}", func(w http.ResponseWriter, r *http.Request) error {
		l, err := s.DeleteLabel(r.Context(), chi.URLParam(r, "id"))
		if err != nil {
			return err
		}
		httpx.JSON(w, 200, map[string]any{"object": "label", "id": l.ID, "deleted": true})
		return nil
	})

	h("GET", "/filters", func(w http.ResponseWriter, r *http.Request) error {
		list, err := s.ListFilters(r.Context())
		if err != nil {
			return err
		}
		httpx.JSON(w, 200, page.Of(list))
		return nil
	})
	saveFilter := func(w http.ResponseWriter, r *http.Request) error {
		var f Filter
		if err := httpx.Decode(r, &f); err != nil {
			return err
		}
		f.ID = chi.URLParam(r, "id")
		out, err := s.SaveFilter(r.Context(), f)
		if err != nil {
			return err
		}
		httpx.JSON(w, 200, out)
		return nil
	}
	h("POST", "/filters", saveFilter)
	h("PUT", "/filters/{id}", saveFilter)
	h("DELETE", "/filters/{id}", func(w http.ResponseWriter, r *http.Request) error {
		if err := s.DeleteFilter(r.Context(), chi.URLParam(r, "id")); err != nil {
			return err
		}
		w.WriteHeader(http.StatusNoContent)
		return nil
	})

	h("GET", "/contacts", func(w http.ResponseWriter, r *http.Request) error {
		p, err := page.Parse(r.URL.Query())
		if err != nil {
			return err
		}
		list, err := s.ListContacts(r.Context(), r.URL.Query().Get("q"), r.URL.Query().Get("order"), p)
		if err != nil {
			return err
		}
		httpx.JSON(w, 200, list)
		return nil
	})

	h("GET", "/image-trust", func(w http.ResponseWriter, r *http.Request) error {
		var senders []string
		if v := r.URL.Query().Get("senders"); v != "" {
			senders = strings.Split(v, ",")
		}
		m, err := s.ImageChoices(r.Context(), senders)
		if err != nil {
			return err
		}
		httpx.JSON(w, 200, m)
		return nil
	})
	h("PUT", "/image-trust", func(w http.ResponseWriter, r *http.Request) error {
		var in struct {
			Sender  string `json:"sender" validate:"required"`
			Allowed bool   `json:"allowed"`
		}
		if err := httpx.Bind(r, &in); err != nil {
			return err
		}
		if err := s.TrustImages(r.Context(), in.Sender, in.Allowed); err != nil {
			return err
		}
		w.WriteHeader(http.StatusNoContent)
		return nil
	})

	h("GET", "/preferences", func(w http.ResponseWriter, r *http.Request) error {
		p, err := s.GetPreferences(r.Context(), auth.FromContext(r.Context()).ID)
		if err != nil {
			return err
		}
		httpx.JSON(w, 200, p)
		return nil
	})
	h("PATCH", "/preferences", func(w http.ResponseWriter, r *http.Request) error {
		var in Preferences
		if err := httpx.Decode(r, &in); err != nil {
			return err
		}
		p, err := s.SavePreferences(r.Context(), auth.FromContext(r.Context()).ID, in)
		if err != nil {
			return err
		}
		httpx.JSON(w, 200, p)
		return nil
	})
	return r
}

// stageFromMultipart streams the first file part of a multipart body to
// storage without buffering it.
func stageFromMultipart(w http.ResponseWriter, r *http.Request, s *Service) (*Attachment, error) {
	r.Body = http.MaxBytesReader(w, r.Body, MaxUpload+1<<20)
	mr, err := r.MultipartReader()
	if err != nil {
		return nil, httpx.Invalid("file", "Send the file as multipart/form-data")
	}
	for {
		part, err := mr.NextPart()
		if err == io.EOF {
			return nil, httpx.Invalid("file", "file: Required")
		}
		if err != nil {
			return nil, httpx.Invalid("file", "Could not read the upload")
		}
		if part.FormName() != "file" || part.FileName() == "" {
			continue
		}
		defer part.Close()
		return s.Stage(r.Context(), part.FileName(), part.Header.Get("Content-Type"), part)
	}
}

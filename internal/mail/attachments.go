package mail

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/shahriyardx/mails/internal/httpx"
	"github.com/shahriyardx/mails/internal/id"
	"github.com/shahriyardx/mails/internal/storage"
)

// MaxUpload is the largest file the composer may stage. SES caps a whole
// message at 40 MB, and base64 grows files by a third.
const MaxUpload = 25 << 20

// URLTTL is how long a signed download link works.
const URLTTL = 5 * time.Minute

// GetAttachment returns a file on a message allowed reaches. Staged uploads
// (no message yet) are not reachable this way.
func (s *Service) GetAttachment(ctx context.Context, allowed []string, attID string) (*Attachment, error) {
	var w where
	w.add("a.id = ?", attID)
	w.scope("m.mailbox_id", allowed, "", "")
	rows, _ := s.DB.Query(ctx, `SELECT `+attachmentColumns+` FROM attachment a JOIN message m ON m.id = a.message_id `+w.sql(), w.args...)
	a, err := pgx.CollectExactlyOneRow(rows, pgx.RowToAddrOfStructByName[Attachment])
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, httpx.NotFound("No such attachment")
	}
	if err != nil {
		return nil, fmt.Errorf("get attachment: %w", err)
	}
	a.Object = "attachment"
	return a, nil
}

// DownloadURL is a signed link straight to storage, so bytes skip the app.
func (s *Service) DownloadURL(ctx context.Context, a *Attachment) (string, error) {
	return s.Store.URL(ctx, a.R2Key, a.Filename, URLTTL)
}

// Open streams an attachment's bytes.
func (s *Service) Open(ctx context.Context, a *Attachment) (*storage.Object, error) {
	obj, err := s.Store.Get(ctx, a.R2Key)
	if errors.Is(err, storage.ErrNotFound) {
		return nil, httpx.NotFound("The file is no longer in storage")
	}
	return obj, err
}

// Stage stores a file for a message not written yet. body is streamed to
// R2; at most MaxUpload bytes are accepted.
func (s *Service) Stage(ctx context.Context, filename, contentType string, body io.Reader) (*Attachment, error) {
	filename = strings.TrimSpace(filename)
	if filename == "" {
		filename = "attachment"
	}
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	attID := id.New("att")
	key := "uploads/" + attID
	counted := &countingReader{r: io.LimitReader(body, MaxUpload+1)}
	if err := s.Store.Put(ctx, key, counted, contentType); err != nil {
		return nil, err
	}
	if counted.n > MaxUpload {
		_ = s.Store.Delete(context.WithoutCancel(ctx), key)
		return nil, &httpx.Error{Status: 413, Code: "payload_too_large", Message: "Files are limited to 25 MB"}
	}
	_, err := s.DB.Exec(ctx, `INSERT INTO attachment (id, filename, content_type, size_bytes, r2_key) VALUES ($1, $2, $3, $4, $5)`,
		attID, filename, contentType, counted.n, key)
	if err != nil {
		return nil, fmt.Errorf("insert staged file: %w", err)
	}
	return &Attachment{Object: "attachment", ID: attID, Filename: filename, ContentType: contentType,
		SizeBytes: int(counted.n), R2Key: key, CreatedAt: time.Now()}, nil
}

// SweepStaged deletes uploads that never joined a message within a day.
func (s *Service) SweepStaged(ctx context.Context) error {
	rows, _ := s.DB.Query(ctx, `DELETE FROM attachment WHERE message_id IS NULL AND created_at < now() - interval '1 day' RETURNING r2_key`)
	keys, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return fmt.Errorf("sweep staged: %w", err)
	}
	s.forget(keys)
	return nil
}

type countingReader struct {
	r io.Reader
	n int64
}

func (c *countingReader) Read(p []byte) (int, error) {
	n, err := c.r.Read(p)
	c.n += int64(n)
	return n, err
}

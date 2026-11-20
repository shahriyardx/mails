// Package storage keeps attachment and raw message bytes in Cloudflare R2
// (S3 API). Bodies are streamed both ways; nothing large is held in memory.
package storage

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/feature/s3/manager"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
)

// ErrNotFound means no object has that key.
var ErrNotFound = errors.New("object not found")

// Object is a stored file being read. Close Body when done.
type Object struct {
	Body        io.ReadCloser
	Size        int64
	ContentType string
}

// Store is what Mails asks of object storage.
type Store interface {
	Put(ctx context.Context, key string, body io.Reader, contentType string) error
	Get(ctx context.Context, key string) (*Object, error)
	Delete(ctx context.Context, keys ...string) error
	// URL is a short-lived signed GET link that downloads as filename.
	URL(ctx context.Context, key, filename string, ttl time.Duration) (string, error)
}

type r2 struct {
	client   *s3.Client
	presign  *s3.PresignClient
	uploader *manager.Uploader
	bucket   string
}

// NewR2 connects to an R2 bucket.
func NewR2(accountID, accessKey, secretKey, bucket string) Store {
	client := s3.New(s3.Options{
		Region:       "auto",
		BaseEndpoint: aws.String("https://" + accountID + ".r2.cloudflarestorage.com"),
		Credentials:  credentials.NewStaticCredentialsProvider(accessKey, secretKey, ""),
	})
	return &r2{
		client:  client,
		presign: s3.NewPresignClient(client),
		// One part in flight keeps an upload's memory at one 5 MB part.
		uploader: manager.NewUploader(client, func(u *manager.Uploader) { u.Concurrency = 1 }),
		bucket:   bucket,
	}
}

func (s *r2) Put(ctx context.Context, key string, body io.Reader, contentType string) error {
	_, err := s.uploader.Upload(ctx, &s3.PutObjectInput{
		Bucket: &s.bucket, Key: &key, Body: body, ContentType: &contentType,
	})
	if err != nil {
		return fmt.Errorf("r2 put %s: %w", key, err)
	}
	return nil
}

func (s *r2) Get(ctx context.Context, key string) (*Object, error) {
	out, err := s.client.GetObject(ctx, &s3.GetObjectInput{Bucket: &s.bucket, Key: &key})
	var nsk *types.NoSuchKey
	if errors.As(err, &nsk) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("r2 get %s: %w", key, err)
	}
	return &Object{Body: out.Body, Size: aws.ToInt64(out.ContentLength), ContentType: aws.ToString(out.ContentType)}, nil
}

func (s *r2) Delete(ctx context.Context, keys ...string) error {
	for len(keys) > 0 {
		n := min(len(keys), 1000)
		ids := make([]types.ObjectIdentifier, n)
		for i, k := range keys[:n] {
			ids[i] = types.ObjectIdentifier{Key: aws.String(k)}
		}
		if _, err := s.client.DeleteObjects(ctx, &s3.DeleteObjectsInput{
			Bucket: &s.bucket, Delete: &types.Delete{Objects: ids, Quiet: aws.Bool(true)},
		}); err != nil {
			return fmt.Errorf("r2 delete: %w", err)
		}
		keys = keys[n:]
	}
	return nil
}

func (s *r2) URL(ctx context.Context, key, filename string, ttl time.Duration) (string, error) {
	out, err := s.presign.PresignGetObject(ctx, &s3.GetObjectInput{
		Bucket: &s.bucket, Key: &key, ResponseContentDisposition: aws.String(Disposition("attachment", filename)),
	}, s3.WithPresignExpires(ttl))
	if err != nil {
		return "", fmt.Errorf("r2 presign %s: %w", key, err)
	}
	return out.URL, nil
}

// Disposition builds a Content-Disposition value. Quotes, backslashes and
// control characters are stripped so a filename cannot write its own
// headers; a non-ASCII name is also given in RFC 5987 form.
func Disposition(kind, filename string) string {
	clean := strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f || r == '"' || r == '\\' {
			return -1
		}
		return r
	}, filename)
	ascii := strings.Map(func(r rune) rune {
		if r > 0x7e {
			return '_'
		}
		return r
	}, clean)
	v := kind + `; filename="` + ascii + `"`
	if ascii != clean {
		v += "; filename*=UTF-8''" + url.PathEscape(clean)
	}
	return v
}

// Memory is an in-process Store for tests and for running without R2.
type Memory struct {
	mu    sync.Mutex
	files map[string]memFile
}

type memFile struct {
	data []byte
	ct   string
}

func NewMemory() *Memory { return &Memory{files: map[string]memFile{}} }

func (m *Memory) Put(_ context.Context, key string, body io.Reader, contentType string) error {
	b, err := io.ReadAll(body)
	if err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.files[key] = memFile{b, contentType}
	return nil
}

func (m *Memory) Get(_ context.Context, key string) (*Object, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	f, ok := m.files[key]
	if !ok {
		return nil, ErrNotFound
	}
	return &Object{Body: io.NopCloser(bytes.NewReader(f.data)), Size: int64(len(f.data)), ContentType: f.ct}, nil
}

func (m *Memory) Delete(_ context.Context, keys ...string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, k := range keys {
		delete(m.files, k)
	}
	return nil
}

func (m *Memory) URL(_ context.Context, key, _ string, _ time.Duration) (string, error) {
	return "memory://" + key, nil
}

// Has reports whether key is stored.
func (m *Memory) Has(key string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	_, ok := m.files[key]
	return ok
}

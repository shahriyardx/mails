package send

import (
	"bytes"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/emersion/go-message/mail"

	"github.com/shahriyardx/mails/internal/addr"
)

func TestBuildRoundTrip(t *testing.T) {
	raw, err := Build(Mail{
		From:       addr.Address{Name: "Zoë Example", Address: "zoe@a.test"},
		To:         []addr.Address{{Name: "Ada", Address: "ada@b.test"}},
		Cc:         []addr.Address{{Address: "cc@b.test"}},
		Subject:    "Héllo",
		Text:       "plain",
		HTML:       "<p>html</p>",
		MessageID:  "abc@a.test",
		InReplyTo:  "<parent@b.test>",
		References: []string{"<root@b.test>", "<parent@b.test>"},
		Headers:    map[string]string{"X-Order": "42"},
		Files:      []File{{Name: "a.txt", ContentType: "text/plain", Data: []byte("file")}, {Name: "logo.png", ContentType: "image/png", ContentID: "logo", Data: []byte{1, 2}}},
		Date:       time.Date(2026, 11, 20, 0, 0, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(bytes.ToLower(raw), []byte("\nbcc:")) {
		t.Fatal("Bcc header written")
	}
	r, err := mail.CreateReader(bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	subject, _ := r.Header.Subject()
	id, _ := r.Header.MessageID()
	from, _ := r.Header.AddressList("From")
	if subject != "Héllo" || id != "abc@a.test" || from[0].Name != "Zoë Example" || r.Header.Get("X-Order") != "42" {
		t.Fatalf("headers: subject=%q id=%q from=%v", subject, id, from)
	}
	if r.Header.Get("In-Reply-To") != "<parent@b.test>" || !strings.Contains(r.Header.Get("References"), "<root@b.test>") {
		t.Fatalf("threading headers: %q %q", r.Header.Get("In-Reply-To"), r.Header.Get("References"))
	}
	var texts, files []string
	for {
		p, err := r.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		b, _ := io.ReadAll(p.Body)
		switch h := p.Header.(type) {
		case *mail.InlineHeader:
			ct, _, _ := h.ContentType()
			if strings.HasPrefix(ct, "text/") {
				texts = append(texts, string(b))
			} else {
				files = append(files, "inline:"+ct)
			}
		case *mail.AttachmentHeader:
			name, _ := h.Filename()
			files = append(files, name)
		}
	}
	if len(texts) != 2 || texts[0] != "plain" || texts[1] != "<p>html</p>" {
		t.Fatalf("bodies = %q", texts)
	}
	if strings.Join(files, ",") != "a.txt,inline:image/png" && strings.Join(files, ",") != "inline:image/png,a.txt" {
		t.Fatalf("files = %v", files)
	}
}

func TestCheckHeaders(t *testing.T) {
	tests := []struct {
		h  map[string]string
		ok bool
	}{
		{map[string]string{"X-Fine": "yes"}, true},
		{map[string]string{"From": "evil@x"}, false},
		{map[string]string{"bcc": "x"}, false},
		{map[string]string{"X-Inject": "a\r\nBcc: victim@x"}, false},
		{map[string]string{"Bad Name": "x"}, false},
	}
	for _, tt := range tests {
		if err := CheckHeaders(tt.h); (err == nil) != tt.ok {
			t.Errorf("%v: err = %v", tt.h, err)
		}
	}
}

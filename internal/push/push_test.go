package push_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/shahriyardx/mails/internal/db/dbtest"
	"github.com/shahriyardx/mails/internal/push"
)

func TestNotifyDropsGoneAndFailing(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()
	results := map[string]struct {
		status int
		err    error
	}{
		"https://ok.push.example.com/x":    {201, nil},
		"https://gone.push.example.com/x":  {410, nil},
		"https://flaky.push.example.com/x": {0, errors.New("timeout")},
	}
	s := &push.Service{DB: pool, Send: func(_ context.Context, sub push.Subscription, _ []byte) (int, error) {
		r := results[sub.Endpoint]
		return r.status, r.err
	}, CheckURL: func(_ context.Context, u string) error {
		if !strings.HasPrefix(u, "https://") {
			return errors.New("not https")
		}
		return nil
	}}
	if err := s.Subscribe(ctx, push.Subscription{Endpoint: "http://insecure.test", P256dh: "k", Auth: "a"}, ""); err == nil {
		t.Fatal("accepted a non-https endpoint")
	}
	for e := range results {
		if err := s.Subscribe(ctx, push.Subscription{Endpoint: e, P256dh: "k", Auth: "a"}, "laptop"); err != nil {
			t.Fatal(err)
		}
	}
	for range 8 {
		s.Notify(ctx, push.Payload{Title: "t"})
	}
	list, _ := s.Browsers(ctx)
	if len(list) != 1 || list[0].Endpoint != "https://ok.push.example.com/x" {
		t.Fatalf("left = %+v", list)
	}
	off := &push.Service{DB: pool}
	off.Notify(ctx, push.Payload{}) // must not panic with push off
}

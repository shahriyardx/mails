package server

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestChiJoin(t *testing.T) {
	a, b := chi.NewRouter(), chi.NewRouter()
	a.Get("/threads/{id}", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("a:" + chi.URLParam(r, "id"))) })
	b.Post("/threads/{id}/reply", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("b:" + chi.URLParam(r, "id"))) })
	root := chi.NewRouter()
	root.Route("/api/app", func(r chi.Router) { r.Mount("/", chiJoin(a, b)) })

	tests := []struct {
		method, path, want string
		code               int
	}{
		{"GET", "/api/app/threads/t1", "a:t1", 200},
		{"POST", "/api/app/threads/t1/reply", "b:t1", 200},
		{"DELETE", "/api/app/threads/t1", "", 404},
	}
	for _, tt := range tests {
		w := httptest.NewRecorder()
		root.ServeHTTP(w, httptest.NewRequest(tt.method, tt.path, nil))
		if w.Code != tt.code || (tt.want != "" && w.Body.String() != tt.want) {
			t.Errorf("%s %s = %d %q", tt.method, tt.path, w.Code, w.Body)
		}
	}
}

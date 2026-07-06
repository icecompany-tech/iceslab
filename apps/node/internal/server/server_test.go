package server

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/icecompany-tech/iceslab/apps/node/internal/dto"
	"github.com/icecompany-tech/iceslab/apps/node/internal/payload"
)

// newTestServer builds a Server bound to a discardable logger and a dummy
// payload. The PEM material here is never parsed, `routes()` only constructs
// the mux, not the TLS layer.
func newTestServer(t *testing.T) *Server {
	t.Helper()
	srv, err := New(Config{
		Logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		Payload: &payload.Payload{
			NodeCertPem: "x", NodeKeyPem: "y", CACertPem: "z",
		},
	})
	if err != nil {
		t.Fatalf("new: %v", err)
	}
	return srv
}

func TestHandleHealth(t *testing.T) {
	srv := newTestServer(t)

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rr := httptest.NewRecorder()
	srv.routes().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status: got %d want 200", rr.Code)
	}
	var body dto.HealthcheckResponse
	if err := json.NewDecoder(rr.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Status != "ok" {
		t.Errorf("status: got %q want ok", body.Status)
	}
}

func TestHandleHealthRejectsPost(t *testing.T) {
	srv := newTestServer(t)

	req := httptest.NewRequest(http.MethodPost, "/healthz", nil)
	rr := httptest.NewRecorder()
	srv.routes().ServeHTTP(rr, req)

	if rr.Code != http.StatusMethodNotAllowed {
		t.Errorf("status: got %d want 405", rr.Code)
	}
}

func TestHandleAddUser(t *testing.T) {
	srv := newTestServer(t)

	body := `{"userId":"u-1","shortId":"s-1","username":"alice","credentials":{"hysteriaPassword":"hp"}}`
	req := httptest.NewRequest(http.MethodPost, "/addUser", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.routes().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status: got %d want 200; body=%s", rr.Code, rr.Body.String())
	}
	var resp dto.AddUserResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !resp.OK {
		t.Errorf("ok: got false want true")
	}
}

func TestHandleAddUserRejectsInvalidJSON(t *testing.T) {
	srv := newTestServer(t)

	req := httptest.NewRequest(http.MethodPost, "/addUser", strings.NewReader("{ broken"))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.routes().ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("status: got %d want 400", rr.Code)
	}
}

func TestHandleRemoveUser(t *testing.T) {
	srv := newTestServer(t)

	body := `{"userId":"u-1"}`
	req := httptest.NewRequest(http.MethodPost, "/removeUser", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.routes().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status: got %d want 200; body=%s", rr.Code, rr.Body.String())
	}
}

func TestHandleStats(t *testing.T) {
	srv := newTestServer(t)
	// startedAt left at its newTestServer default, fine for this stub.

	req := httptest.NewRequest(http.MethodGet, "/stats", nil)
	rr := httptest.NewRecorder()
	srv.routes().ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status: got %d want 200", rr.Code)
	}
	var resp dto.GetStatsResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Users == nil {
		t.Errorf("users should be non-nil empty slice, got nil")
	}
}

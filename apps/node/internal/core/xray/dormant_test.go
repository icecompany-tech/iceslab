package xray

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	"github.com/icecompany-tech/iceslab/apps/node/internal/core"
)

/*
A node between install and its first push has no door, and adding a user to it
should cost nothing.

Until now every AddUser on such a node rendered a config, asked the core to
validate it, restarted, and arrived at a config serving nobody, printing a
warning on the way. The panel re-sends its whole roster on every poll, so that
was a warning per user per poll about a state which is not an error: the node is
simply waiting for its first inbound.

⚠ The dormant condition is NOT "the install-time REALITY key is empty". That is
the normal state of every panel-provisioned node, and skipping the render there
would mean users never reach the config at all. Both tests below exist to hold
that line: one for the dormant node, one for the ordinary one.
*/
func dormantAdapter(t *testing.T, inbound InboundConfig, binary string) (*Adapter, *[][]string) {
	t.Helper()
	calls := &[][]string{}
	a := New(Config{
		BinaryPath: binary,
		ConfigPath: filepath.Join(t.TempDir(), "config.json"),
		Inbound:    inbound,
		RunCmd: func(_ context.Context, name string, args ...string) ([]byte, error) {
			*calls = append(*calls, append([]string{name}, args...))
			return nil, nil
		},
	}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	return a, calls
}

func TestAddUserOnANodeWithNoInboundTouchesNothing(t *testing.T) {
	// No pushed inbound and no install-time key: nothing to render onto.
	a, calls := dormantAdapter(t, InboundConfig{}, "/usr/bin/xray")

	if err := a.AddUser(core.User{UserID: "alice", XrayUUID: "11111111-2222-3333-4444-555555555555"}); err != nil {
		t.Fatalf("AddUser: %v", err)
	}
	if len(*calls) != 0 {
		t.Fatalf("the core was called for a node with nothing to serve: %v", *calls)
	}
	if _, err := os.Stat(a.cfg.ConfigPath); err == nil {
		t.Fatal("a config was written for a node with no inbound")
	}
	// Cached, which is the whole point: the user is not lost, they are waiting.
	a.mu.Lock()
	_, cached := a.users["alice"]
	a.mu.Unlock()
	if !cached {
		t.Fatal("the user was neither rendered nor remembered")
	}

	// And removing them is just as quiet.
	if err := a.RemoveUser("alice"); err != nil {
		t.Fatalf("RemoveUser: %v", err)
	}
	if len(*calls) != 0 {
		t.Fatalf("the core was called to remove a user from a node with nothing to serve: %v", *calls)
	}
	a.mu.Lock()
	_, stillThere := a.users["alice"]
	a.mu.Unlock()
	if stillThere {
		t.Fatal("the user is still cached after being removed")
	}
}

func TestTheFirstInboundFlushesTheWaitingUsers(t *testing.T) {
	// The other half: what was cached has to arrive the moment there is
	// somewhere for it to go, without the panel sending it again.
	// Config-only: no binary, so nothing is spawned and the proof is the file
	// that lands on disk, the same arrangement the cascade goldens use.
	a, calls := dormantAdapter(t, InboundConfig{}, "")
	if err := a.AddUser(core.User{UserID: "alice", XrayUUID: "11111111-2222-3333-4444-555555555555"}); err != nil {
		t.Fatalf("AddUser: %v", err)
	}

	cfg, err := json.Marshal(map[string]any{
		"security":           "reality",
		"realityDest":        "www.microsoft.com:443",
		"realityServerNames": []string{"www.microsoft.com"},
		"realityPrivateKey":  "k1k1k1k1k1k1k1k1k1k1k1k1k1k1k1k1k1k1k1k1k1k",
		"realityShortIds":    []string{"0123abcd"},
		"network":            "raw",
		"id":                 "ib-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := a.ApplyInbound(443, cfg); err != nil {
		t.Fatalf("ApplyInbound: %v", err)
	}

	blob, err := os.ReadFile(a.cfg.ConfigPath)
	if err != nil {
		t.Fatalf("no config after the first push: %v", err)
	}
	if !containsUser(blob, "alice") {
		t.Fatalf("the user cached before the push is not in the config:\n%s", blob)
	}
	_ = calls
}

func TestAddUserOnAPushedNodeStillRenders(t *testing.T) {
	// The line this change must not cross. A panel-provisioned node has an
	// empty install-time key by design; its users must still reach the config.
	a, calls := dormantAdapter(t, InboundConfig{}, "")
	cfg, err := json.Marshal(map[string]any{
		"security":           "reality",
		"realityDest":        "www.microsoft.com:443",
		"realityServerNames": []string{"www.microsoft.com"},
		"realityPrivateKey":  "k1k1k1k1k1k1k1k1k1k1k1k1k1k1k1k1k1k1k1k1k1k",
		"realityShortIds":    []string{"0123abcd"},
		"network":            "raw",
		"id":                 "ib-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := a.ApplyInbound(443, cfg); err != nil {
		t.Fatalf("ApplyInbound: %v", err)
	}
	before, err := os.ReadFile(a.cfg.ConfigPath)
	if err != nil {
		t.Fatal(err)
	}
	if containsUser(before, "bob") {
		t.Fatal("bob is in the config before being added, so this test proves nothing")
	}

	if err := a.AddUser(core.User{UserID: "bob", XrayUUID: "22222222-3333-4444-5555-666666666666"}); err != nil {
		t.Fatalf("AddUser: %v", err)
	}
	blob, err := os.ReadFile(a.cfg.ConfigPath)
	if err != nil {
		t.Fatal(err)
	}
	if !containsUser(blob, "bob") {
		t.Fatalf("the user is not in the config of a node that has an inbound:\n%s", blob)
	}
	_ = calls
}

func containsUser(blob []byte, email string) bool {
	var doc struct {
		Inbounds []struct {
			Settings struct {
				Clients []struct {
					Email string `json:"email"`
				} `json:"clients"`
			} `json:"settings"`
		} `json:"inbounds"`
	}
	if err := json.Unmarshal(blob, &doc); err != nil {
		return false
	}
	for _, ib := range doc.Inbounds {
		for _, c := range ib.Settings.Clients {
			if c.Email == email {
				return true
			}
		}
	}
	return false
}

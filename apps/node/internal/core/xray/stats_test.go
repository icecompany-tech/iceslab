package xray

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestParseStatName(t *testing.T) {
	cases := []struct {
		in        string
		userID    string
		direction string
		ok        bool
	}{
		{"user>>>u-1>>>traffic>>>uplink", "u-1", "uplink", true},
		{"user>>>u-2>>>traffic>>>downlink", "u-2", "downlink", true},
		{"inbound>>>vless-in>>>traffic>>>uplink", "", "", false}, // wrong prefix
		{"user>>>u-3>>>other>>>uplink", "", "", false},           // non-traffic
		{"user>>>u-4>>>traffic>>>sideways", "", "", false},       // unknown direction
		{"user>>>u-5>>>traffic", "", "", false},                  // too few parts
		{"", "", "", false},
	}
	for _, c := range cases {
		uid, dir, ok := parseStatName(c.in)
		if uid != c.userID || dir != c.direction || ok != c.ok {
			t.Errorf("parseStatName(%q) = (%q,%q,%v) want (%q,%q,%v)",
				c.in, uid, dir, ok, c.userID, c.direction, c.ok)
		}
	}
}

func TestParseInt64String(t *testing.T) {
	cases := []struct {
		in   string
		want int64
		err  bool
	}{
		{"0", 0, false},
		{"123", 123, false},
		{"9223372036854775807", 9223372036854775807, false}, // max int64
		{"abc", 0, true},
		{"-5", 0, true}, // negative not expected for byte counters
		{"", 0, false},  // 0 — empty string parses as zero (no digits → no iterations)
	}
	for _, c := range cases {
		got, err := parseInt64String(c.in)
		if c.err && err == nil {
			t.Errorf("parseInt64String(%q): expected error", c.in)
		}
		if !c.err && err != nil {
			t.Errorf("parseInt64String(%q): unexpected error %v", c.in, err)
		}
		if got != c.want && !c.err {
			t.Errorf("parseInt64String(%q) = %d want %d", c.in, got, c.want)
		}
	}
}

func TestQueryUserStats_AggregatesUplinkAndDownlink(t *testing.T) {
	mockOutput := []byte(`{"stat":[
		{"name":"user>>>alice>>>traffic>>>uplink","value":"1000"},
		{"name":"user>>>alice>>>traffic>>>downlink","value":"2000"},
		{"name":"user>>>bob>>>traffic>>>uplink","value":"500"}
	]}`)
	run := func(_ context.Context, name string, args ...string) ([]byte, error) {
		// Verify command shape
		if name != "/usr/local/bin/xray" {
			t.Errorf("expected xray binary, got %q", name)
		}
		joined := strings.Join(args, " ")
		if !strings.Contains(joined, "api statsquery") {
			t.Errorf("expected `api statsquery` in args, got %v", args)
		}
		// #5 - the read must be non-destructive (no -reset) so per-user counters
		// stay cumulative and the panel computes deltas against its snapshot.
		if strings.Contains(joined, "-reset") {
			t.Errorf("did not expect `-reset` (read must be non-destructive), got %v", args)
		}
		if !strings.Contains(joined, "-pattern user") {
			t.Errorf("expected `-pattern user` in args, got %v", args)
		}
		if !strings.Contains(joined, "127.0.0.1:8080") {
			t.Errorf("expected 127.0.0.1:8080 server, got %v", args)
		}
		return mockOutput, nil
	}

	got, err := queryUserStats(context.Background(), run, "/usr/local/bin/xray", 8080)
	if err != nil {
		t.Fatalf("queryUserStats: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("expected 2 users, got %d: %+v", len(got), got)
	}
	if got["alice"].UplinkBytes != 1000 || got["alice"].DownlinkBytes != 2000 {
		t.Errorf("alice: got %+v", got["alice"])
	}
	if got["bob"].UplinkBytes != 500 || got["bob"].DownlinkBytes != 0 {
		t.Errorf("bob: got %+v (downlink should be 0 — no entry)", got["bob"])
	}
}

func TestQueryUserStats_SkipsMalformedEntries(t *testing.T) {
	mockOutput := []byte(`{"stat":[
		{"name":"user>>>alice>>>traffic>>>uplink","value":"100"},
		{"name":"garbage","value":"999"},
		{"name":"user>>>bob>>>traffic>>>uplink","value":"not-a-number"}
	]}`)
	run := func(_ context.Context, _ string, _ ...string) ([]byte, error) {
		return mockOutput, nil
	}
	got, err := queryUserStats(context.Background(), run, "xray", 8080)
	if err != nil {
		t.Fatalf("queryUserStats: %v", err)
	}
	// alice should be there; bob's invalid value skipped; garbage ignored
	if len(got) != 1 {
		t.Errorf("expected only alice, got %+v", got)
	}
	if got["alice"].UplinkBytes != 100 {
		t.Errorf("alice uplink: got %d want 100", got["alice"].UplinkBytes)
	}
}

func TestQueryUserStats_ErrorPropagates(t *testing.T) {
	run := func(_ context.Context, _ string, _ ...string) ([]byte, error) {
		return []byte("connection refused"), errors.New("exit status 1")
	}
	_, err := queryUserStats(context.Background(), run, "xray", 8080)
	if err == nil {
		t.Errorf("expected error from failing run, got nil")
	}
}

func TestQueryUserStats_RejectsEmptyBinary(t *testing.T) {
	_, err := queryUserStats(context.Background(), nil, "", 8080)
	if err == nil {
		t.Errorf("expected error when binary path empty")
	}
}

func TestQueryUserStats_HandlesEmptyResponse(t *testing.T) {
	run := func(_ context.Context, _ string, _ ...string) ([]byte, error) {
		return []byte(`{"stat":[]}`), nil
	}
	got, err := queryUserStats(context.Background(), run, "xray", 8080)
	if err != nil {
		t.Fatalf("queryUserStats: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("expected empty map, got %+v", got)
	}
}

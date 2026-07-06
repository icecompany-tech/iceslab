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
		{"", 0, false},  // 0, empty string parses as zero (no digits → no iterations)
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
		t.Errorf("bob: got %+v (downlink should be 0, no entry)", got["bob"])
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

func TestParseInboundStatName(t *testing.T) {
	cases := []struct {
		in        string
		tag       string
		direction string
		ok        bool
	}{
		{"inbound>>>vless-in>>>traffic>>>uplink", "vless-in", "uplink", true},
		{"inbound>>>cascade-link-in>>>traffic>>>downlink", "cascade-link-in", "downlink", true},
		{"inbound>>>api-in>>>traffic>>>uplink", "api-in", "uplink", true}, // caller filters this tag
		{"user>>>u-1>>>traffic>>>uplink", "", "", false},                  // wrong prefix
		{"inbound>>>x>>>other>>>uplink", "", "", false},                   // non-traffic
		{"inbound>>>x>>>traffic>>>sideways", "", "", false},               // unknown direction
		{"inbound>>>x>>>traffic", "", "", false},                          // too few parts
		{"", "", "", false},
	}
	for _, c := range cases {
		tag, dir, ok := parseInboundStatName(c.in)
		if tag != c.tag || dir != c.direction || ok != c.ok {
			t.Errorf("parseInboundStatName(%q) = (%q,%q,%v) want (%q,%q,%v)",
				c.in, tag, dir, ok, c.tag, c.direction, c.ok)
		}
	}
}

func TestQueryInboundStats_SumsAllInboundsExceptApi(t *testing.T) {
	mockOutput := []byte(`{"stat":[
		{"name":"inbound>>>vless-in>>>traffic>>>uplink","value":"1000"},
		{"name":"inbound>>>vless-in>>>traffic>>>downlink","value":"2000"},
		{"name":"inbound>>>cascade-link-in>>>traffic>>>uplink","value":"500"},
		{"name":"inbound>>>cascade-link-in>>>traffic>>>downlink","value":"700"},
		{"name":"inbound>>>api-in>>>traffic>>>uplink","value":"9999"},
		{"name":"inbound>>>api-in>>>traffic>>>downlink","value":"8888"}
	]}`)
	run := func(_ context.Context, name string, args ...string) ([]byte, error) {
		if name != "/usr/local/bin/xray" {
			t.Errorf("expected xray binary, got %q", name)
		}
		joined := strings.Join(args, " ")
		if !strings.Contains(joined, "api statsquery") {
			t.Errorf("expected `api statsquery`, got %v", args)
		}
		if !strings.Contains(joined, "-pattern inbound") {
			t.Errorf("expected `-pattern inbound`, got %v", args)
		}
		// Non-destructive: the panel deltas the cumulative total itself.
		if strings.Contains(joined, "-reset") {
			t.Errorf("did not expect `-reset`, got %v", args)
		}
		if !strings.Contains(joined, "127.0.0.1:8080") {
			t.Errorf("expected 127.0.0.1:8080, got %v", args)
		}
		return mockOutput, nil
	}

	uplink, downlink, err := queryInboundStats(context.Background(), run, "/usr/local/bin/xray", 8080)
	if err != nil {
		t.Fatalf("queryInboundStats: %v", err)
	}
	// api-in (9999/8888) must be excluded; the rest summed.
	if uplink != 1500 {
		t.Errorf("uplink: got %d want 1500 (vless 1000 + link 500, api-in excluded)", uplink)
	}
	if downlink != 2700 {
		t.Errorf("downlink: got %d want 2700 (vless 2000 + link 700, api-in excluded)", downlink)
	}
}

func TestQueryInboundStats_ErrorPropagates(t *testing.T) {
	run := func(_ context.Context, _ string, _ ...string) ([]byte, error) {
		return []byte("connection refused"), errors.New("exit status 1")
	}
	if _, _, err := queryInboundStats(context.Background(), run, "xray", 8080); err == nil {
		t.Errorf("expected error from failing run, got nil")
	}
}

func TestQueryInboundStats_RejectsEmptyBinary(t *testing.T) {
	if _, _, err := queryInboundStats(context.Background(), nil, "", 8080); err == nil {
		t.Errorf("expected error when binary path empty")
	}
}

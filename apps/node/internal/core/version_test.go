package core

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// The outputs below were taken from the real binaries on 2026-09-23 (sing-box
// 1.13.14, mtg 2.2.8, mita 3.37.0) or from their measured shape (hysteria
// 2.12.3's `Version:` line, caddy's `vX h1:` line).
func TestParseVersionOnWhatTheBinariesActuallySay(t *testing.T) {
	cases := map[string]string{
		"sing-box version 1.13.14\n\nEnvironment: go1.26.4 linux/amd64\n":                                        "1.13.14",
		"Version:\tv2.12.3\nBuildDate:\t2026-08-01\n":                                                            "2.12.3",
		"2.2.8 (go1.26.1: 2026-04-07T16:10:41Z on 83a31e04585aa7d9249cf5118a7a418c809ada5f, modules checksum X)": "2.2.8",
		"3.37.0\n": "3.37.0",
		"v2.8.4 h1:q3pe0wpBj1OcHFZ3n/1nl4V4bxBrYikDvXdkY3vvRdY=\n": "2.8.4",
		"amneziawg-tools v1.0.20260618 - https://amnezia.org\n":    "1.0.20260618",
		"1.0.20260611-2\n": "1.0.20260611-2",
		"no version here":  "",
		"":                 "",
	}
	for out, want := range cases {
		if got := ParseVersion([]byte(out)); got != want {
			t.Errorf("ParseVersion(%q) = %q, want %q", out, got, want)
		}
	}
}

func TestVersionProbeAsksAgainOnlyWhenTheBinaryChanges(t *testing.T) {
	dir := t.TempDir()
	bin := filepath.Join(dir, "core")
	if err := os.WriteFile(bin, []byte("v1"), 0o755); err != nil {
		t.Fatal(err)
	}
	calls := 0
	answer := "sing-box version 1.13.14"
	run := func(context.Context, string, ...string) ([]byte, error) {
		calls++
		return []byte(answer), nil
	}
	var p VersionProbe

	if v := p.Version(bin, []string{"version"}, run); v != "1.13.14" {
		t.Fatalf("first answer %q", v)
	}
	p.Version(bin, []string{"version"}, run)
	if calls != 1 {
		t.Fatalf("an unchanged binary was asked %d times; the answer is cached", calls)
	}

	// The bootstrap script replaces the binary under a running agent.
	answer = "sing-box version 1.14.1"
	if err := os.WriteFile(bin, []byte("v2-longer"), 0o755); err != nil {
		t.Fatal(err)
	}
	later := time.Now().Add(2 * time.Second)
	_ = os.Chtimes(bin, later, later)
	if v := p.Version(bin, []string{"version"}, run); v != "1.14.1" {
		t.Fatalf("after the upgrade the probe still says %q", v)
	}
	if calls != 2 {
		t.Fatalf("calls = %d, want 2", calls)
	}
}

func TestVersionProbeSaysNothingWithoutABinary(t *testing.T) {
	var p VersionProbe
	run := func(context.Context, string, ...string) ([]byte, error) {
		t.Fatal("asked a binary that is not there")
		return nil, nil
	}
	for _, bin := range []string{"", filepath.Join(t.TempDir(), "missing")} {
		if v := p.Version(bin, []string{"version"}, run); v != "" {
			t.Errorf("%q: %q", bin, v)
		}
	}
}

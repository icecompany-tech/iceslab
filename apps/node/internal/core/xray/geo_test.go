package xray

import (
	"context"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/icecompany-tech/iceslab/apps/node/internal/core/subprocess"
	"github.com/icecompany-tech/iceslab/apps/node/internal/dto"
)

func TestAnOperatorsSetIsTheFileThePanelLaidOut(t *testing.T) {
	for in, want := range map[string]string{
		"ext:mine:ads":             "ext:iceslab-mine.dat:ads",
		"ext-domain:mine:ads@cn":   "ext-domain:iceslab-mine.dat:ads@cn",
		"ext-ip:mine:!ru":          "ext-ip:iceslab-mine.dat:!ru",
		"ext:custom.dat:ads":       "ext:custom.dat:ads", // written against a file of its own
		"geosite:category-ads-all": "geosite:category-ads-all",
		"geoip:ru":                 "geoip:ru",
		"domain:example.com":       "domain:example.com",
		"ext:broken":               "ext:broken",
		"10.0.0.0/8":               "10.0.0.0/8",
	} {
		if got := geoEntry(in); got != want {
			t.Errorf("geoEntry(%q) = %q, want %q", in, got, want)
		}
	}
}

// A GeoSiteList with one entry, ADS = [domain a.com], in protobuf.
func tinyDat() []byte {
	domain := []byte{0x08, 0x02, 0x12, 0x05, 'a', '.', 'c', 'o', 'm'}
	entry := append([]byte{0x0a, 0x03, 'A', 'D', 'S', 0x12, byte(len(domain))}, domain...)
	return append([]byte{0x0a, byte(len(entry))}, entry...)
}

// The core has the last word: a policy naming an operator's set loads when
// the file is in XRAY_LOCATION_ASSET, and fails naming the file when it is
// not. Skipped without XRAY_BIN.
func TestTheCoreOpensTheSetThePolicyNames(t *testing.T) {
	bin := os.Getenv("XRAY_BIN")
	if bin == "" {
		t.Skip("XRAY_BIN not set: the file is not asked of the real core here")
	}
	policy := []dto.NodePolicyRule{{
		Match:  dto.NodePolicyMatch{Domain: []string{"ext:mine:ads"}},
		Action: dto.NodePolicyAction{Kind: "block"},
	}}
	blob, err := renderMultiConfig([]InboundConfig{vlessIn()}, []xrayClient{alice}, nil, 8080, policy, nil)
	if err != nil {
		t.Fatal(err)
	}
	assets := t.TempDir()
	t.Setenv("XRAY_LOCATION_ASSET", assets)

	err = validateConfig(context.Background(), defaultRunCmd, bin, blob)
	if err == nil || !strings.Contains(err.Error(), "iceslab-mine.dat") {
		t.Fatalf("without the file: %v, want a refusal naming iceslab-mine.dat", err)
	}
	if err := os.WriteFile(filepath.Join(assets, "iceslab-mine.dat"), tinyDat(), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := validateConfig(context.Background(), defaultRunCmd, bin, blob); err != nil {
		t.Fatalf("with the file: %v", err)
	}
}

// FlushGeo restarts once for files replaced under a running config, and not
// again until they change. Config-only mode: the "restart" is the config
// written again, which is what is watched here.
func TestFlushGeoRestartsOnceForNewFiles(t *testing.T) {
	cfgPath := filepath.Join(t.TempDir(), "config.json")
	a := New(Config{ConfigPath: cfgPath}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	// Stands for a running process; config-only mode never starts one.
	a.proc = subprocess.New(subprocess.Config{Name: Name})

	if err := a.FlushGeo(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(cfgPath); !os.IsNotExist(err) {
		t.Fatal("FlushGeo restarted with nothing noted")
	}

	a.NoteGeo("geosite.dat=aa")
	if err := a.FlushGeo(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(cfgPath); err != nil {
		t.Fatalf("new files under a running xray did not restart it: %v", err)
	}

	if err := os.Remove(cfgPath); err != nil {
		t.Fatal(err)
	}
	a.NoteGeo("geosite.dat=aa")
	if err := a.FlushGeo(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(cfgPath); !os.IsNotExist(err) {
		t.Fatal("the same files restarted xray a second time")
	}
}

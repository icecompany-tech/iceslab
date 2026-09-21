package singbox

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// The version a node runs is pinned in bootstrap-singbox.sh, and every config
// this adapter renders is rendered FOR that version. The two have to be told
// about each other, or the pin moves and nobody re-reads what we emit.
const pinnedSingboxVersion = "v1.13.14"

// TestBootstrapPinsTheVersion keeps the installer honest.
//
// It used to resolve `latest` from the GitHub API, so a fleet installed across
// two weeks ended up on two engines and the same rendered config was correct
// on one node and wrong on the next. 1.14 is in beta and drops compatibility
// with older config forms, which is exactly the move `latest` would have made
// on its own.
func TestBootstrapPinsTheVersion(t *testing.T) {
	path := filepath.Join("..", "..", "..", "scripts", "bootstrap-singbox.sh")
	blob, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	script := string(blob)

	want := `SINGBOX_PINNED_VERSION="` + pinnedSingboxVersion + `"`
	if !strings.Contains(script, want) {
		t.Fatalf("installer does not pin %s.\n"+
			"If the pin moved on purpose, move pinnedSingboxVersion here too and\n"+
			"re-read what renderConfig emits against that release's schema: this\n"+
			"constant is the only thing tying the two together.", pinnedSingboxVersion)
	}

	// The API call stays, but only behind an explicit `latest`. A default that
	// asks the internet what to install is the thing being fixed.
	if !strings.Contains(script, `if [[ "$SINGBOX_VERSION" == "latest" ]]; then`) {
		t.Error("the GitHub release lookup must be reachable only via an explicit SINGBOX_VERSION=latest")
	}
}

// TestRenderedConfigUsesNoRetiredFields pins the SHAPE of what we send to the
// engine, field by field.
//
// sing-box removed or moved several keys across 1.12 and 1.13: inbound `sniff`
// and `sniff_override_destination`, inbound `domain_strategy`, the `block`
// outbound, and `geosite` in route rules. None of them appear in this adapter
// today. That was established by reading the source, and a reading is not a
// guard: this renders every config shape the adapter can produce and fails on
// any of those keys, wherever they turn up.
func TestRenderedConfigUsesNoRetiredFields(t *testing.T) {
	users := map[string]userEntry{
		"u1": {UUID: "11111111-1111-4111-8111-111111111111", Password: "pw", Username: "alice"},
	}
	in := InboundConfig{
		ListenPort:        8443,
		ServerName:        "www.bing.com",
		CongestionControl: "bbr",
		Method:            "2022-blake3-aes-256-gcm",
		Subprotocol:       "vless",
	}

	renders := map[string]func() ([]byte, error){
		"tuic":        func() ([]byte, error) { return renderConfig("c", "k", "127.0.0.1:8082", in, users) },
		"anytls":      func() ([]byte, error) { return renderAnytlsConfig("c", "k", "127.0.0.1:8083", in, users) },
		"xray-family": func() ([]byte, error) { return renderXrayFamilyConfig("127.0.0.1:8084", in, users) },
		"hysteria2":   func() ([]byte, error) { return renderHysteria2Config("c", "k", "127.0.0.1:8085", in, users) },
		"shadowsocks": func() ([]byte, error) { return renderShadowsocksConfig("127.0.0.1:8086", in, users) },
		"shadowtls":   func() ([]byte, error) { return renderShadowtlsConfig("127.0.0.1:8087", in, users) },
	}

	// Retired or moved in 1.12 / 1.13. Matched as JSON keys, so a password that
	// happens to contain the word "block" cannot trip it.
	retired := []string{
		"sniff",
		"sniff_override_destination",
		"domain_strategy",
		"geosite",
		"geoip",
	}

	for name, render := range renders {
		blob, err := render()
		if err != nil {
			t.Fatalf("%s: render: %v", name, err)
		}
		// Valid JSON first: a config the engine cannot parse fails at a worse
		// moment than this one.
		var any map[string]json.RawMessage
		if err := json.Unmarshal(blob, &any); err != nil {
			t.Fatalf("%s: not valid json: %v", name, err)
		}
		for _, key := range retired {
			re := regexp.MustCompile(`"` + key + `"\s*:`)
			if re.Match(blob) {
				t.Errorf("%s: config carries %q, which %s no longer accepts in that place",
					name, key, pinnedSingboxVersion)
			}
		}
		// `block` is an outbound TYPE rather than a key, so it is checked as a
		// value and only there.
		if strings.Contains(string(blob), `"type":"block"`) || strings.Contains(string(blob), `"type": "block"`) {
			t.Errorf("%s: config declares a `block` outbound, removed in 1.11", name)
		}
	}
}

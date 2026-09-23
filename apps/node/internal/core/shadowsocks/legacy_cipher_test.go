package shadowsocks

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// Field bug E19 (2026-09-23): a profile on a legacy AEAD cipher never started
// on the xray engine. For a cipher that is not 2022-blake3, xray-core builds
// every user from that user's own `method` and refuses an empty one
// ("unsupported cipher method: "); the inbound-level method is not inherited.
// The render wrote clients without it.
//
// Pinned two ways, for the legacy cipher and for SS2022 side by side:
//   - golden, byte for byte (testdata/render-ss-*.json). Regenerate per test
//     only: UPDATE_GOLDEN=1 go test -count=1 -run TestSsRenderMatchesGolden;
//   - `xray run -test` on the same render. Skipped without XRAY_BIN.

var ssUsers = []ssClient{
	{Password: "11111111-1111-4111-8111-111111111111", Email: "u-alice"},
	{Password: "22222222-2222-4222-8222-222222222222", Email: "u-bob"},
}

// Server keys of the length each cipher asks for (xray checks the 2022 one),
// base64 of text that says what it is: "iceslab-ss-fixture-psk-legacy-00" and
// "iceslab-ss-fix16". The goldens carry them, and .gitleaks.toml allows them
// by value together with the uPSKs derived from the two fixture UUIDs above.
var ssCases = []struct {
	golden string
	method string
	psk    string
}{
	{"testdata/render-ss-chacha20-ietf-poly1305.json", "chacha20-ietf-poly1305", "aWNlc2xhYi1zcy1maXh0dXJlLXBzay1sZWdhY3ktMDA="},
	{"testdata/render-ss-2022-blake3-aes-128-gcm.json", "2022-blake3-aes-128-gcm", "aWNlc2xhYi1zcy1maXgxNg=="},
}

func ssInbound(method, psk string) InboundConfig {
	return InboundConfig{ListenPort: 8388, Method: method, ServerPSK: psk, ApiPort: 8081}
}

func TestSsClientsCarryTheirCipherOnlyOnLegacy(t *testing.T) {
	for _, tc := range ssCases {
		t.Run(tc.method, func(t *testing.T) {
			for _, raw := range ssSettings(t, renderToMap(t, ssInbound(tc.method, tc.psk), ssUsers))["clients"].([]any) {
				c := raw.(map[string]any)
				m, has := c["method"]
				legacy := !strings.HasPrefix(tc.method, "2022-")
				if legacy && m != tc.method {
					t.Errorf("legacy client %v: method = %v, want %q (xray refuses an empty one)", c["email"], m, tc.method)
				}
				if !legacy && has {
					t.Errorf("SS2022 client %v carries method %v: the inbound's is theirs", c["email"], m)
				}
			}
		})
	}
}

// The live path (`xray api adu`) builds its settings through the same function,
// so a user added to a running legacy node gets the cipher too.
func TestSsAduCarriesTheLegacyCipher(t *testing.T) {
	blob, err := buildAduInbound(ssInbound("chacha20-ietf-poly1305", ssCases[0].psk), ssUsers[0])
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(blob, &m); err != nil {
		t.Fatal(err)
	}
	inb := m["inbounds"].([]any)[0].(map[string]any)
	c := inb["settings"].(map[string]any)["clients"].([]any)[0].(map[string]any)
	if c["method"] != "chacha20-ietf-poly1305" {
		t.Errorf("adu client method = %v, want chacha20-ietf-poly1305", c["method"])
	}
}

func TestSsRenderMatchesGolden(t *testing.T) {
	for _, tc := range ssCases {
		t.Run(tc.method, func(t *testing.T) {
			blob, err := renderConfig(ssInbound(tc.method, tc.psk), ssUsers)
			if err != nil {
				t.Fatal(err)
			}
			if os.Getenv("UPDATE_GOLDEN") == "1" {
				if err := os.MkdirAll("testdata", 0o755); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(tc.golden, blob, 0o644); err != nil {
					t.Fatal(err)
				}
				t.Skip("golden regenerated")
			}
			want, err := os.ReadFile(tc.golden)
			if err != nil {
				t.Fatalf("read golden (regenerate with UPDATE_GOLDEN=1): %v", err)
			}
			// CRLF folded: a Windows checkout hands a text file back with CRLF.
			if string(blob) != strings.ReplaceAll(string(want), "\r\n", "\n") {
				t.Errorf("render differs from the golden\n--- want\n%s\n--- got\n%s", want, blob)
			}
		})
	}
}

// The core has the last word: `xray run -test` on both renders.
func TestTheCoreAcceptsBothSsRenders(t *testing.T) {
	bin := os.Getenv("XRAY_BIN")
	if bin == "" {
		t.Skip("XRAY_BIN not set: the shape is not asked of the real core here")
	}
	for _, tc := range ssCases {
		t.Run(tc.method, func(t *testing.T) {
			blob, err := renderConfig(ssInbound(tc.method, tc.psk), ssUsers)
			if err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(t.TempDir(), "config.json")
			if err := os.WriteFile(path, blob, 0o600); err != nil {
				t.Fatal(err)
			}
			out, err := exec.Command(bin, "run", "-test", "-c", path).CombinedOutput()
			if err != nil {
				t.Fatalf("xray refused the %s config: %v\n%s", tc.method, err, out)
			}
			if !strings.Contains(string(out), "Configuration OK") {
				t.Fatalf("xray did not say OK:\n%s", out)
			}
		})
	}
}

func ssSettings(t *testing.T, m map[string]any) map[string]any {
	t.Helper()
	for _, raw := range m["inbounds"].([]any) {
		inb := raw.(map[string]any)
		if inb["protocol"] == "shadowsocks" {
			return inb["settings"].(map[string]any)
		}
	}
	t.Fatal("ss inbound not found")
	return nil
}

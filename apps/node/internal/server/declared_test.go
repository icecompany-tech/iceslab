package server

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/icecompany-tech/iceslab/apps/node/internal/dto"
)

// E42: the node's intended cores are the blocks its bootstraps wrote.

func writeEnv(t *testing.T, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "env")
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func block(core string, lines ...string) string {
	return "# >>> iceslab-node env:" + core + " >>>\n" + strings.Join(lines, "\n") + "\n# <<< iceslab-node env:" + core + " <<<\n"
}

func TestThreeBlocksAreThreeDeclaredCores(t *testing.T) {
	// ru-01, 26.09: installed without --engines, then xray, hysteria and awg
	// from the node page. The order follows the engines, not the file.
	path := writeEnv(t, "NODE_PAYLOAD=x\n"+
		block("amneziawg", "AMNEZIAWG_BIN=/usr/bin/awg")+
		block("xray", "XRAY_BINARY=/usr/local/bin/xray")+
		"HYSTERIA_HOSTNAME=hy.example.com\n"+ // the installer's flag line, not a declaration
		block("hysteria", "HYSTERIA_BINARY=/usr/local/bin/hysteria"))
	got := declaredEngines(path)
	want := []dto.EngineName{"xray", "hysteria", "amneziawg"}
	if got == nil || !reflect.DeepEqual(*got, want) {
		t.Fatalf("declared %v, want %v", got, want)
	}
}

func TestARemovedBlockIsNoLongerDeclared(t *testing.T) {
	// --remove takes the block out (node_env_unblock); the binary may stay,
	// and the next healthcheck must not call the core intended.
	path := writeEnv(t, block("xray", "XRAY_BINARY=/usr/local/bin/xray")+block("hysteria", "HYSTERIA_BINARY=/usr/local/bin/hysteria"))
	if got := declaredEngines(path); got == nil || len(*got) != 2 {
		t.Fatalf("before: %v", got)
	}
	if err := os.WriteFile(path, []byte(block("xray", "XRAY_BINARY=/usr/local/bin/xray")), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := declaredEngines(path); got == nil || !reflect.DeepEqual(*got, []dto.EngineName{"xray"}) {
		t.Fatalf("after --remove of hysteria: %v", got)
	}
}

func TestTheDeclarationBeforeBlocksCounts(t *testing.T) {
	// A node installed before the blocks (24.09): the binary key on a loose
	// line is the same declaration. Keys inside a block of another name do not
	// count twice, and a block that is not a core is not a core.
	path := writeEnv(t, "NODE_PAYLOAD=x\nXRAY_BINARY=/usr/local/bin/xray\nMTG_BINARY=/usr/local/bin/mtg\n"+
		block("custom", "SINGBOX_BINARY=/somewhere/else"))
	got := declaredEngines(path)
	want := []dto.EngineName{"xray", "mtproto"}
	if got == nil || !reflect.DeepEqual(*got, want) {
		t.Fatalf("declared %v, want %v", got, want)
	}
}

func TestNoEnvIsNotNoCores(t *testing.T) {
	if got := declaredEngines(""); got != nil {
		t.Errorf("no path: %v, want nil", got)
	}
	if got := declaredEngines(filepath.Join(t.TempDir(), "missing")); got != nil {
		t.Errorf("unreadable file: %v, want nil (the panel keeps what it had)", got)
	}
	// A readable env with no core is a node with no core: an empty list, not nil.
	if got := declaredEngines(writeEnv(t, "NODE_PAYLOAD=x\n")); got == nil || len(*got) != 0 {
		t.Errorf("env with no core: %v, want []", got)
	}
}

func TestTheHealthcheckCarriesTheDeclaration(t *testing.T) {
	s := newServerWith(t, &fakeAdapter{name: "xray", engine: "xray"})
	if h := healthOf(t, s); h.DeclaredEngines != nil {
		t.Errorf("no env configured, yet declared %v", *h.DeclaredEngines)
	}
	s.cfg.EnvFile = writeEnv(t, block("xray", "XRAY_BINARY=/usr/local/bin/xray"))
	h := healthOf(t, s)
	if h.DeclaredEngines == nil || !reflect.DeepEqual(*h.DeclaredEngines, []dto.EngineName{"xray"}) {
		t.Errorf("declared %v", h.DeclaredEngines)
	}
}

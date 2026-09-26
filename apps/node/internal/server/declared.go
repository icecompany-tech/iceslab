package server

import (
	"bufio"
	"os"
	"strings"

	"github.com/icecompany-tech/iceslab/apps/node/internal/dto"
)

// E42, 26.09 on ru-01: a node installed without --engines took xray, hysteria
// and amneziawg from its page's "how to install" commands. The cores ran and
// reported, and the panel still listed none of them as intended, each marked
// "taken off the node's cores, yet on the machine": the intent was written once,
// from the installer's --engines, and a bootstrap run later told the panel
// nothing. Two sources of truth, and the marker invited deleting what had just
// been installed.
//
// The env the bootstraps write is the declaration (scripts/lib/node-env.sh):
// one block per core, `# >>> iceslab-node env:<core> >>>`, written on install
// and taken out by --remove. The agent reads it on every healthcheck and the
// panel takes the list as the node's intent.

// envBlockEngines: the block names that are cores. The same names as the
// engines adapters answer with; contract-mirror.test.ts holds this list, the
// bootstraps' block names and EngineName in shared to one set.
var envBlockEngines = []string{"xray", "hysteria", "singbox", "amneziawg", "naive", "mieru", "mtproto"}

// legacyBinaryKeys: the same declaration in the spelling from before the
// blocks (the installer's legacy_primary_env, lines written by hand before
// E20): a core's binary key on a loose line. Counted, or every node installed
// before 24.09 would read as declaring nothing, and every core on it as left
// over. A bootstrap rerun replaces the loose line with the block.
var legacyBinaryKeys = map[string]string{
	"XRAY_BINARY":     "xray",
	"HYSTERIA_BINARY": "hysteria",
	"SINGBOX_BINARY":  "singbox",
	"AMNEZIAWG_BIN":   "amneziawg",
	"CADDY_NAIVE_BIN": "naive",
	"MITA_BINARY":     "mieru",
	"MTG_BINARY":      "mtproto",
}

const (
	envBlockBegin = "# >>> iceslab-node env:"
	envBlockEnd   = "# <<< iceslab-node env:"
)

// declaredEngines reads the env file at path and returns the cores it
// declares, in the order of envBlockEngines. nil when there is no path or the
// file cannot be read: the panel then keeps what it had, since "could not read"
// is not "declares none".
func declaredEngines(path string) *[]dto.EngineName {
	if path == "" {
		return nil
	}
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()

	known := make(map[string]bool, len(envBlockEngines))
	for _, e := range envBlockEngines {
		known[e] = true
	}
	found := map[string]bool{}
	inBlock := false
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		switch {
		case strings.HasPrefix(line, envBlockBegin) && strings.HasSuffix(line, " >>>"):
			inBlock = true
			name := strings.TrimSuffix(strings.TrimPrefix(line, envBlockBegin), " >>>")
			if known[name] {
				found[name] = true
			}
		case strings.HasPrefix(line, envBlockEnd):
			inBlock = false
		case !inBlock:
			if key, _, ok := strings.Cut(line, "="); ok {
				if e, legacy := legacyBinaryKeys[key]; legacy {
					found[e] = true
				}
			}
		}
	}
	if sc.Err() != nil {
		return nil
	}
	out := make([]dto.EngineName, 0, len(found))
	for _, e := range envBlockEngines {
		if found[e] {
			out = append(out, dto.EngineName(e))
		}
	}
	return &out
}

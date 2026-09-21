package amneziawg

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// What a new node installs, pinned.
//
// Both refs were `git clone --depth 1` of the default branch until 2026-09-21,
// so the kernel module a node got was whatever upstream pushed that morning.
// Two nodes installed a fortnight apart ran different modules and the panel
// had no way to know: only DPI would ever have told us.
//
// The values here are what master resolved to on 2026-09-21, so a fresh
// install gets what it already got. What is fixed is the drift.
const (
	pinnedModuleTag  = "v3.1.20260906"
	pinnedModuleSHA  = "4569c4c67f3a57414969260cafbbd04694fbaae0"
	pinnedToolsTag   = "v3.1.20260812"
	pinnedToolsSHA   = "ee0f0a9aa34ff0a0da4b3433b9512781cfe02843"
	bootstrapRelPath = "../../../scripts/bootstrap-amneziawg.sh"
)

func readBootstrap(t *testing.T) string {
	t.Helper()
	blob, err := os.ReadFile(filepath.Clean(bootstrapRelPath))
	if err != nil {
		t.Fatalf("read %s: %v", bootstrapRelPath, err)
	}
	return string(blob)
}

func TestBootstrapPinsBothRefs(t *testing.T) {
	script := readBootstrap(t)
	for _, want := range []struct{ name, value string }{
		{"AWG_MODULE_TAG", pinnedModuleTag},
		{"AWG_MODULE_SHA", pinnedModuleSHA},
		{"AWG_TOOLS_TAG", pinnedToolsTag},
		{"AWG_TOOLS_SHA", pinnedToolsSHA},
	} {
		if !strings.Contains(script, want.name+`="${`+want.name+`:-`+want.value+`}"`) {
			t.Errorf("%s is not pinned to %s.\n"+
				"If the pin moved on purpose, move the constant here too, and read the\n"+
				"tag first: the leading v1 / v3 is the AmneziaWG PROTOCOL generation, and\n"+
				"changing it re-issues every config already handed to a person.",
				want.name, want.value)
		}
	}
}

// TestBootstrapClonesNothingUnpinned is the half that actually holds.
//
// A pin sitting in a variable nothing reads is decoration, and the shape it
// replaced (`git clone --depth 1 <repo> <dir>`) is one careless edit away from
// coming back.
func TestBootstrapClonesNothingUnpinned(t *testing.T) {
	script := readBootstrap(t)

	// Every clone must go through the helper that verifies the commit.
	loose := regexp.MustCompile(`(?m)^\s*git clone (?:--depth 1 )?"\$AWG_`)
	if loose.MatchString(script) {
		t.Error("a repository is cloned directly instead of through clone_pinned; " +
			"that is the unpinned form this pin exists to remove")
	}
	if strings.Count(script, "clone_pinned ") < 2 {
		t.Error("expected both the kernel module and the tools to clone through clone_pinned")
	}

	// And the helper must still compare the SHA: a tag can be moved upstream,
	// a commit cannot.
	if !strings.Contains(script, `if [[ "$got" != "$sha" ]]; then`) {
		t.Error("clone_pinned no longer verifies the commit it got; a moved tag would install silently")
	}
}

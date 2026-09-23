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
// The first pin froze `master`, which was v3.1 by then. The stand says the
// fleet is on 1.x (ru-01 and se-01: module 1.0.20260611, tools
// v1.0.20260618-2), so that pin would have installed the OTHER PROTOCOL
// GENERATION on the next node built, and every client older than 4.8.12.9
// would have stopped connecting to it.
//
// The tags and commits are the version manifest's now
// (packages/shared/src/core-versions.ts), which also marks every other
// generation known-bad and refuses a pin inside that range; the script carries
// them as generated blocks, held to the manifest by core-pins.test.ts. The
// generation check below stays as a second lock on the script itself.
//
// ⚠ Reads a file outside the package: `go test -count=1` locally.
const bootstrapRelPath = "../../../scripts/bootstrap-amneziawg.sh"

func readBootstrap(t *testing.T) string {
	t.Helper()
	blob, err := os.ReadFile(filepath.Clean(bootstrapRelPath))
	if err != nil {
		t.Fatalf("read %s: %v", bootstrapRelPath, err)
	}
	return string(blob)
}

// The generation, on its own, because it is the half that costs people rather
// than packets.
//
// A date that moves is a version bump. A leading v3 instead of v1 is a
// DIFFERENT PROTOCOL: every config already handed out stops working, and every
// AmneziaVPN older than 4.8.12.9 cannot speak it at all. That decision is the
// operator's, about their subscribers, and it must never arrive as the side
// effect of somebody refreshing a pin to whatever master says today. Which is
// exactly how it arrived once: see the constants above.
func TestBootstrapPinsTheProtocolGeneration(t *testing.T) {
	script := readBootstrap(t)
	for _, name := range []string{"AWG_MODULE_PINNED_TAG", "AWG_TOOLS_PINNED_TAG"} {
		m := regexp.MustCompile(`(?m)^` + name + `="([^"]+)"$`).FindStringSubmatch(script)
		if m == nil {
			t.Fatalf("%s is not pinned at all, or the shape of the line changed; "+
				"this test is checking nothing. Fix the pattern, do not delete the test.", name)
		}
		if !strings.HasPrefix(m[1], "v1.") {
			t.Errorf("%s is %q, which is not the protocol generation the fleet runs (v1.x).\n"+
				"If the move to another generation is deliberate, it is a decision about the\n"+
				"operator's subscribers: every AmneziaWG config already issued stops working,\n"+
				"and clients older than 4.8.12.9 cannot connect at all. Change this test in the\n"+
				"same commit that carries that decision, and not before.", name, m[1])
		}
	}
}

// The refs the clones use default to the generated block, both halves.
func TestBootstrapDefaultsBothRefsToTheManifest(t *testing.T) {
	script := readBootstrap(t)
	for _, want := range []struct{ name, pinned string }{
		{"AWG_MODULE_TAG", "AWG_MODULE_PINNED_TAG"},
		{"AWG_MODULE_SHA", "AWG_MODULE_PINNED_COMMIT"},
		{"AWG_TOOLS_TAG", "AWG_TOOLS_PINNED_TAG"},
		{"AWG_TOOLS_SHA", "AWG_TOOLS_PINNED_COMMIT"},
	} {
		if !strings.Contains(script, want.name+`="${`+want.name+`:-$`+want.pinned+`}"`) {
			t.Errorf("%s does not default to %s from the generated block", want.name, want.pinned)
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

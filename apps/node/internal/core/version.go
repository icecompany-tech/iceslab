package core

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"sync"
	"time"
)

// versionToken is the first dotted version in a binary's own answer, with an
// optional leading `v` (dropped) and an optional pre-release suffix. Anchored
// on a word start so "go1.26.1" inside mtg's build line is not taken for it.
//
// Measured against the real outputs (2026-09-23):
//
//	sing-box version 1.13.14                 -> 1.13.14
//	Version:	v2.12.3                         -> 2.12.3   (hysteria)
//	2.2.8 (go1.26.1: 2026-04-07T16:10:41Z ...) -> 2.2.8    (mtg --version)
//	3.37.0                                   -> 3.37.0   (mita version)
//	v2.8.4 h1:q3pe0w...                      -> 2.8.4    (caddy version)
var versionToken = regexp.MustCompile(`(?:^|[\s(:])v?(\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.]+)?)`)

// ParseVersion pulls the version out of a binary's `version` output, or "" when
// there is none to be found. "" is an answer the panel reads as "unknown", never
// as a version.
func ParseVersion(out []byte) string {
	m := versionToken.FindSubmatch(out)
	if m == nil {
		return ""
	}
	return string(m[1])
}

// RunForOutput runs a command and returns what it printed; the shape adapters
// with an injectable runner already use.
type RunForOutput func(ctx context.Context, name string, args ...string) ([]byte, error)

func execOutput(ctx context.Context, name string, args ...string) ([]byte, error) {
	return exec.CommandContext(ctx, name, args...).CombinedOutput()
}

// VersionProbe asks a core binary for its version and remembers the answer
// until the FILE changes.
//
// Not "once per process" like the first Versioner (xray): a node's core is
// replaced by its bootstrap script while the agent keeps running, and an answer
// cached for the life of the agent keeps reporting the old version after the
// upgrade, which is the one moment somebody reads it. The key is the binary's
// path, size and modification time, checked with a stat on every call, which is
// cheap; the binary itself runs only when that key moves.
type VersionProbe struct {
	mu    sync.Mutex
	stamp string
	value string
}

// Version returns the version of the binary at `bin`, asking it with `args`.
// An empty path, a missing file or a failed run all answer "".
func (p *VersionProbe) Version(bin string, args []string, run RunForOutput) string {
	stamp := binaryStamp(bin)
	p.mu.Lock()
	if stamp == "" {
		p.stamp, p.value = "", ""
		p.mu.Unlock()
		return ""
	}
	if stamp == p.stamp {
		v := p.value
		p.mu.Unlock()
		return v
	}
	p.mu.Unlock()

	if run == nil {
		run = execOutput
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	out, err := run(ctx, bin, args...)
	cancel()
	v := ""
	if err == nil {
		v = ParseVersion(out)
	}

	p.mu.Lock()
	p.stamp, p.value = stamp, v
	p.mu.Unlock()
	return v
}

// binaryStamp identifies the file at `bin` by path, size and mtime, or "" when
// there is no file to ask. A bare name is looked up in PATH, as BinaryPresent
// does.
func binaryStamp(bin string) string {
	if bin == "" {
		return ""
	}
	path := bin
	if !strings.ContainsAny(bin, `/\`) {
		found, err := exec.LookPath(bin)
		if err != nil {
			return ""
		}
		path = found
	}
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		return ""
	}
	return fmt.Sprintf("%s|%d|%d", path, info.Size(), info.ModTime().UnixNano())
}

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
//	Xray 26.3.27 (Xray, Penetrates ...)      -> 26.3.27
//	sing-box version 1.13.14                 -> 1.13.14
//	Version:	v2.12.3                         -> 2.12.3   (hysteria)
//	2.2.8 (go1.26.1: 2026-04-07T16:10:41Z ...) -> 2.2.8    (mtg --version)
//	3.37.0                                   -> 3.37.0   (mita version)
//	v2.8.4 h1:q3pe0w...                      -> 2.8.4    (caddy version)
var versionToken = regexp.MustCompile(`(?:^|[\s(:])v?(\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.]+)?)`)

// ParseVersion pulls the version out of a binary's `version` output, or "" when
// there is none to be found. "" is an answer the panel reads as "unknown", never
// as a version.
//
// Line by line, and a JSON log line is not an answer: E35, 25.09 on nl-01,
// caddy-naive logs `{"level":"info","ts":1790322240.3261952,...}` on stderr
// before it prints `v2.11.4 h1:...`, the run is read combined, and the Unix
// timestamp after `"ts":` matched first. The node reported naive
// 1790322240.3261952.
func ParseVersion(out []byte) string {
	for _, line := range strings.Split(string(out), "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), "{") {
			continue
		}
		if m := versionToken.FindStringSubmatch(line); m != nil {
			return m[1]
		}
	}
	return ""
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
// Not "once per process", as xray's first Versioner was: a node's core is
// replaced by its bootstrap script while the agent keeps running, and an answer
// cached for the life of the agent keeps reporting the old version after the
// upgrade, which is the one moment somebody reads it. The key is the binary's
// path, size and modification time, checked with a stat on every call, which is
// cheap; the binary itself runs only when that key moves.
type VersionProbe struct {
	mu    sync.Mutex
	stamp string
	out   string
	ok    bool
}

// Version returns the version of the binary at `bin`, asking it with `args`.
// An empty path, a missing file or a failed run all answer "".
func (p *VersionProbe) Version(bin string, args []string, run RunForOutput) string {
	out, ok := p.Answer(bin, args, run)
	if !ok {
		return ""
	}
	return ParseVersion([]byte(out))
}

// Answer is what the binary printed and whether it ran at all, under the same
// cache as Version. For a caller that needs more than the number: AmneziaWG
// reads the NAME in `awg --version`, because wireguard-tools answers the same
// command under the same file name.
func (p *VersionProbe) Answer(bin string, args []string, run RunForOutput) (string, bool) {
	stamp := binaryStamp(bin)
	p.mu.Lock()
	if stamp == "" {
		p.stamp, p.out, p.ok = "", "", false
		p.mu.Unlock()
		return "", false
	}
	if stamp == p.stamp {
		out, ok := p.out, p.ok
		p.mu.Unlock()
		return out, ok
	}
	p.mu.Unlock()

	if run == nil {
		run = execOutput
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	raw, err := run(ctx, bin, args...)
	cancel()
	out, ok := string(raw), err == nil
	if !ok {
		out = ""
	}

	p.mu.Lock()
	p.stamp, p.out, p.ok = stamp, out, ok
	p.mu.Unlock()
	return out, ok
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

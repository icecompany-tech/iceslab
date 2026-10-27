// Package connlog finds and clears what a previous agent left in the host's
// logs: one line per client connection with the client's address (xray
// "accepted tcp:/udp:", hysteria "client connected/disconnected"). A-265.
//
// The current agent writes no such line (xray has no access log, hysteria
// runs at warn), but a node that ran an older one keeps them in journald and
// in /var/log/syslog* until they age out. The operator decides whether to
// clear them; this package says where they are and since when, never the
// lines, and does the clearing.
//
// No shell anywhere: journalctl is read as a stream and matched here, and
// every command runs with its own timeout and its whole output taken
// (CLAUDE.local, "cmd | grep -q under pipefail").
package connlog

import (
	"bufio"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/icecompany-tech/iceslab/apps/node/internal/dto"
)

// markers are the parts of a connection line, as the cores write them.
var markers = []string{"accepted tcp:", "accepted udp:", "client connected", "client disconnected"}

// IsConnectionLine reports whether a log message is one of those lines.
func IsConnectionLine(msg string) bool {
	for _, m := range markers {
		if strings.Contains(msg, m) {
			return true
		}
	}
	return false
}

const (
	readTimeout  = 45 * time.Second
	clearTimeout = 60 * time.Second
	errMax       = 300
)

// Streamer starts a command and hands its stdout as it comes; wait ends it
// and returns its error with what it wrote to stderr.
type Streamer func(ctx context.Context, name string, args ...string) (stdout io.ReadCloser, wait func() error, err error)

// Runner runs a command to its end and returns all it wrote.
type Runner func(ctx context.Context, name string, args ...string) ([]byte, error)

type Config struct {
	// Units whose journal is read: the agent's, and hysteria's own (it runs
	// as its unit, bootstrap-hysteria.sh), plus the unit name hysteria had
	// before the bootstrap wrote its own.
	Units []string
	// Syslog tags of the same processes.
	Tags []string
	// Where syslog lies. Default /var/log.
	SyslogDir string

	Stream   Streamer
	Run      Runner
	LookPath func(string) (string, error)
	Now      func() time.Time
}

type Checker struct{ cfg Config }

// New fills what the config leaves out with the real thing.
func New(cfg Config) *Checker {
	if cfg.SyslogDir == "" {
		cfg.SyslogDir = "/var/log"
	}
	if cfg.Stream == nil {
		cfg.Stream = execStream
	}
	if cfg.Run == nil {
		cfg.Run = func(ctx context.Context, name string, args ...string) ([]byte, error) {
			return exec.CommandContext(ctx, name, args...).CombinedOutput()
		}
	}
	if cfg.LookPath == nil {
		cfg.LookPath = exec.LookPath
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	return &Checker{cfg: cfg}
}

// Units the agent reads, from the hysteria unit it was given (may be empty).
func Units(hysteriaUnit string) []string {
	out := []string{"iceslab-node.service", "hysteria.service", "hysteria-server.service"}
	if u := strings.TrimSpace(hysteriaUnit); u != "" {
		if !strings.HasSuffix(u, ".service") {
			u += ".service"
		}
		if u != "hysteria.service" && u != "hysteria-server.service" {
			out = append(out, u)
		}
	}
	return out
}

func execStream(ctx context.Context, name string, args ...string) (io.ReadCloser, func() error, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	var stderr strings.Builder
	cmd.Stderr = &limitedWriter{w: &stderr, left: 4096}
	out, err := cmd.StdoutPipe()
	if err != nil {
		return nil, nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, nil, err
	}
	wait := func() error {
		if err := cmd.Wait(); err != nil {
			if s := strings.TrimSpace(stderr.String()); s != "" {
				return fmt.Errorf("%w: %s", err, s)
			}
			return err
		}
		return nil
	}
	return out, wait, nil
}

type limitedWriter struct {
	w    io.Writer
	left int
}

func (l *limitedWriter) Write(p []byte) (int, error) {
	n := len(p)
	if l.left > 0 {
		q := p
		if len(q) > l.left {
			q = q[:l.left]
		}
		l.left -= len(q)
		_, _ = l.w.Write(q)
	}
	return n, nil
}

func cut(s string) string {
	s = strings.TrimSpace(s)
	if len(s) > errMax {
		return s[:errMax]
	}
	return s
}

func iso(t time.Time) *string {
	s := t.UTC().Format(time.RFC3339)
	return &s
}

// ───── the check ─────

// Trace looks in both sources.
func (c *Checker) Trace(ctx context.Context) dto.ConnLogTraceResponse {
	checks := []dto.ConnLogSourceCheck{c.checkJournal(ctx), c.checkSyslog()}
	return summarize(checks)
}

func summarize(checks []dto.ConnLogSourceCheck) dto.ConnLogTraceResponse {
	resp := dto.ConnLogTraceResponse{Sources: []dto.ConnLogSource{}, Checks: checks}
	failed := false
	var oldest *time.Time
	for _, ch := range checks {
		switch ch.State {
		case "found":
			resp.Sources = append(resp.Sources, ch.Source)
			if ch.Since != nil {
				if t, err := time.Parse(time.RFC3339, *ch.Since); err == nil && (oldest == nil || t.Before(*oldest)) {
					oldest = &t
				}
			}
		case "failed":
			failed = true
		}
	}
	switch {
	case len(resp.Sources) > 0:
		yes := true
		resp.Present = &yes
	case failed:
		// Not a "no": a source was not read.
	default:
		no := false
		resp.Present = &no
	}
	if oldest != nil {
		resp.Since = iso(*oldest)
	}
	return resp
}

// journalArgs: every unit at once, oldest first, only the message.
func (c *Checker) journalArgs() []string {
	args := []string{"--no-pager", "-o", "json", "--output-fields=MESSAGE"}
	for _, u := range c.cfg.Units {
		args = append(args, "-u", u)
	}
	return args
}

func (c *Checker) checkJournal(ctx context.Context) dto.ConnLogSourceCheck {
	ch := dto.ConnLogSourceCheck{Source: dto.ConnLogJournal, State: "clean"}
	if _, err := c.cfg.LookPath("journalctl"); err != nil {
		ch.State = "absent"
		return ch
	}
	rctx, cancel := context.WithTimeout(ctx, readTimeout)
	defer cancel()
	out, wait, err := c.cfg.Stream(rctx, "journalctl", c.journalArgs()...)
	if err != nil {
		ch.State, ch.Error = "failed", cut("journalctl: "+err.Error())
		return ch
	}
	since, scanErr := firstJournalMatch(out)
	if since != nil {
		// Found: the rest of the journal is not needed.
		cancel()
		_ = out.Close()
		_ = wait()
		ch.State, ch.Since = "found", iso(*since)
		return ch
	}
	waitErr := wait()
	switch {
	case rctx.Err() == context.DeadlineExceeded:
		ch.State, ch.Error = "failed", fmt.Sprintf("journalctl did not finish in %s", readTimeout)
	case scanErr != nil:
		ch.State, ch.Error = "failed", cut("journalctl output: "+scanErr.Error())
	case waitErr != nil:
		ch.State, ch.Error = "failed", cut("journalctl: "+waitErr.Error())
	}
	return ch
}

type journalEntry struct {
	Realtime string          `json:"__REALTIME_TIMESTAMP"`
	Message  json.RawMessage `json:"MESSAGE"`
}

// firstJournalMatch reads journalctl -o json lines until one is a connection
// line, and returns its time.
func firstJournalMatch(r io.Reader) (*time.Time, error) {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 64*1024), 4*1024*1024)
	for sc.Scan() {
		var e journalEntry
		if err := json.Unmarshal(sc.Bytes(), &e); err != nil {
			continue
		}
		if !IsConnectionLine(journalMessage(e.Message)) {
			continue
		}
		us, err := strconv.ParseInt(e.Realtime, 10, 64)
		if err != nil {
			continue
		}
		t := time.UnixMicro(us)
		return &t, nil
	}
	return nil, sc.Err()
}

// journalMessage: MESSAGE is a string, or an array of bytes when it is not
// valid UTF-8 (journalctl -o json).
func journalMessage(raw json.RawMessage) string {
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	var b []byte
	var nums []int
	if json.Unmarshal(raw, &nums) == nil {
		for _, n := range nums {
			b = append(b, byte(n))
		}
		return string(b)
	}
	return ""
}

var syslogName = regexp.MustCompile(`^syslog(?:\.(\d+)(\.gz)?)?$`)

type syslogFile struct {
	path string
	n    int // 0 for the active file
	gz   bool
}

// syslogFiles, oldest first: the highest rotation number first, the active
// file last.
func (c *Checker) syslogFiles() ([]syslogFile, error) {
	entries, err := os.ReadDir(c.cfg.SyslogDir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, err
	}
	var out []syslogFile
	for _, e := range entries {
		m := syslogName.FindStringSubmatch(e.Name())
		if m == nil || e.IsDir() {
			continue
		}
		f := syslogFile{path: filepath.Join(c.cfg.SyslogDir, e.Name()), gz: m[2] != ""}
		if m[1] != "" {
			f.n, _ = strconv.Atoi(m[1])
		}
		out = append(out, f)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].n > out[j].n })
	return out, nil
}

func (c *Checker) checkSyslog() dto.ConnLogSourceCheck {
	ch := dto.ConnLogSourceCheck{Source: dto.ConnLogSyslog, State: "clean"}
	files, err := c.syslogFiles()
	if err != nil {
		ch.State, ch.Error = "failed", cut(err.Error())
		return ch
	}
	if len(files) == 0 {
		ch.State = "absent"
		return ch
	}
	var errs []string
	for _, f := range files {
		t, err := c.firstSyslogMatch(f)
		if err != nil {
			errs = append(errs, err.Error())
			continue
		}
		if t != nil {
			ch.State, ch.Since = "found", iso(*t)
			return ch
		}
	}
	if len(errs) > 0 {
		ch.State, ch.Error = "failed", cut(strings.Join(errs, "; "))
	}
	return ch
}

func (c *Checker) firstSyslogMatch(f syslogFile) (*time.Time, error) {
	fh, err := os.Open(f.path)
	if err != nil {
		return nil, err
	}
	// Read only: a failed close loses nothing, the scan has answered by then.
	defer func() { _ = fh.Close() }()
	info, err := fh.Stat()
	if err != nil {
		return nil, err
	}
	var r io.Reader = fh
	if f.gz {
		gz, err := gzip.NewReader(fh)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", f.path, err)
		}
		defer func() { _ = gz.Close() }()
		r = gz
	}
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 64*1024), 4*1024*1024)
	for sc.Scan() {
		line := sc.Text()
		if !IsConnectionLine(line) || !c.hasTag(line) {
			continue
		}
		if t, ok := SyslogTime(line, info.ModTime()); ok {
			return &t, nil
		}
	}
	if err := sc.Err(); err != nil {
		return nil, fmt.Errorf("%s: %w", f.path, err)
	}
	return nil, nil
}

// hasTag: the line was written by one of our processes ("host tag[pid]: ").
func (c *Checker) hasTag(line string) bool {
	for _, t := range c.cfg.Tags {
		if strings.Contains(line, " "+t+"[") || strings.Contains(line, " "+t+": ") {
			return true
		}
	}
	return false
}

// SyslogTime reads the time a syslog line starts with: RFC 3339 (rsyslog's
// high-precision format, Ubuntu 23.10 and later) or the classic "Oct 26
// 12:00:00", which has no year: the file's year is taken, a year back when
// that would put the line after the file was last written.
func SyslogTime(line string, fileMod time.Time) (time.Time, bool) {
	if i := strings.IndexByte(line, ' '); i > 0 {
		if t, err := time.Parse(time.RFC3339Nano, line[:i]); err == nil {
			return t, true
		}
	}
	if len(line) < 15 {
		return time.Time{}, false
	}
	t, err := time.ParseInLocation("Jan _2 15:04:05", line[:15], time.Local)
	if err != nil {
		return time.Time{}, false
	}
	t = t.AddDate(fileMod.Year(), 0, 0)
	if t.After(fileMod.Add(24 * time.Hour)) {
		t = t.AddDate(-1, 0, 0)
	}
	return t, true
}

// ───── the clearing ─────

// Clear empties both sources and checks again.
func (c *Checker) Clear(ctx context.Context) dto.ConnLogClearResponse {
	results := []dto.ConnLogClearResult{c.clearJournal(ctx), c.clearSyslog()}
	return dto.ConnLogClearResponse{Results: results, After: c.Trace(ctx)}
}

func (c *Checker) clearJournal(ctx context.Context) dto.ConnLogClearResult {
	res := dto.ConnLogClearResult{Source: dto.ConnLogJournal, State: "cleared", Steps: []dto.ConnLogClearStep{}}
	if _, err := c.cfg.LookPath("journalctl"); err != nil {
		res.State = "absent"
		return res
	}
	// Rotate first: vacuum removes archived files only, and the lines sit in
	// the active one. Vacuum runs even when rotate failed: what was archived
	// before still goes.
	for _, args := range [][]string{{"--rotate"}, {"--vacuum-time=1s"}} {
		step := dto.ConnLogClearStep{Command: "journalctl " + strings.Join(args, " "), OK: true}
		rctx, cancel := context.WithTimeout(ctx, clearTimeout)
		out, err := c.cfg.Run(rctx, "journalctl", args...)
		cancel()
		if err != nil {
			step.OK = false
			step.Error = cut(strings.TrimSpace(err.Error() + ": " + string(out)))
			res.State = "failed"
		}
		res.Steps = append(res.Steps, step)
	}
	return res
}

func (c *Checker) clearSyslog() dto.ConnLogClearResult {
	res := dto.ConnLogClearResult{Source: dto.ConnLogSyslog, State: "cleared", Steps: []dto.ConnLogClearStep{}}
	files, err := c.syslogFiles()
	if err != nil {
		res.State = "failed"
		res.Steps = append(res.Steps, dto.ConnLogClearStep{Command: "list " + c.cfg.SyslogDir, Error: cut(err.Error())})
		return res
	}
	if len(files) == 0 {
		res.State = "absent"
		return res
	}
	// The active file is emptied in place: rsyslog keeps it open and goes on
	// appending. The rotated ones are removed.
	for i := len(files) - 1; i >= 0; i-- {
		f := files[i]
		step := dto.ConnLogClearStep{OK: true}
		if f.n == 0 && !f.gz {
			step.Command = "truncate " + f.path
			err = os.Truncate(f.path, 0)
		} else {
			step.Command = "remove " + f.path
			err = os.Remove(f.path)
		}
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			step.OK = false
			step.Error = cut(err.Error())
			res.State = "failed"
		}
		res.Steps = append(res.Steps, step)
	}
	return res
}

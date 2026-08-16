package xray

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/icecompany-tech/iceslab/apps/node/internal/core"
	"github.com/icecompany-tech/iceslab/apps/node/internal/core/subprocess"
)

const Name = "xray"

// apiCallTimeout caps the live HandlerService calls (`xray api adu`/`rmu`). The
// API is loopback IPC, so this is generous headroom, not a tight budget.
const apiCallTimeout = 5 * time.Second

// Config is the per-instance settings for an XrayAdapter.
type Config struct {
	// BinaryPath to the `xray` executable. If empty, the adapter runs in
	// "config-only" mode (writes config.json but doesn't spawn xray), useful
	// for tests and dev environments without xray installed.
	BinaryPath string

	// ConfigPath is where the generated config.json is written. The xray
	// subprocess is invoked with `xray run -c <ConfigPath>`.
	ConfigPath string

	// Inbound is the static REALITY+VLESS settings; slice 23 will move these
	// into the inbounds table per node.
	Inbound InboundConfig

	// RunCmd is the injectable command runner used by GetStats to invoke
	// `xray api statsquery -server 127.0.0.1:<ApiPort> -pattern user -reset`.
	// Defaults to os/exec; tests inject a fake to assert behaviour without
	// shelling out.
	RunCmd RunCmdFunc

	// MemoryLimitBytes arms the subprocess memory watchdog for xray when > 0
	// (0 = off, the pre-2026-08 behaviour). main.go derives it from a percent
	// of host RAM. See subprocess.Config.MemoryLimitBytes for the trade-off:
	// a restart drops live connections, so this ceiling is meant to sit high.
	//
	// xray specifically because that is where the memory problem showed up in
	// the field (XHTTP inbounds); the mechanism itself is protocol-agnostic
	// and can be armed for other cores by passing a limit the same way.
	MemoryLimitBytes uint64
}

// RunCmdFunc executes an external command synchronously and returns its
// combined output. Mirrors the type used by Hysteria/AmneziaWG/Naive
// adapters for consistency.
type RunCmdFunc func(ctx context.Context, name string, args ...string) ([]byte, error)

type Adapter struct {
	cfg    Config
	logger *slog.Logger

	// mu protects in-memory state (users, cfg.Inbound, proc, started). Held
	// ONLY for fast ops. The slow config-render + subprocess Stop/Start runs
	// under restartMu, so Healthy()/GetStats (which take mu briefly) never
	// block behind a multi-second restart. Bug #1.
	mu      sync.Mutex
	users   map[string]xrayClient // key: userId
	started bool                  // set true after first successful regenerateAndRestart

	// version caches the parsed `xray version` output (e.g. "26.3.27"). Queried
	// once lazily on the first CoreVersion() call and cached: the binary can't
	// change without an agent restart, so a single fork is enough. versionDone
	// guards against re-forking when the query legitimately yields "".
	version     string
	versionDone bool

	// cascade holds the optional C3 chaining fragments (link-in inbound,
	// link-out outbound, routing rules) for THIS node's hop, pushed by the
	// panel via ApplyInbound. nil = node is not part of any cascade, in which
	// case rendering is byte-identical to a plain node.
	cascade *CascadeFragments

	// selfSteal is the K9-B local TLS fallback, running only while the inbound
	// is REALITY self-steal mode. nil otherwise. Lifecycle is managed in
	// regenerateAndRestart under restartMu; the field is read under a.mu.
	selfSteal *selfStealServer

	proc *subprocess.Subprocess

	// Restart tally (under mu). Lives on the ADAPTER, not on Subprocess, on
	// purpose: every config push builds a fresh Subprocess, so per-process
	// counters would reset to zero at the worst possible moment. Fed by
	// recordRestart via subprocess.Config.OnRestart, read by RestartStats.
	restartsCrash     int
	restartsMemory    int
	lastRestartAt     time.Time
	lastRestartReason string
	// countingSince: when this adapter started tallying (agent start). Sent
	// alongside the counters so a bare "3 restarts" has a time window.
	countingSince time.Time

	// inbounds holds every inbound the panel has pushed, keyed by its panel id.
	// cfg.Inbound remains the install-time/legacy single inbound and is used
	// when the panel is older and sends no id.
	//
	// A map rather than a slice: a push REPLACES one inbound by identity, and
	// the panel sends them one call at a time. Order is restored on render by
	// sorting on the key, so a config regenerated from the same state is
	// byte-identical - otherwise every push would look like a change and
	// restart the core for nothing.
	inbounds map[string]InboundConfig

	// restartMu serializes regenerateAndRestart so concurrent config changes
	// can't race the subprocess swap. Never held together with mu across IO.
	restartMu sync.Mutex
}

// RetainInbounds implements core.InboundReconciler: forget every inbound the
// panel no longer sends, then re-render if anything was dropped.
//
// This is what makes deletion work at all. The push arrives inbound by inbound,
// so an adapter that only ever adds keeps serving a deleted one indefinitely -
// a listener the operator believes is gone, still accepting its old users.
//
// A push carrying NO xray inbounds is meaningful, not a no-op to ignore: it
// means the last one was removed. Note the deliberate exception below for the
// legacy single inbound.
func (a *Adapter) RetainInbounds(keep []string) error {
	keepSet := make(map[string]struct{}, len(keep))
	for _, id := range keep {
		keepSet[id] = struct{}{}
	}

	a.mu.Lock()
	dropped := make([]string, 0)
	for id := range a.inbounds {
		if _, ok := keepSet[id]; !ok {
			delete(a.inbounds, id)
			dropped = append(dropped, id)
		}
	}
	remaining := len(a.inbounds)
	// The install-time inbound has no panel id and is not managed here; it only
	// applies while the panel has pushed nothing identified, and only when it is
	// usable at all. On a node installed empty it carries no REALITY key, so
	// with the last inbound gone there is nothing to fall back TO - the node
	// then serves nobody, which is a legitimate state and not an error.
	legacyOnly := remaining == 0 && a.cfg.Inbound.RealityPrivateKey != ""
	servesNobody := remaining == 0 && !legacyOnly
	a.mu.Unlock()

	if len(dropped) == 0 {
		return nil
	}
	a.logger.Info("xray: inbounds removed by the panel, regenerating",
		"dropped", dropped, "remaining", remaining,
		"fallingBackToInstallTime", legacyOnly, "servesNobody", servesNobody)
	return a.regenerateAndRestart(context.Background())
}

// inboundTagFor derives a per-inbound xray tag from the panel's inbound id.
//
// Unique because xray refuses a config with two identically tagged inbounds -
// and refuses the WHOLE config, so a clash would take every inbound down, not
// just the offender. Stable because traffic counters are tagged with it: a tag
// that changed between pushes would read as a new inbound and zero the
// accounting on this node.
//
// Derived from the id rather than random for that same reason, and prefixed
// with the base tag so a human reading the config still sees what it is.
func inboundTagFor(inboundID, baseTag string) string {
	short := inboundID
	if len(short) > 8 {
		short = short[:8]
	}
	if baseTag == "" {
		baseTag = "vless-in"
	}
	return baseTag + "-" + short
}

// recordRestart accumulates what the supervisor did. Called from the
// subprocess watcher goroutine with no subprocess lock held, so taking a.mu
// here keeps the existing a.mu -> subprocess.mu ordering intact.
func (a *Adapter) recordRestart(ev subprocess.RestartEvent) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if ev.Reason == subprocess.RestartReasonMemory {
		a.restartsMemory++
	} else {
		a.restartsCrash++
	}
	a.lastRestartAt = ev.At
	a.lastRestartReason = string(ev.Reason)
}

// RestartStats implements the optional core.RestartReporter interface so
// /healthz can surface the tally (and the panel can put it on the node card).
func (a *Adapter) RestartStats() core.RestartStats {
	a.mu.Lock()
	st := core.RestartStats{
		Crash:            a.restartsCrash,
		Memory:           a.restartsMemory,
		LastAt:           a.lastRestartAt,
		LastReason:       a.lastRestartReason,
		SinceAt:          a.countingSince,
		MemoryLimitBytes: a.cfg.MemoryLimitBytes,
	}
	proc := a.proc
	a.mu.Unlock()
	// Sampled outside a.mu: RSSBytes takes the subprocess lock, and there is no
	// reason to hold both.
	if proc != nil {
		st.RSSBytes = proc.RSSBytes()
	}
	return st
}

// New builds an adapter; nothing is spawned until Start is called.
func New(cfg Config, logger *slog.Logger) *Adapter {
	if cfg.RunCmd == nil {
		cfg.RunCmd = defaultRunCmd
	}
	return &Adapter{
		cfg:           cfg,
		logger:        logger,
		users:         make(map[string]xrayClient),
		inbounds:      make(map[string]InboundConfig),
		countingSince: time.Now(),
	}
}

func defaultRunCmd(ctx context.Context, name string, args ...string) ([]byte, error) {
	return exec.CommandContext(ctx, name, args...).CombinedOutput()
}

func (a *Adapter) Name() string { return Name }

// Engine reports the native proxy core (xray-core).
func (a *Adapter) Engine() string { return "xray" }

// CoreVersion returns the xray-core version (e.g. "26.3.27") from `xray version`,
// queried once and cached. Returns "" in config-only mode (no binary) or if the
// query fails. Implements the optional core.Versioner interface so /healthz can
// surface it; the panel gates cascade exit selection (vlessRoute) on >= 25.9.5.
func (a *Adapter) CoreVersion() string {
	a.mu.Lock()
	if a.versionDone {
		v := a.version
		a.mu.Unlock()
		return v
	}
	bin := a.cfg.BinaryPath
	run := a.cfg.RunCmd
	a.mu.Unlock()

	v := ""
	if bin != "" && run != nil {
		ctx, cancel := context.WithTimeout(context.Background(), apiCallTimeout)
		out, err := run(ctx, bin, "version")
		cancel()
		if err == nil {
			v = parseXrayVersion(out)
		} else {
			a.logger.Warn("xray version query failed", "err", err)
		}
	}

	a.mu.Lock()
	a.version = v
	a.versionDone = true
	a.mu.Unlock()
	return v
}

// parseXrayVersion pulls the semver token out of `xray version` output, whose
// first line reads "Xray 26.3.27 (Xray, Penetrates Everything.) <hash> ...".
// Returns "" if the shape is unexpected.
func parseXrayVersion(out []byte) string {
	line := string(out)
	if i := strings.IndexAny(line, "\r\n"); i >= 0 {
		line = line[:i]
	}
	fields := strings.Fields(line)
	if len(fields) >= 2 && strings.EqualFold(fields[0], "Xray") {
		return fields[1]
	}
	return ""
}

// Provisioned implements core.Provisionable: xray can run once it has either a
// pushed inbound or install-time REALITY keys. Shares the condition with Start
// so "deferred" and "not provisioned" cannot drift apart.
func (a *Adapter) Provisioned() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return len(a.inbounds) > 0 || a.cfg.Inbound.RealityPrivateKey != ""
}

// Start writes the initial config to disk and spawns xray.
// If REALITY keys are not yet configured (deferred via ApplyInbound), Start
// is a no-op, the adapter will activate on the first ApplyInbound call.
func (a *Adapter) Start(ctx context.Context) error {
	if !a.Provisioned() {
		a.logger.Info("xray adapter: no REALITY key yet, waiting for ApplyInbound from panel")
		return nil
	}
	return a.regenerateAndRestart(ctx)
}

// Stop terminates the subprocess and the K9-B self-steal fallback. The on-disk
// config is left in place. Reads+clears the shared fields under a.mu, then does
// the slow Shutdown/Stop with the lock released (a.mu is never held across IO).
func (a *Adapter) Stop(ctx context.Context) error {
	a.mu.Lock()
	a.started = false
	proc := a.proc
	a.proc = nil
	ss := a.selfSteal
	a.selfSteal = nil
	a.mu.Unlock()

	if ss != nil {
		if err := ss.stop(ctx); err != nil {
			a.logger.Warn("xray self-steal stop failed", "err", err)
		}
	}
	if proc == nil {
		return nil
	}
	return proc.Stop(ctx)
}

// AddUser registers the user with the adapter. N1: it first tries a LIVE add
// via xray's HandlerService (`xray api adu`) so existing connections aren't
// dropped; only if that isn't possible (xray not up yet, config-only mode, or
// the API call fails) does it fall back to a full config-regen + restart.
//
// Idempotent: re-adding the same user with the same UUID is a no-op.
func (a *Adapter) AddUser(user core.User) error {
	if user.XrayUUID == "" {
		// User has no Xray credentials, nothing to do.
		return nil
	}
	a.mu.Lock()
	existing, exists := a.users[user.UserID]
	// Empty flow is intentional for xhttp/ws/grpc/kcp/httpupgrade, Vision
	// only works with raw (TCP). Earlier versions silently coerced empty to
	// "xtls-rprx-vision" as a defensive default; that breaks non-raw
	// transports because xray rejects clients with mismatched flow vs the
	// inbound's transport. Trust the panel-side flow value as-is.
	desired := xrayClient{
		ID:    user.XrayUUID,
		Email: user.UserID,
		Flow:  a.cfg.Inbound.Flow,
	}
	if exists && existing == desired {
		a.mu.Unlock()
		return nil
	}
	a.users[user.UserID] = desired
	// Dormant guard: with no REALITY key yet (ApplyInbound not received from the
	// panel) a full config render fails with "RealityPrivateKey is required".
	// The user is already cached above and will be flushed by the first
	// regenerateAndRestart that ApplyInbound triggers once the key arrives, so
	// defer instead of erroring. Mirrors Start(), which no-ops under the same
	// condition. Without this, backfill retries render on every poll and spam
	// WARN while the inbound stays unconfigured.
	dormant := a.cfg.Inbound.RealityPrivateKey == ""
	a.mu.Unlock()
	if dormant {
		return nil
	}
	if a.liveUpdateUser(context.Background(), liveAdd, desired) {
		return nil
	}
	return a.regenerateAndRestart(context.Background())
}

// RemoveUser drops the user. N1: tries a live remove (`xray api rmu`) first,
// falling back to a restart. Idempotent: removing an unknown user is a no-op.
func (a *Adapter) RemoveUser(userID string) error {
	a.mu.Lock()
	removed, ok := a.users[userID]
	if !ok {
		a.mu.Unlock()
		return nil
	}
	delete(a.users, userID)
	// Dormant guard: same rationale as AddUser. The cache is already updated;
	// with no REALITY key there is no running xray to update and a render would
	// fail, so defer to the next ApplyInbound-driven regenerateAndRestart.
	dormant := a.cfg.Inbound.RealityPrivateKey == ""
	a.mu.Unlock()
	if dormant {
		return nil
	}
	if a.liveUpdateUser(context.Background(), liveRemove, removed) {
		return nil
	}
	return a.regenerateAndRestart(context.Background())
}

type liveOp int

const (
	liveAdd liveOp = iota
	liveRemove
)

// buildAduInbound renders the JSON that `xray api adu` consumes. It MUST be a
// full config with a top-level "inbounds" array: adu parses the file via
// serial.DecodeJSONConfig and reads conf.InboundConfigs (the "inbounds" key). A
// bare {tag,protocol,settings} object decodes to ZERO inbounds, so xray adds
// nobody yet exits 0 (prints "Added 0 user(s)"), which silently no-ops the live
// add. The single inbound carries the tag + protocol + a settings block with
// just the one user; buildUserInboundSettings keeps the client shape identical
// to the full config (vless -> clients[{id,email,flow}], trojan -> clients[
// {password,email}], etc).
// servedInboundsLocked returns the inbounds this adapter currently serves, in a
// deterministic order. a.mu MUST be held.
//
// The map is keyed by id, so the keys are sorted: without that the rendered
// config would differ between identical states and every push would look like a
// change. The install-time inbound is the answer only while the panel has pushed
// nothing identified - once it has, those are the truth.
func (a *Adapter) servedInboundsLocked() []InboundConfig {
	ids := make([]string, 0, len(a.inbounds))
	for id := range a.inbounds {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	out := make([]InboundConfig, 0, len(ids))
	for _, id := range ids {
		out = append(out, a.inbounds[id])
	}
	if len(out) == 0 {
		return []InboundConfig{a.cfg.Inbound}
	}
	return out
}

// buildAduPayload builds the `xray api adu` document that adds one user to EVERY
// inbound the adapter serves.
//
// One entry per inbound, not one for the install-time inbound: a user has to
// exist on all of them, and the tags of the running config come from the pushed
// inbound ids (see inboundTagFor). Naming a tag that isn't in the running config
// makes adu add nobody, which sends AddUser down the restart path - and a restart
// drops every live connection on the node. That is exactly what happened on the
// field fleet the day multi-inbound landed: every single user added restarted the
// core, and long-lived sessions (a cascade, an SSH session through it) died with
// it.
func buildAduPayload(inbounds []InboundConfig, target xrayClient) ([]byte, error) {
	entries := make([]any, 0, len(inbounds))
	for _, in := range inbounds {
		entries = append(entries, buildAduInboundEntry(in, target))
	}
	return json.Marshal(map[string]any{"inbounds": entries})
}

func buildAduInboundEntry(inbound InboundConfig, target xrayClient) map[string]any {
	c := inbound.withDefaults()
	// listen+port must be present. adu re-validates this inbound through the
	// same conf.InboundDetour path as a full config, which rejects an AnyIP
	// listener with no port ("Listen on AnyIP but no Port(s) set in
	// InboundDetour"). Without them adu exits 0 having added 0 users, so every
	// live add silently no-ops into a full xray restart (dropping all live
	// connections; on a cascade entry that tears down the whole chain).
	// withDefaults() guarantees both (the real pushed port, else 443); adu never
	// binds the socket, the port only has to satisfy config validation. Mirrors
	// the full render in config.go.
	return map[string]any{
		// Whatever tag the renderer used for this inbound - ApplyInbound already
		// derived it from the panel's inbound id, so this is the tag the running
		// config actually carries.
		"tag":      c.Tag,
		"listen":   c.ListenHost,
		"port":     c.ListenPort,
		"protocol": userInboundProtocol(c),
		"settings": buildUserInboundSettings(c, []xrayClient{target}),
	}
}

// liveUpdateUser performs a single add/remove against the RUNNING xray via the
// HandlerService and keeps the on-disk config in sync. Returns true on success;
// false tells the caller to fall back to a full restart. restartMu-guarded so
// it can't race a regenerateAndRestart; a.mu only for the fast snapshot.
func (a *Adapter) liveUpdateUser(ctx context.Context, op liveOp, target xrayClient) bool {
	a.restartMu.Lock()
	defer a.restartMu.Unlock()

	a.mu.Lock()
	clients := sortedClients(a.users)
	// EVERY inbound this node serves, not just the install-time one. A user
	// belongs on all of them, and the tags of the running config come from the
	// pushed inbound ids - so a live op aimed at the install-time inbound names
	// a tag that is not there, adds nobody, and sends the caller into a restart.
	inbounds := a.servedInboundsLocked()
	cascade := a.cascade
	cfgPath := a.cfg.ConfigPath
	binPath := a.cfg.BinaryPath
	run := a.cfg.RunCmd
	proc := a.proc
	a.mu.Unlock()

	// Live mgmt only works against a running xray (HandlerService up). In
	// config-only mode, before the first start, or mid-restart, bail to the
	// restart path.
	if binPath == "" || run == nil || proc == nil || !proc.Running() {
		return false
	}

	// Keep the on-disk config current so a later restart has the same user set
	// (and the same cascade fragments). Rendered from the full inbound set, the
	// same way regenerateAndRestart does it: rendering the single install-time
	// inbound here would overwrite a multi-inbound config on disk with one that
	// serves a fraction of it.
	blob, err := renderMultiConfig(inbounds, clients, cascade, inbounds[0].withDefaults().ApiPort)
	if err != nil {
		return false
	}
	if cfgPath != "" {
		if err := writeConfig(cfgPath, blob); err != nil {
			return false
		}
	}

	// The api port is install-time identity and identical across inbounds; the
	// renderer emits one management inbound for the whole core.
	cfg := inbounds[0].withDefaults()
	cctx, cancel := context.WithTimeout(ctx, apiCallTimeout)
	defer cancel()
	server := fmt.Sprintf("--server=127.0.0.1:%d", cfg.ApiPort)

	switch op {
	case liveAdd:
		data, err := buildAduPayload(inbounds, target)
		if err != nil {
			return false
		}
		tmp, err := os.CreateTemp("", "ice-xray-adu-*.json")
		if err != nil {
			return false
		}
		tmpPath := tmp.Name()
		defer os.Remove(tmpPath)
		if _, err := tmp.Write(data); err != nil {
			_ = tmp.Close()
			return false
		}
		if err := tmp.Close(); err != nil {
			return false
		}
		out, err := runLiveOp(cctx, run, binPath, "api", "adu", server, tmpPath)
		if err != nil {
			a.logger.Warn("xray api adu failed; falling back to restart",
				"email", target.Email, "err", err, "out", strings.TrimSpace(string(out)))
			return false
		}
		// adu exits 0 even when it adds nobody (bad payload, per-user gRPC error).
		// Trust the "Added N user(s)" count, not the exit code, or a silent no-op
		// would skip the restart fallback and the user would never go live.
		//
		// The count must reach the number of inbounds: adding the user to two of
		// three would pass a >=1 check while leaving them unable to connect on the
		// third, and nothing would ever say so.
		if !liveOpSucceeded(out, "Added", len(inbounds)) {
			a.logger.Warn("xray api adu did not add the user on every inbound; falling back to restart",
				"email", target.Email, "inbounds", len(inbounds),
				"out", strings.TrimSpace(string(out)))
			return false
		}
		a.logger.Info("xray user added live (no restart)",
			"email", target.Email, "inbounds", len(inbounds))
		return true
	case liveRemove:
		// rmu takes ONE tag per call, so walk the inbounds. A user we failed to
		// remove anywhere is still connectable there, which is the whole point of
		// removing them - so any miss falls back to the restart.
		for _, in := range inbounds {
			tag := in.withDefaults().Tag
			out, err := runLiveOp(cctx, run, binPath, "api", "rmu", server, "-tag="+tag, target.Email)
			if err != nil {
				a.logger.Warn("xray api rmu failed; falling back to restart",
					"email", target.Email, "tag", tag, "err", err,
					"out", strings.TrimSpace(string(out)))
				return false
			}
			// Same as adu: rmu exits 0 even on a per-user failure (e.g. the inbound
			// isn't a live UserManager). A restart actually applies the removal.
			if !liveOpSucceeded(out, "Removed", 1) {
				a.logger.Warn("xray api rmu removed no user (exit 0); falling back to restart",
					"email", target.Email, "tag", tag, "out", strings.TrimSpace(string(out)))
				return false
			}
		}
		a.logger.Info("xray user removed live (no restart)",
			"email", target.Email, "inbounds", len(inbounds))
		return true
	default:
		return false
	}
}

// runLiveOp runs an `xray api` subcommand, retrying briefly on a process-level
// failure. Right after a restart xray is up (proc.Running()) but may not yet be
// listening on the loopback api port, so the first adu/rmu gets connection-
// refused; a short bounded retry rides out that window instead of falling back
// to a connection-dropping restart. The caller's context caps total time.
func runLiveOp(ctx context.Context, run RunCmdFunc, binary string, args ...string) ([]byte, error) {
	var out []byte
	var err error
	for attempt := 0; attempt < 6; attempt++ {
		out, err = run(ctx, binary, args...)
		if err == nil {
			return out, nil
		}
		select {
		case <-ctx.Done():
			return out, err
		case <-time.After(250 * time.Millisecond):
		}
	}
	return out, err
}

// liveOpSucceeded parses xray's "<verb> N user(s) in total." summary line and
// reports whether N reached `want`. `xray api adu`/`rmu` print per-user errors
// but still exit 0, so the process exit code is not a success signal; the count
// is. verb is "Added" (adu) or "Removed" (rmu).
//
// `want` is the number of inbounds the operation covered: one adu call carries
// an entry per inbound, and a partial success there means the user is live on
// some of them and missing on the rest, silently.
func liveOpSucceeded(out []byte, verb string, want int) bool {
	if want < 1 {
		want = 1
	}
	s := string(out)
	idx := strings.Index(s, verb+" ")
	if idx < 0 {
		return false
	}
	rest := s[idx+len(verb)+1:]
	n, seen := 0, false
	for i := 0; i < len(rest) && rest[i] >= '0' && rest[i] <= '9'; i++ {
		n = n*10 + int(rest[i]-'0')
		seen = true
	}
	return seen && n >= want
}

// GetStats reports two things from xray's StatsService, read non-destructively
// (no -reset) over the loopback gRPC inbound so both stay cumulative and the
// panel deltas them against its own snapshots:
//
//   - Users[]: per-user cumulative counters for billing. Queried only when there
//     are tracked users.
//   - TotalBytesIn/Out: the node's inbound total (load), summed across all
//     inbounds except the api inbound. Queried whenever xray is up, even with no
//     tracked users, so a cascade exit node still reports the traffic it relayed
//     through a link-in inbound that has no per-user email.
//
// Degrades softly: config-only mode (no BinaryPath) or a failed query returns
// what it can rather than erroring, so one bad poll doesn't stall the panel's
// stats loop or corrupt user_traffic.
func (a *Adapter) GetStats() (*core.Stats, error) {
	a.mu.Lock()
	binary := a.cfg.BinaryPath
	apiPort := a.cfg.Inbound.ApiPort
	if apiPort == 0 {
		apiPort = 8080 // mirror withDefaults
	}
	users := make([]core.UserStats, 0, len(a.users))
	for id := range a.users {
		users = append(users, core.UserStats{UserID: id})
	}
	run := a.cfg.RunCmd
	proc := a.proc
	a.mu.Unlock()

	if binary == "" || run == nil {
		// Config-only mode: report tracked users with zero counters.
		return &core.Stats{Users: users}, nil
	}

	// No core running: there is nothing to ask, and asking anyway used to write
	// two WARN lines every 30 seconds, for as long as the core stayed down. On a
	// node waiting for its first config that is a permanent stream of warnings
	// about a state that is entirely normal, and on a node whose core really did
	// die it buries the one line that says why under thousands that do not.
	//
	// The counters are cumulative and read non-destructively, so skipping a poll
	// loses nothing: the next successful one reports the same totals.
	if proc == nil || !proc.Running() {
		a.logger.Debug("xray GetStats: core not running, skipping the query", "users", len(users))
		return &core.Stats{Users: users}, nil
	}

	ctx := context.Background()

	// Per-user counters (billing). N2: skip the fork when there are no tracked
	// users, a drained node otherwise paid a statsquery exec every poll for an
	// empty result.
	out := make([]core.UserStats, 0, len(users))
	var userIn, userOut int64
	if len(users) > 0 {
		counters, err := queryUserStats(ctx, run, binary, apiPort)
		if err != nil {
			// Soft-fail: emit NO per-user rows this poll, not zero-counter rows.
			// Zero-counter rows would read as a cumulative drop to 0 and re-baseline
			// the panel's per-user snapshots, spiking each user's quota on recovery.
			// The node total below still reports via the inbound query.
			a.logger.Warn("xray GetStats: user statsquery failed, skipping per-user this poll", "err", err)
		} else {
			for _, u := range users {
				c := counters[u.UserID]
				out = append(out, core.UserStats{UserID: u.UserID, BytesIn: c.UplinkBytes, BytesOut: c.DownlinkBytes})
				userIn += c.UplinkBytes
				userOut += c.DownlinkBytes
			}
		}
	}

	// Node load = inbound total (counts a cascade link-in inbound that the
	// per-user query can't see). Queried even with zero tracked users.
	totalIn, totalOut, inErr := queryInboundStats(ctx, run, binary, apiPort)
	if inErr != nil {
		// Fall back to the per-user cumulative sum so a transient inbound-query
		// failure doesn't report a spurious zero node total, which the panel
		// would read as a counter reset and then spike on recovery.
		a.logger.Warn("xray GetStats: inbound statsquery failed, using per-user sum for node total", "err", inErr)
		totalIn, totalOut = userIn, userOut
	}

	return &core.Stats{
		Users:         out,
		TotalBytesIn:  totalIn,
		TotalBytesOut: totalOut,
		// Non-destructive read (no -reset): Users[] and the inbound total are
		// cumulative, so the panel computes deltas against its snapshots.
		Cumulative: true,
	}, nil
}

// Healthy reports whether the subprocess is running. In config-only mode
// (no BinaryPath) the adapter is considered healthy as soon as Start has
// successfully written the config.
func (a *Adapter) Healthy() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	if !a.started {
		return false
	}
	if a.cfg.BinaryPath == "" {
		return true
	}
	return a.proc != nil && a.proc.Running()
}

// xrayInboundCfgWire mirrors `XrayInboundCfg` in packages/shared/src/transport.ts.
// Field tags match the wire JSON the panel sends via /applyInbounds.
type xrayInboundCfgWire struct {
	// Which inbound this config is. The panel sends the binding id; it is
	// stable for the life of the inbound, which matters because traffic
	// counters end up tagged with it.
	//
	// Read but not yet acted on: the adapter still holds exactly one inbound
	// (see cfg.Inbound), so a second push overwrites the first. Keying the
	// stored inbounds on this is the next step, and it has to land in one
	// piece - a half-done version renders a config xray rejects, which takes
	// the whole core down rather than one inbound.
	//
	// Empty from a pre-multi-inbound panel; treated as "the single inbound".
	InboundID          string   `json:"inboundId"`
	RealityDest        string   `json:"realityDest"`
	RealityServerNames []string `json:"realityServerNames"`
	RealityShortIDs    []string `json:"realityShortIds"`
	RealityPrivateKey  string   `json:"realityPrivateKey"`
	RealityPublicKey   string   `json:"realityPublicKey"`
	Flow               string   `json:"flow"`
	Fingerprint        string   `json:"fingerprint"`
	Network            string   `json:"network"`
	Path               string   `json:"path,omitempty"`
	Host               string   `json:"host,omitempty"`
	ServiceName        string   `json:"serviceName,omitempty"`
	// B3: extra xray knobs. Defaults (0 / "" / false) render identically to
	// pre-B3 configs, so omitting them keeps existing nodes byte-stable.
	RealityXver        int `json:"realityXver,omitempty"`
	RealityMaxTimeDiff int `json:"realityMaxTimeDiff,omitempty"`
	// G: throttle unverified REALITY fallback (probe) connections. 0 = off,
	// renders byte-identically to pre-G configs (omitempty).
	RealityLimitFallbackUploadBytesPerSec   int    `json:"realityLimitFallbackUploadBytesPerSec,omitempty"`
	RealityLimitFallbackDownloadBytesPerSec int    `json:"realityLimitFallbackDownloadBytesPerSec,omitempty"`
	TLSRejectUnknownSni                     bool   `json:"tlsRejectUnknownSni,omitempty"`
	XhttpMode                               string `json:"xhttpMode,omitempty"`
	XhttpPaddingBytes                       string `json:"xhttpPaddingBytes,omitempty"`
	GrpcMultiMode                           bool   `json:"grpcMultiMode,omitempty"`
	// Slice 24c part 3, controls inbound `protocol` (vless vs trojan) and
	// `settings.clients` shape. Empty/missing → vless (back-compat).
	Subprotocol string `json:"subprotocol,omitempty"`
	// Stream security: "reality" (default/empty), "none" (plain transport,
	// CDN-fronted), or "tls" (node-terminated TLS with the operator's cert).
	// Reality* fields may be empty for "none"/"tls".
	Security      string `json:"security,omitempty"`
	TLSServerName string `json:"tlsServerName,omitempty"`
	TLSCert       string `json:"tlsCert,omitempty"`
	TLSKey        string `json:"tlsKey,omitempty"`
	// K9-B: REALITY mode: "" / "steal-others" (default) or "self-steal".
	// self-steal makes the node run a local TLS fallback and point dest at it
	// (see selfsteal.go), fixing the SNI-IP mismatch that RU-DPI detects.
	RealityMode string `json:"realityMode,omitempty"`
	// G1: realistic fallback. When set (and mode is self-steal), the local TLS
	// fallback reverse-proxies probe requests to this real site instead of the
	// stub landing page (see selfsteal.go). Empty = static landing (default).
	RealityFallbackUpstream string `json:"realityFallbackUpstream,omitempty"`
	// C3: cascade chaining fragments for this node's hop (link-in inbound,
	// link-out outbound, routing rules). Generated panel-side by
	// buildCascadeConfigs; nil/missing for plain (non-cascade) nodes.
	Cascade *CascadeFragments `json:"cascade,omitempty"`

	// Warp is the optional Cloudflare WARP egress (per-node v1). nil/absent =
	// direct egress. Reuses the config.go WarpConfig type (json-tagged).
	Warp *WarpConfig `json:"warp,omitempty"`
}

// ApplyInbound parses the panel-pushed Xray config, swaps it into the live
// adapter's InboundConfig, and regenerates+restarts xray. Idempotent: if the
// new InboundConfig is byte-identical to the current one, no restart fires.
//
// The wire shape is XrayInboundCfg in packages/shared/src/transport.ts. We
// keep the parse local here so the adapter owns its protocol's contract,
// the dispatcher in server.go only routes raw JSON by protocol name.
func (a *Adapter) ApplyInbound(port int, rawCfg json.RawMessage) error {
	var wire xrayInboundCfgWire
	if err := json.Unmarshal(rawCfg, &wire); err != nil {
		return fmt.Errorf("xray ApplyInbound: parse cfg: %w", err)
	}
	// REALITY needs a private key; "none" (plain) and "tls" (own cert) do not.
	if (wire.Security == "" || wire.Security == "reality") && wire.RealityPrivateKey == "" {
		return fmt.Errorf("xray ApplyInbound: realityPrivateKey is required for REALITY security")
	}

	// Wave-14 C1: port now flows from the panel binding into REALITY's
	// listen port. Pre-wave port was install-time only and admin port
	// changes from the UI were silently dropped. Fallback chain:
	//   panel-pushed port → install-time ListenPort → 443 (withDefaults).
	effectivePort := port
	if effectivePort == 0 {
		effectivePort = a.cfg.Inbound.ListenPort
	}

	newInbound := InboundConfig{
		Tag:                     a.cfg.Inbound.Tag,        // keep existing tag - not in wire
		ListenHost:              a.cfg.Inbound.ListenHost, // install-time identity
		ListenPort:              effectivePort,            // panel-pushed wins, install-time fallback
		ApiPort:                 a.cfg.Inbound.ApiPort,    // install-time identity (slice 24c stats)
		RealityDest:             wire.RealityDest,
		RealityServerNames:      wire.RealityServerNames,
		RealityPrivateKey:       wire.RealityPrivateKey,
		RealityShortIDs:         wire.RealityShortIDs,
		Flow:                    wire.Flow,
		Network:                 wire.Network,
		Path:                    wire.Path,
		HostHeader:              wire.Host,
		ServiceName:             wire.ServiceName,
		Subprotocol:             wire.Subprotocol,
		Security:                wire.Security,
		TLSServerName:           wire.TLSServerName,
		TLSCert:                 wire.TLSCert,
		TLSKey:                  wire.TLSKey,
		RealityMode:             wire.RealityMode,
		RealityFallbackUpstream: wire.RealityFallbackUpstream,
		// B3: extra xray knobs (REALITY xver/maxTimeDiff, TLS rejectUnknownSni,
		// XHTTP mode/padding, gRPC multiMode). Zero-values render as before.
		RealityXver:        wire.RealityXver,
		RealityMaxTimeDiff: wire.RealityMaxTimeDiff,
		// G: probe-resistance fallback rate-limit (bytes/sec, 0 = off).
		RealityLimitFallbackUploadBytesPerSec:   wire.RealityLimitFallbackUploadBytesPerSec,
		RealityLimitFallbackDownloadBytesPerSec: wire.RealityLimitFallbackDownloadBytesPerSec,
		TLSRejectUnknownSni:                     wire.TLSRejectUnknownSni,
		XhttpMode:                               wire.XhttpMode,
		XhttpPaddingBytes:                       wire.XhttpPaddingBytes,
		GrpcMultiMode:                           wire.GrpcMultiMode,
		Warp:                                    wire.Warp,
	}

	// Multi-inbound: an identified inbound lives in the map under its own id, so
	// a second one ADDS rather than replaces. Its tag has to be unique inside
	// the core, and stable across pushes because traffic counters carry it, so
	// it is derived from that same id.
	//
	// No id (older panel) keeps the legacy single-inbound behaviour untouched.
	key := wire.InboundID
	if key != "" {
		newInbound.Tag = inboundTagFor(key, newInbound.Tag)
	}

	a.mu.Lock()
	// Idempotency check, same config → noop. Compare struct fields
	// instead of byte-marshalling for speed; slice equality via reflect.
	// C3: a cascade change alone (same inbound) must still trigger a restart,
	// so factor the cascade fragments into the gate.
	unchanged := cascadeEqual(a.cascade, wire.Cascade)
	if key == "" {
		unchanged = unchanged && inboundEqual(a.cfg.Inbound, newInbound)
	} else {
		prev, had := a.inbounds[key]
		unchanged = unchanged && had && inboundEqual(prev, newInbound)
	}
	if unchanged {
		a.mu.Unlock()
		a.logger.Info("xray ApplyInbound: config unchanged, skipping restart")
		return nil
	}
	if key == "" {
		a.cfg.Inbound = newInbound
	} else {
		a.inbounds[key] = newInbound
	}
	a.cascade = wire.Cascade
	count := len(a.inbounds)
	a.mu.Unlock()
	a.logger.Info("xray ApplyInbound: config changed, regenerating and restarting",
		"inboundId", key, "inboundsHeld", count,
		"sni", wire.RealityServerNames, "shortIds", len(wire.RealityShortIDs))

	// Use background context for the restart, the request that triggered
	// this call may have a short deadline and we want xray to keep coming
	// back up even if the caller times out.
	return a.regenerateAndRestart(context.Background())
}

func inboundEqual(a, b InboundConfig) bool {
	if a.RealityDest != b.RealityDest ||
		a.RealityPrivateKey != b.RealityPrivateKey ||
		a.Flow != b.Flow ||
		a.Tag != b.Tag ||
		a.ListenHost != b.ListenHost ||
		a.ListenPort != b.ListenPort ||
		a.Network != b.Network ||
		a.Path != b.Path ||
		a.HostHeader != b.HostHeader ||
		a.ServiceName != b.ServiceName ||
		a.Subprotocol != b.Subprotocol ||
		a.Security != b.Security ||
		a.TLSServerName != b.TLSServerName ||
		a.TLSCert != b.TLSCert ||
		a.TLSKey != b.TLSKey ||
		a.RealityMode != b.RealityMode ||
		a.RealityFallbackUpstream != b.RealityFallbackUpstream {
		return false
	}
	if !stringSliceEqual(a.RealityServerNames, b.RealityServerNames) {
		return false
	}
	if !stringSliceEqual(a.RealityShortIDs, b.RealityShortIDs) {
		return false
	}
	if !warpEqual(a.Warp, b.Warp) {
		return false
	}
	return true
}

// warpEqual reports whether two WARP egress configs are equivalent, so
// ApplyInbound can skip a restart when the WARP creds didn't change. nil == nil.
func warpEqual(a, b *WarpConfig) bool {
	if a == nil || b == nil {
		return a == b
	}
	if a.SecretKey != b.SecretKey || a.PublicKey != b.PublicKey ||
		a.Endpoint != b.Endpoint || a.MTU != b.MTU {
		return false
	}
	if !stringSliceEqual(a.Address, b.Address) {
		return false
	}
	if len(a.Reserved) != len(b.Reserved) {
		return false
	}
	for i := range a.Reserved {
		if a.Reserved[i] != b.Reserved[i] {
			return false
		}
	}
	return true
}

func stringSliceEqual(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// cascadeEqual reports whether two cascade fragment sets are byte-identical, so
// ApplyInbound can skip a restart when neither the inbound nor the cascade
// changed. nil == nil; nil != non-nil.
func cascadeEqual(a, b *CascadeFragments) bool {
	if a == nil || b == nil {
		return a == b
	}
	return rawSliceEqual(a.Inbounds, b.Inbounds) &&
		rawSliceEqual(a.Outbounds, b.Outbounds) &&
		rawSliceEqual(a.RoutingRules, b.RoutingRules) &&
		bytes.Equal(a.Observatory, b.Observatory) &&
		rawSliceEqual(a.Balancers, b.Balancers)
}

func rawSliceEqual(a, b []json.RawMessage) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if !bytes.Equal(a[i], b[i]) {
			return false
		}
	}
	return true
}

// regenerateAndRestart renders the current users-map to ConfigPath and
// (re)starts the xray subprocess. Bug #1: it must NOT be called with a.mu
// held. restartMu serializes restarts; a.mu is taken only for the fast
// snapshot of state and the final proc swap, so Healthy()/GetStats never
// block behind the multi-second Stop/Start.
func (a *Adapter) regenerateAndRestart(ctx context.Context) error {
	a.restartMu.Lock()
	defer a.restartMu.Unlock()

	// Snapshot the inputs under a.mu (fast), then do all IO with a.mu free.
	a.mu.Lock()
	clients := sortedClients(a.users)
	inbound := a.cfg.Inbound
	cascade := a.cascade
	cfgPath := a.cfg.ConfigPath
	binPath := a.cfg.BinaryPath
	run := a.cfg.RunCmd
	memLimit := a.cfg.MemoryLimitBytes
	// Panel-pushed inbounds, in a deterministic order: the map is keyed by id,
	// so sort the keys. Without this the rendered config would differ between
	// identical states and every push would look like a change.
	ids := make([]string, 0, len(a.inbounds))
	for id := range a.inbounds {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	pushed := make([]InboundConfig, 0, len(ids))
	for _, id := range ids {
		pushed = append(pushed, a.inbounds[id])
	}
	a.mu.Unlock()

	// The install-time inbound is used only while the panel has pushed nothing
	// identified - and only if it is actually usable. A node installed empty
	// (everything arrives from the panel, which is the normal case now) has no
	// REALITY key there, so falling back to it renders nothing at all: the
	// render fails, the previous config stays on disk, and the core keeps
	// serving inbounds the operator has deleted. Seen in the field 2026-08-10
	// when the last inbound was removed.
	//
	// With nothing to serve, that is what we render: no user inbounds, just the
	// management one. "Serves nobody" is a state, not an error.
	if len(pushed) == 0 && inbound.RealityPrivateKey != "" {
		pushed = []InboundConfig{inbound}
	}
	blob, err := renderMultiConfig(pushed, clients, cascade, inbound.withDefaults().ApiPort)
	if err != nil {
		return fmt.Errorf("render xray config: %w", err)
	}

	// Ask the core before replacing anything. A config it rejects is refused
	// WHOLE, so writing one over a working config turns a serving node into a
	// dark one, and the agent then burns its restart budget proving it. Failing
	// here instead leaves the running core untouched and hands the reason back
	// to the panel, which is the only place an operator will see it.
	if err := validateConfig(ctx, run, binPath, blob); err != nil {
		a.logger.Error("xray refused the new config, keeping the running one",
			"err", err, "inbounds", len(pushed), "users", len(clients))
		return fmt.Errorf("validate xray config: %w", err)
	}

	if cfgPath != "" {
		if err := writeConfig(cfgPath, blob); err != nil {
			return err
		}
	}

	if binPath == "" {
		// Config-only mode: nothing more to do.
		a.mu.Lock()
		a.started = true
		a.mu.Unlock()
		a.logger.Info("xray config written (config-only mode)", "users", len(clients))
		return nil
	}

	// K9-B: bring the self-steal local TLS fallback in line with the inbound's
	// REALITY mode BEFORE the xray swap, so REALITY's loopback dest
	// (127.0.0.1:8443) is already answering when xray comes back up.
	a.reconcileSelfSteal(ctx, inbound)

	// Stop the existing subprocess (keep the field pointing at it so Healthy
	// reflects "down" during the swap; xray binds a fixed port so old must
	// stop before new can bind).
	a.mu.Lock()
	old := a.proc
	a.mu.Unlock()
	if old != nil {
		if err := old.Stop(ctx); err != nil {
			a.logger.Warn("xray stop failed during restart", "err", err)
		}
	}

	proc := subprocess.New(subprocess.Config{
		Name:           Name,
		Binary:         binPath,
		Args:           []string{"run", "-c", cfgPath},
		Logger:         a.logger,
		MaxRestarts:    subprocess.DefaultMaxRestarts,
		RestartBackoff: subprocess.DefaultRestartBackoff,
		// Memory ceiling + reporting. memLimit is read under a.mu above with
		// the rest of the config snapshot; 0 leaves the watchdog disarmed.
		MemoryLimitBytes: memLimit,
		OnRestart:        a.recordRestart,
	})
	if err := proc.Start(ctx); err != nil {
		a.mu.Lock()
		a.proc = nil
		a.mu.Unlock()
		return fmt.Errorf("start xray: %w", err)
	}
	a.mu.Lock()
	a.proc = proc
	a.started = true
	a.mu.Unlock()
	a.logger.Info("xray (re)started", "users", len(clients))
	return nil
}

// reconcileSelfSteal (K9-B) starts/stops/restarts the local TLS fallback so it
// matches the inbound's REALITY mode. Called from regenerateAndRestart under
// restartMu (so it can't race itself); a.mu only guards the field read/write,
// never held across the slow start/Shutdown.
func (a *Adapter) reconcileSelfSteal(ctx context.Context, inbound InboundConfig) {
	want := inbound.RealityMode == selfStealModeValue
	domain := ""
	if want && len(inbound.RealityServerNames) > 0 {
		domain = inbound.RealityServerNames[0]
	}
	// No domain -> no cert subject -> can't run the fallback; treat as "off".
	if domain == "" {
		want = false
	}
	// G1 realistic-fallback target (only meaningful when self-steal is on).
	upstream := ""
	if want {
		upstream = inbound.RealityFallbackUpstream
	}

	a.mu.Lock()
	cur := a.selfSteal
	a.mu.Unlock()

	// Already in the desired state: off-and-nil, or on with the same domain AND
	// upstream (a changed upstream restarts the fallback with the new target).
	if !want && cur == nil {
		return
	}
	if want && cur != nil && cur.domain == domain && cur.upstream == upstream {
		return
	}

	// Stop the existing server (mode turned off, or the domain changed).
	if cur != nil {
		if err := cur.stop(ctx); err != nil {
			a.logger.Warn("xray self-steal stop failed", "err", err)
		}
		a.mu.Lock()
		a.selfSteal = nil
		a.mu.Unlock()
	}
	if !want {
		return
	}

	srv, err := startSelfSteal(selfStealAddr, domain, upstream, a.logger)
	if err != nil {
		// Non-fatal: xray still starts, but REALITY's dest (127.0.0.1:8443)
		// won't answer until the next reconcile. Surface loudly.
		a.logger.Error("xray self-steal start failed; REALITY dest will not answer",
			"domain", domain, "err", err)
		return
	}
	a.mu.Lock()
	a.selfSteal = srv
	a.mu.Unlock()
}

// sortedClients returns the user map in deterministic order so successive
// renders produce byte-identical config files (helpful for tests + diff'ing).
func sortedClients(users map[string]xrayClient) []xrayClient {
	out := make([]xrayClient, 0, len(users))
	for _, c := range users {
		out = append(out, c)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Email < out[j].Email })
	return out
}

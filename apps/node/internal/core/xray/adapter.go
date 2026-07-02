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
	// "config-only" mode (writes config.json but doesn't spawn xray) — useful
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

	// restartMu serializes regenerateAndRestart so concurrent config changes
	// can't race the subprocess swap. Never held together with mu across IO.
	restartMu sync.Mutex
}

// New builds an adapter; nothing is spawned until Start is called.
func New(cfg Config, logger *slog.Logger) *Adapter {
	if cfg.RunCmd == nil {
		cfg.RunCmd = defaultRunCmd
	}
	return &Adapter{
		cfg:    cfg,
		logger: logger,
		users:  make(map[string]xrayClient),
	}
}

func defaultRunCmd(ctx context.Context, name string, args ...string) ([]byte, error) {
	return exec.CommandContext(ctx, name, args...).CombinedOutput()
}

func (a *Adapter) Name() string { return Name }

// Start writes the initial config to disk and spawns xray.
// If REALITY keys are not yet configured (deferred via ApplyInbound), Start
// is a no-op — the adapter will activate on the first ApplyInbound call.
func (a *Adapter) Start(ctx context.Context) error {
	a.mu.Lock()
	noKey := a.cfg.Inbound.RealityPrivateKey == ""
	a.mu.Unlock()
	if noKey {
		a.logger.Info("xray adapter: no REALITY key yet — waiting for ApplyInbound from panel")
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
		// User has no Xray credentials — nothing to do.
		return nil
	}
	a.mu.Lock()
	existing, exists := a.users[user.UserID]
	// Empty flow is intentional for xhttp/ws/grpc/kcp/httpupgrade — Vision
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
	a.mu.Unlock()
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
	a.mu.Unlock()
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
//
// listen+port are REQUIRED even though adu never binds the socket: xray parses
// this payload through the same conf.InboundDetour validation as a full config,
// which rejects "Listen on AnyIP but no Port(s) set in InboundDetour". Omitting
// the port made adu add 0 users (exit 0) so liveUpdateUser fell back to a full
// xray restart on EVERY user add — dropping all live connections on the node.
// Mirror the full render (config.go) so the payload validates and the add stays
// live.
func buildAduInbound(inbound InboundConfig, target xrayClient) ([]byte, error) {
	c := inbound.withDefaults()
	return json.Marshal(map[string]any{
		"inbounds": []any{
			map[string]any{
				"tag":      c.Tag,
				"listen":   c.ListenHost,
				"port":     c.ListenPort,
				"protocol": userInboundProtocol(c),
				"settings": buildUserInboundSettings(c, []xrayClient{target}),
			},
		},
	})
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
	inbound := a.cfg.Inbound
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
	// (and the same cascade fragments).
	blob, err := renderConfigWithCascade(inbound, clients, cascade)
	if err != nil {
		return false
	}
	if cfgPath != "" {
		if err := writeConfig(cfgPath, blob); err != nil {
			return false
		}
	}

	cfg := inbound.withDefaults()
	cctx, cancel := context.WithTimeout(ctx, apiCallTimeout)
	defer cancel()
	server := fmt.Sprintf("--server=127.0.0.1:%d", cfg.ApiPort)

	switch op {
	case liveAdd:
		data, err := buildAduInbound(inbound, target)
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
		if !liveOpSucceeded(out, "Added") {
			a.logger.Warn("xray api adu added no user (exit 0); falling back to restart",
				"email", target.Email, "out", strings.TrimSpace(string(out)))
			return false
		}
		a.logger.Info("xray user added live (no restart)", "email", target.Email)
		return true
	case liveRemove:
		out, err := runLiveOp(cctx, run, binPath, "api", "rmu", server, "-tag="+cfg.Tag, target.Email)
		if err != nil {
			a.logger.Warn("xray api rmu failed; falling back to restart",
				"email", target.Email, "err", err, "out", strings.TrimSpace(string(out)))
			return false
		}
		// Same as adu: rmu exits 0 even on a per-user failure (e.g. the inbound
		// isn't a live UserManager). A restart actually applies the removal.
		if !liveOpSucceeded(out, "Removed") {
			a.logger.Warn("xray api rmu removed no user (exit 0); falling back to restart",
				"email", target.Email, "out", strings.TrimSpace(string(out)))
			return false
		}
		a.logger.Info("xray user removed live (no restart)", "email", target.Email)
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
// reports whether N >= 1. `xray api adu`/`rmu` print per-user errors but still
// exit 0, so the process exit code is not a success signal; the count is. verb
// is "Added" (adu) or "Removed" (rmu).
func liveOpSucceeded(out []byte, verb string) bool {
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
	return seen && n >= 1
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
	a.mu.Unlock()

	if binary == "" || run == nil {
		// Config-only mode: report tracked users with zero counters.
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
	// Slice 24c part 3 — controls inbound `protocol` (vless vs trojan) and
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
}

// ApplyInbound parses the panel-pushed Xray config, swaps it into the live
// adapter's InboundConfig, and regenerates+restarts xray. Idempotent: if the
// new InboundConfig is byte-identical to the current one, no restart fires.
//
// The wire shape is XrayInboundCfg in packages/shared/src/transport.ts. We
// keep the parse local here so the adapter owns its protocol's contract —
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
	}

	a.mu.Lock()
	// Idempotency check — same config → noop. Compare struct fields
	// instead of byte-marshalling for speed; slice equality via reflect.
	// C3: a cascade change alone (same inbound) must still trigger a restart,
	// so factor the cascade fragments into the gate.
	if inboundEqual(a.cfg.Inbound, newInbound) && cascadeEqual(a.cascade, wire.Cascade) {
		a.mu.Unlock()
		a.logger.Info("xray ApplyInbound: config unchanged, skipping restart")
		return nil
	}
	a.cfg.Inbound = newInbound
	a.cascade = wire.Cascade
	a.mu.Unlock()
	a.logger.Info("xray ApplyInbound: config changed, regenerating and restarting",
		"sni", wire.RealityServerNames, "shortIds", len(wire.RealityShortIDs))

	// Use background context for the restart — the request that triggered
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
		rawSliceEqual(a.RoutingRules, b.RoutingRules)
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
	a.mu.Unlock()

	blob, err := renderConfigWithCascade(inbound, clients, cascade)
	if err != nil {
		return fmt.Errorf("render xray config: %w", err)
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

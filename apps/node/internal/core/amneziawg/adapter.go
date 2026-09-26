package amneziawg

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/icecompany-tech/iceslab/apps/node/internal/core"
)

const Name = "amneziawg"

const defaultSyncTimeout = 10 * time.Second

// Config is the per-instance settings for an AmneziaWGAdapter.
type Config struct {
	// Inbound is the static interface settings (keys, ports, obfuscation).
	// Slice 23 will move these into the inbounds table per node.
	Inbound InboundConfig

	// ConfigPath is where awg-quick / awg syncconf read the interface config
	// from. Default "/etc/amnezia/amneziawg/<iface>.conf".
	ConfigPath string

	// AwgBin / AwgQuickBin / SystemctlBin are CLI paths. When AwgQuickBin is
	// empty the adapter runs in **config-only mode**: it writes the config
	// file but never invokes any CLI. That mode is what tests and dev
	// environments without amneziawg installed use.
	AwgBin       string
	AwgQuickBin  string
	SystemctlBin string

	// SyncTimeout caps how long `awg syncconf` may run before we bail out
	// and trigger the systemctl-restart fallback. Default 10s.
	//
	// The fallback exists because we've seen `awg syncconf` hang on a known
	// kernel-module bug; without a timeout the panel queue would stall.
	SyncTimeout time.Duration

	// ModuleVersion and ModuleSrcVersion: the module bootstrap-amneziawg.sh
	// built, from its env block (AMNEZIAWG_MODULE_VERSION,
	// AMNEZIAWG_MODULE_SRCVERSION). See CoreVersion. Empty on a node installed
	// before Ф7.1.
	ModuleVersion    string
	ModuleSrcVersion string

	// runCmd is an injection point for tests. nil → real exec.CommandContext.
	runCmd func(ctx context.Context, name string, args ...string) ([]byte, error)
}

// Adapter implements core.CoreAdapter for AmneziaWG.
type Adapter struct {
	cfg    Config
	logger *slog.Logger

	// restartMu serializes the slow config IO (awg-quick up/down, `awg
	// syncconf`, systemctl restart) so at most one reload runs at a time. mu
	// guards only the in-memory state below and is NEVER held across a CLI
	// fork. Lock order is always restartMu -> mu; no path upgrades mu to
	// restartMu, so the two can't deadlock (AWG#10).
	restartMu sync.Mutex
	mu        sync.Mutex
	peers     map[string]Peer // key: userId
	started   bool
	// lastStats holds the previous cumulative kernel counters per peer, keyed
	// by PublicKey to match `awg show dump`. GetStats diffs against it so the
	// panel ingests per-poll DELTAS (the same contract the xray adapter meets
	// via `statsquery -reset`). Rebuilt every poll: a pubkey's absence means
	// "first sight" (fresh agent start or just-added peer) and reports zero, so
	// an agent restart over a still-up interface never re-bills the lifetime.
	lastStats map[string]peerCounters

	// N3 - cached `awg show` health probe (guarded by mu). Healthy() serves
	// healthResult and refreshes in the background once older than
	// healthProbeTTL, so the hot health path never forks the CLI inline.
	healthCheckedAt time.Time
	healthResult    bool
	healthProbing   bool

	// legacyDropped: dropLegacyMasquerade has run in this process (E37).
	legacyDropped bool

	// What `awg --version` answered, remembered until the binary on disk
	// changes. Installed() runs on every healthcheck poll, so it cannot fork
	// each time; and "once per agent" was wrong, because bootstrap-amneziawg.sh
	// replaces the tools under a running agent (the ru-02 repair is exactly
	// that), and the node kept saying "not amneziawg" until a restart.
	tools core.VersionProbe
	// The last non-amneziawg answer already warned about (guarded by mu), so
	// a wrong binary is logged once per binary, not once per poll.
	toolsWarned string
}

type peerCounters struct {
	rx int64
	tx int64
}

func New(cfg Config, logger *slog.Logger) *Adapter {
	if cfg.ConfigPath == "" {
		cfg.ConfigPath = fmt.Sprintf("/etc/amnezia/amneziawg/%s.conf", cfg.Inbound.Interface)
		if cfg.Inbound.Interface == "" {
			cfg.ConfigPath = "/etc/amnezia/amneziawg/awg0.conf"
		}
	}
	if cfg.SyncTimeout == 0 {
		cfg.SyncTimeout = defaultSyncTimeout
	}
	if cfg.runCmd == nil {
		cfg.runCmd = realRunCmd
	}
	return &Adapter{
		cfg:       cfg,
		logger:    logger,
		peers:     make(map[string]Peer),
		lastStats: make(map[string]peerCounters),
	}
}

func realRunCmd(ctx context.Context, name string, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	out, err := cmd.CombinedOutput()
	return out, err
}

func (a *Adapter) Name() string { return Name }

// Engine reports the native proxy core (amneziawg has no alternate engine).
func (a *Adapter) Engine() string { return "amneziawg" }

// Start writes the initial (no-peer) config and brings the awg interface up.
// In config-only mode (AwgQuickBin == "") it just writes the config.
//
// Special case: on a freshly-bootstrapped node, main.go can only fill in the
// interface name and bin paths, every other field (PrivateKey, Address,
// H1-H4, S1-S4, Jc/Jmin/Jmax) lives in panel-side `Profile.config` and only
// arrives via the first `ApplyInbound` over mTLS. Calling `renderConfig`
// here would fail validation with "PrivateKey is required" and crash the
// agent in a loop. Detect that empty-config state and *defer* the bring-up
// until ApplyInbound supplies real values, that handler already calls
// restartInterfaceLocked which writes the config + awg-quick up and flips
// `started` to true. Caught live cycle #6 2026-05-12 on awg-VPS.
// Provisioned implements core.Provisionable: without a server key the interface
// cannot come up at all. Same condition Start defers on, kept as one expression
// so the two cannot drift apart.
func (a *Adapter) Provisioned() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.cfg.Inbound.PrivateKey != ""
}

func (a *Adapter) Start(ctx context.Context) error {
	a.restartMu.Lock()
	defer a.restartMu.Unlock()

	a.mu.Lock()
	if a.cfg.Inbound.PrivateKey == "" {
		iface := a.cfg.Inbound.Interface
		a.mu.Unlock()
		a.logger.Info("amneziawg adapter deferred, awaiting first ApplyInbound from panel",
			"interface", iface)
		return nil
	}
	inbound := a.cfg.Inbound
	peers := sortedPeers(a.peers)
	managed := a.cfg.AwgQuickBin != ""
	a.mu.Unlock()

	if err := a.writeConfigSnapshot(inbound, peers); err != nil {
		return err
	}

	if managed {
		if out, err := a.cfg.runCmd(ctx, a.cfg.AwgQuickBin, "up", inbound.Interface); err != nil {
			// awg-quick up is idempotent-ish, failing because the iface is
			// already up is fine. Anything else is a real error.
			if !strings.Contains(strings.ToLower(string(out)), "already exists") {
				return fmt.Errorf("awg-quick up %s failed: %w (%s)", inbound.Interface, err, strings.TrimSpace(string(out)))
			}
		}
		// An agent restart after the update is where an interface still up from
		// the old config meets the new agent first: "already exists" above, no
		// hooks run, the wide rule stays unless taken here.
		a.dropLegacyMasquerade(ctx, inbound.Interface)
	}

	a.setStarted(true)
	a.logger.Info("amneziawg adapter started",
		"interface", inbound.Interface,
		"managed", managed)
	return nil
}

// Idle implements core.Idler: no AmneziaWG inbound in the last push. Takes the
// users' interface down and forgets the server key (what Provisioned reads),
// so the same inbound pushed again is a key change and brings the interface
// back up. Peers stay in memory for that moment. A cascade leg's awg-l<n>
// tunnel is the chain's, not this adapter's, and is not touched.
func (a *Adapter) Idle(ctx context.Context) error {
	a.restartMu.Lock()
	defer a.restartMu.Unlock()
	a.mu.Lock()
	if a.cfg.Inbound.PrivateKey == "" && !a.started {
		a.mu.Unlock()
		return nil
	}
	a.cfg.Inbound.PrivateKey = ""
	a.started = false
	managed := a.cfg.AwgQuickBin != ""
	iface := a.cfg.Inbound.Interface
	a.mu.Unlock()
	a.logger.Info("amneziawg: no inbound in the last push, interface down", "interface", iface)
	if !managed {
		return nil
	}
	if _, err := a.cfg.runCmd(ctx, a.cfg.AwgQuickBin, "down", iface); err != nil {
		a.logger.Warn("awg-quick down returned non-zero (often safe)", "err", err)
	}
	return nil
}

// Stop tears the interface down. Safe to call multiple times.
func (a *Adapter) Stop(ctx context.Context) error {
	a.restartMu.Lock()
	defer a.restartMu.Unlock()

	a.mu.Lock()
	a.started = false
	managed := a.cfg.AwgQuickBin != ""
	iface := a.cfg.Inbound.Interface
	a.mu.Unlock()

	if !managed {
		return nil
	}
	if _, err := a.cfg.runCmd(ctx, a.cfg.AwgQuickBin, "down", iface); err != nil {
		// "iface not running" is expected on a clean stop after a failed start
		a.logger.Warn("awg-quick down returned non-zero (often safe)", "err", err)
	}
	return nil
}

// setStarted flips the started flag under mu. Helper so the IO paths (which run
// without mu held) can record readiness without re-deriving the lock dance.
func (a *Adapter) setStarted(v bool) {
	a.mu.Lock()
	a.started = v
	a.mu.Unlock()
}

// AddUser registers / updates a peer. No-op for users without amneziawg
// credentials. Idempotent.
func (a *Adapter) AddUser(user core.User) error {
	if user.AmneziaWGPublicKey == "" || user.AmneziaWGAllowedIP == "" {
		return nil
	}
	desired := Peer{
		PublicKey: user.AmneziaWGPublicKey,
		AllowedIP: ensureCIDR(user.AmneziaWGAllowedIP),
	}

	a.mu.Lock()
	if existing, ok := a.peers[user.UserID]; ok && existing == desired {
		a.mu.Unlock()
		return nil // no change, no IO
	}
	a.peers[user.UserID] = desired
	a.mu.Unlock()

	// IO runs under restartMu (not mu), re-snapshotting the latest peer set so
	// concurrent Add/Remove calls converge on the final config.
	return a.syncConfigState(context.Background())
}

// RemoveUser drops the peer and reloads the interface. Idempotent.
func (a *Adapter) RemoveUser(userID string) error {
	a.mu.Lock()
	if _, ok := a.peers[userID]; !ok {
		a.mu.Unlock()
		return nil
	}
	delete(a.peers, userID)
	a.mu.Unlock()

	return a.syncConfigState(context.Background())
}

// GetStats parses `awg show <iface> dump` and maps per-peer RX/TX counters
// back to user IDs via the tracked peers.
//
// Kernel counters are CUMULATIVE for the lifetime of the interface, but the
// panel's stats cron treats every adapter's per-user bytes as a delta since
// the last poll (xray meets that contract with `statsquery -reset`). So this
// adapter snapshots the cumulative values (a.lastStats) and emits the per-poll
// DELTA. Without this, the cron re-added each peer's entire lifetime total on
// every tick, endless phantom traffic that drained user quotas (the runaway
// AWG accounting bug, 2026-06-11).
//
// Two edge cases are handled so we never emit a spurious spike:
//   - First sight of a peer (fresh agent start, or peer just added): record the
//     baseline, report zero. An agent restart that leaves the interface up
//     would otherwise re-bill the whole lifetime.
//   - Counter goes backwards (interface bounced via systemctl restart /
//     awg-quick down-up zeroes kernel counters): restart the delta from the
//     current value instead of emitting a negative.
//
// In config-only mode (no AwgBin) returns zero counters per user without
// shelling out, mirroring the old stub behaviour for dev environments
// without amneziawg installed.
func (a *Adapter) GetStats() (*core.Stats, error) {
	// AWG#10 - read what we need under mu, then release it for the `awg show`
	// fork so a slow/hung dump no longer blocks AddUser/RemoveUser. The delta
	// accounting below re-acquires mu and runs verbatim (E4 contract preserved).
	a.mu.Lock()
	configOnly := a.cfg.AwgBin == ""
	iface := a.cfg.Inbound.Interface
	if configOnly {
		users := make([]core.UserStats, 0, len(a.peers))
		for id := range a.peers {
			users = append(users, core.UserStats{UserID: id})
		}
		a.mu.Unlock()
		return &core.Stats{Users: users}, nil
	}
	a.mu.Unlock()

	if iface == "" {
		iface = "awg0"
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	out, err := a.cfg.runCmd(ctx, a.cfg.AwgBin, "show", iface, "dump")

	a.mu.Lock()
	defer a.mu.Unlock()

	users := make([]core.UserStats, 0, len(a.peers))
	if err != nil {
		// Interface may be down or never started, fall back to zero counters
		// rather than failing the whole stats poll.
		for id := range a.peers {
			users = append(users, core.UserStats{UserID: id})
		}
		return &core.Stats{Users: users}, nil
	}

	rxByPub, txByPub := parseAwgDump(string(out))

	var totalIn, totalOut int64
	// Rebuild the snapshot from scratch each poll so removed peers drop out and
	// a re-added peer (its kernel counter reset to 0) is treated as first-sight.
	next := make(map[string]peerCounters, len(a.peers))
	for id, peer := range a.peers {
		curRx := rxByPub[peer.PublicKey]
		curTx := txByPub[peer.PublicKey]
		next[peer.PublicKey] = peerCounters{rx: curRx, tx: curTx}

		var dRx, dTx int64
		if last, seen := a.lastStats[peer.PublicKey]; seen {
			if curRx >= last.rx {
				dRx = curRx - last.rx
			} else {
				dRx = curRx // interface bounced, counter reset
			}
			if curTx >= last.tx {
				dTx = curTx - last.tx
			} else {
				dTx = curTx
			}
		}
		// else: first sight, baseline recorded above, count nothing this tick.

		users = append(users, core.UserStats{
			UserID:   id,
			BytesIn:  dRx,
			BytesOut: dTx,
		})
		totalIn += dRx
		totalOut += dTx
	}
	a.lastStats = next

	return &core.Stats{
		Users:         users,
		TotalBytesIn:  totalIn,
		TotalBytesOut: totalOut,
	}, nil
}

// parseAwgDump parses the TSV output of `awg show <iface> dump`. The first
// line is the interface itself; remaining lines are peers in the format:
//
//	<pubkey> <psk> <endpoint> <allowed-ips> <latest-handshake> <rx> <tx> <keepalive>
//
// Returns maps pubkey→rx-bytes and pubkey→tx-bytes. From the server's
// perspective: peer's "rx" is what the server received from the client
// (BytesIn for our user), peer's "tx" is what the server sent back
// (BytesOut for our user). Malformed lines are skipped silently.
func parseAwgDump(dump string) (rx, tx map[string]int64) {
	rx = make(map[string]int64)
	tx = make(map[string]int64)
	lines := strings.Split(strings.TrimSpace(dump), "\n")
	if len(lines) < 2 {
		return
	}
	for _, line := range lines[1:] {
		fields := strings.Fields(line)
		if len(fields) < 7 {
			continue
		}
		pub := fields[0]
		var r, t int64
		if _, err := fmt.Sscanf(fields[5], "%d", &r); err != nil {
			continue
		}
		if _, err := fmt.Sscanf(fields[6], "%d", &t); err != nil {
			continue
		}
		rx[pub] = r
		tx[pub] = t
	}
	return
}

// healthProbeTTL caps how often Healthy() shells out to `awg show`.
const healthProbeTTL = 20 * time.Second

// Healthy reports whether the adapter has finished Start successfully and
// (when managed) the awg interface still exists.
//
// N3 - the probe (`awg show`) can hang on a known kernel-module bug, which
// would block the agent's healthcheck goroutine. So we cache the last probe
// result and refresh it in the BACKGROUND once stale: the request path returns
// the cached value instantly and never forks inline. The very first call
// probes synchronously so we don't report a bogus default before any data.
//
// E34, 25.09 on nl-01: the first apply's `awg-quick up` failed (hysteria held
// 443/udp), a later peer sync's systemctl fallback brought awg0 up with its
// peers, and the node still said "not running: amneziawg", because `started`
// is flipped by an apply that succeeds and nothing on the fallback path set
// it. So a CONFIGURED interface is judged by the interface itself, whatever
// the last apply returned: the probe below, not the flag, is the answer.
func (a *Adapter) Healthy() bool {
	a.mu.Lock()
	started := a.started
	configured := a.cfg.Inbound.PrivateKey != ""
	managed := a.cfg.AwgQuickBin != ""
	iface := a.cfg.Inbound.Interface
	if !started && !configured {
		a.mu.Unlock()
		return false
	}
	if !managed {
		a.mu.Unlock()
		return started
	}

	if a.healthCheckedAt.IsZero() {
		// First probe: synchronous, so the result is real before we return.
		a.mu.Unlock()
		return a.probeHealth(iface)
	}
	if time.Since(a.healthCheckedAt) >= healthProbeTTL && !a.healthProbing {
		// Stale: kick a single background refresh, return the last-known value.
		a.healthProbing = true
		go func() {
			a.probeHealth(iface)
			a.mu.Lock()
			a.healthProbing = false
			a.mu.Unlock()
		}()
	}
	res := a.healthResult
	a.mu.Unlock()
	return res
}

// probeHealth runs `awg show <iface>` and stores the result + timestamp. Bounded
// by a 2s context so a hung CLI can't wedge the caller indefinitely.
func (a *Adapter) probeHealth(iface string) bool {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_, err := a.cfg.runCmd(ctx, a.cfg.AwgBin, "show", iface)
	ok := err == nil
	a.mu.Lock()
	a.healthResult = ok
	a.healthCheckedAt = time.Now()
	a.mu.Unlock()
	return ok
}

// ApplyInbound parses panel-pushed AmneziaWG config, classifies the diff vs
// the live cfg.Inbound, and triggers the appropriate reload:
//   - diffNone → no-op
//   - diffSyncconf (S1-S4 / Jc/Jmin/Jmax changed) → rewrite + `awg syncconf`
//   - diffRestart (H1-H4 / private key / port / iface changed) → rewrite +
//     `systemctl restart awg-quick@<iface>` (interface bounces all peers)
//   - diffSubnet (Address from subnet changed) → reject with error when
//     peers are already allocated; admins must drain peers first
//
// Background context for the reload, the inbound HTTP request that triggered
// this may have a short deadline, but we want the interface to come back up
// even if the caller times out (matches the xray adapter pattern).
func (a *Adapter) ApplyInbound(port int, rawCfg json.RawMessage) error {
	var wire inboundCfgWire
	if err := json.Unmarshal(rawCfg, &wire); err != nil {
		return fmt.Errorf("amneziawg ApplyInbound: parse cfg: %w", err)
	}

	// AWG#10 - hold restartMu across the whole apply so a concurrent AddUser
	// sync can't interleave with the interface mutation; mutate + snapshot under
	// mu, then run the reload IO without mu held. Lock order restartMu -> mu.
	a.restartMu.Lock()
	defer a.restartMu.Unlock()

	a.mu.Lock()
	// Slice 50: prefer the panel-pushed port over install-time fallback.
	// Pre-slice-50 panel paths still work because port=0 falls through to
	// a.cfg.Inbound.ListenPort below.
	listenPort := port
	if listenPort == 0 {
		listenPort = a.cfg.Inbound.ListenPort
	}
	newInbound, err := wire.toInboundConfig(a.cfg.Inbound.Interface, listenPort)
	if err != nil {
		a.mu.Unlock()
		return fmt.Errorf("amneziawg ApplyInbound: %w", err)
	}
	// Preserve install-time PostUp/PostDown and Interface defaults, those
	// aren't in the panel wire. Interface name is install-time identity; if
	// the wire expressed a new one it'd be a separate diffRestart anyway.
	newInbound.PostUp = a.cfg.Inbound.PostUp
	newInbound.PostDown = a.cfg.Inbound.PostDown

	kind := classifyDiff(a.cfg.Inbound, newInbound)
	switch kind {
	case diffNone:
		a.mu.Unlock()
		a.logger.Info("amneziawg ApplyInbound: config unchanged, skipping")
		return nil
	case diffSubnet:
		if len(a.peers) > 0 {
			n := len(a.peers)
			a.mu.Unlock()
			return fmt.Errorf("amneziawg ApplyInbound: subnet change rejected, %d peer(s) already allocated; drain peers before changing subnet", n)
		}
		// No peers: subnet change is safe and only needs a full restart to
		// re-attach the new IP to the interface.
		a.cfg.Inbound = newInbound
		inbound := a.cfg.Inbound
		peers := sortedPeers(a.peers)
		a.mu.Unlock()
		a.logger.Info("amneziawg ApplyInbound: subnet change with no peers, restarting interface",
			"address", newInbound.Address)
		return a.restartInterfaceFrom(context.Background(), inbound, peers)
	case diffSyncconf:
		a.cfg.Inbound = newInbound
		inbound := a.cfg.Inbound
		peers := sortedPeers(a.peers)
		a.mu.Unlock()
		a.logger.Info("amneziawg ApplyInbound: syncconf-eligible change", "iface", newInbound.Interface)
		return a.syncFromSnapshot(context.Background(), inbound, peers)
	case diffRestart:
		a.cfg.Inbound = newInbound
		inbound := a.cfg.Inbound
		peers := sortedPeers(a.peers)
		a.mu.Unlock()
		a.logger.Info("amneziawg ApplyInbound: interface-level change, full restart",
			"iface", newInbound.Interface)
		return a.restartInterfaceFrom(context.Background(), inbound, peers)
	default:
		a.mu.Unlock()
		return fmt.Errorf("amneziawg ApplyInbound: unknown diffKind %d", kind)
	}
}

// restartInterfaceFrom writes the given config snapshot and bounces the
// interface via awg-quick down/up. Used for changes that syncconf can't apply
// (H1-H4, keys, listen port). Caller MUST hold restartMu and MUST NOT hold mu
// (the awg-quick forks run lock-free; readiness is flipped via setStarted).
//
// In config-only mode (AwgQuickBin == "") we just rewrite the file and skip
// the actual bounce, that's what the unit tests rely on, and what dev
// machines without amneziawg installed need.
func (a *Adapter) restartInterfaceFrom(parent context.Context, inbound InboundConfig, peers []Peer) error {
	if err := a.writeConfigSnapshot(inbound, peers); err != nil {
		return err
	}
	if a.cfg.AwgQuickBin == "" {
		a.logger.Info("amneziawg restart skipped (config-only mode)")
		a.setStarted(true)
		return nil
	}
	ctx, cancel := context.WithTimeout(parent, 30*time.Second)
	defer cancel()

	if out, err := a.cfg.runCmd(ctx, a.cfg.AwgQuickBin, "down", inbound.Interface); err != nil {
		// "iface not running" is fine, we're about to bring it up.
		a.logger.Warn("awg-quick down returned non-zero (often safe)",
			"err", err, "out", strings.TrimSpace(string(out)))
	}
	if out, err := a.cfg.runCmd(ctx, a.cfg.AwgQuickBin, "up", inbound.Interface); err != nil {
		return fmt.Errorf("awg-quick up %s: %w (%s)", inbound.Interface, err, strings.TrimSpace(string(out)))
	}
	// Mark started so Healthy() returns true and main.go's heartbeat sees
	// a ready adapter after the first ApplyInbound on a freshly-bootstrapped
	// node (Start() returned early because PrivateKey was empty), and drop the
	// cached probe so it is asked afresh.
	a.interfaceChanged()
	a.dropLegacyMasquerade(ctx, inbound.Interface)
	a.logger.Info("amneziawg interface bounced", "iface", inbound.Interface)
	return nil
}

// syncConfigState serializes config IO under restartMu, then snapshots the
// CURRENT peer set + inbound under mu and writes + reloads without mu held.
// Used by AddUser/RemoveUser. Concurrent callers converge: whoever runs the IO
// re-reads the latest peers, so no peer is dropped to a stale snapshot.
func (a *Adapter) syncConfigState(ctx context.Context) error {
	a.restartMu.Lock()
	defer a.restartMu.Unlock()

	a.mu.Lock()
	inbound := a.cfg.Inbound
	peers := sortedPeers(a.peers)
	a.mu.Unlock()

	return a.syncFromSnapshot(ctx, inbound, peers)
}

// syncFromSnapshot writes the given config snapshot and (when managed) reloads
// the running interface via `awg syncconf`, falling back to `systemctl restart
// awg-quick@<iface>` on failure or timeout. Caller MUST hold restartMu and MUST
// NOT hold mu.
func (a *Adapter) syncFromSnapshot(ctx context.Context, inbound InboundConfig, peers []Peer) error {
	if err := a.writeConfigSnapshot(inbound, peers); err != nil {
		return err
	}

	if a.cfg.AwgQuickBin == "" {
		a.logger.Info("amneziawg config written (config-only mode)", "peers", len(peers))
		return nil
	}

	if err := a.syncconf(ctx, inbound.Interface); err != nil {
		a.logger.Warn("awg syncconf failed; falling back to systemctl restart", "err", err)
		if err := a.restartViaSystemctl(ctx, inbound.Interface); err != nil {
			return err
		}
		// The fallback brought the interface up: that is a running core, and
		// the next healthcheck asks the interface afresh (E34).
		a.interfaceChanged()
		a.dropLegacyMasquerade(ctx, inbound.Interface)
		return nil
	}
	a.interfaceChanged()
	a.dropLegacyMasquerade(ctx, inbound.Interface)
	a.logger.Info("amneziawg synced", "peers", len(peers))
	return nil
}

// interfaceChanged: the interface was just brought up or reloaded. Marks the
// adapter started and drops the cached probe, so the next Healthy asks
// `awg show` now instead of repeating what it saw before the change.
func (a *Adapter) interfaceChanged() {
	a.mu.Lock()
	a.started = true
	a.healthCheckedAt = time.Time{}
	a.mu.Unlock()
}

// legacyDropAttempts bounds the loop below: each `iptables -D` removes one
// copy, and an interface bounced with a failing PostDown can have left more.
const legacyDropAttempts = 8

// dropLegacyMasquerade takes the pre-E37 MASQUERADE rule (`! -o <iface>`, no
// source, which also caught loopback and broke the node's stub resolver) out of
// POSTROUTING. A node updated from before E37 keeps it from its last `awg-quick
// up`: the config on disk now carries the narrow rule in both PostUp and
// PostDown, so no bounce and no syncconf would ever take the wide one away.
// Deleted until iptables says there is none; that refusal is the normal end,
// not an error. Once per agent process: nothing adds the old rule any more.
// Caller holds restartMu.
func (a *Adapter) dropLegacyMasquerade(ctx context.Context, iface string) {
	a.mu.Lock()
	done := a.legacyDropped
	a.legacyDropped = true
	a.mu.Unlock()
	if done || a.cfg.AwgQuickBin == "" {
		return
	}
	removed := 0
	for i := 0; i < legacyDropAttempts; i++ {
		if _, err := a.cfg.runCmd(ctx, "iptables", legacyMasqueradeDelete(iface)...); err != nil {
			break
		}
		removed++
	}
	// One line, the words the stand greps journalctl for: whether the update
	// took the pre-E37 rule away on this node.
	if removed > 0 {
		a.logger.Info("amneziawg: legacy MASQUERADE removed", "interface", iface, "copies", removed)
	}
}

func (a *Adapter) syncconf(parent context.Context, iface string) error {
	ctx, cancel := context.WithTimeout(parent, a.cfg.SyncTimeout)
	defer cancel()

	stripped, err := a.cfg.runCmd(ctx, a.cfg.AwgQuickBin, "strip", a.cfg.ConfigPath)
	if err != nil {
		return fmt.Errorf("awg-quick strip: %w (%s)", err, strings.TrimSpace(string(stripped)))
	}

	tmp, err := os.CreateTemp("", "ice-awg-syncconf-*.conf")
	if err != nil {
		return fmt.Errorf("create temp: %w", err)
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	if _, err := tmp.Write(stripped); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("write temp: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close temp: %w", err)
	}

	out, err := a.cfg.runCmd(ctx, a.cfg.AwgBin, "syncconf", iface, tmpPath)
	if err != nil {
		return fmt.Errorf("awg syncconf: %w (%s)", err, strings.TrimSpace(string(out)))
	}
	return nil
}

func (a *Adapter) restartViaSystemctl(parent context.Context, iface string) error {
	if a.cfg.SystemctlBin == "" {
		return errors.New("syncconf failed and no SystemctlBin configured for fallback")
	}
	ctx, cancel := context.WithTimeout(parent, 15*time.Second)
	defer cancel()
	unit := "awg-quick@" + iface
	out, err := a.cfg.runCmd(ctx, a.cfg.SystemctlBin, "restart", unit)
	if err != nil {
		return fmt.Errorf("systemctl restart %s: %w (%s)", unit, err, strings.TrimSpace(string(out)))
	}
	return nil
}

func (a *Adapter) writeConfigSnapshot(inbound InboundConfig, peers []Peer) error {
	blob, err := renderConfig(inbound, peers)
	if err != nil {
		return fmt.Errorf("render amneziawg config: %w", err)
	}
	return writeConfig(a.cfg.ConfigPath, blob)
}

// sortedPeers returns peers in deterministic AllowedIP order so successive
// renders produce byte-identical configs.
func sortedPeers(in map[string]Peer) []Peer {
	out := make([]Peer, 0, len(in))
	for _, p := range in {
		out = append(out, p)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].AllowedIP < out[j].AllowedIP })
	return out
}

// ensureCIDR appends /32 to a bare IP. Pass-through if already in CIDR form.
func ensureCIDR(ip string) string {
	if strings.Contains(ip, "/") {
		return ip
	}
	return ip + "/32"
}

// Installed reports whether AmneziaWG is on this machine, and it takes BOTH
// halves: the userspace tools and the kernel module.
//
// Half of it is not an installation. `awg` present with no module answers every
// command with an error at the first interface it is asked to bring up, and the
// panel showing such a node as carrying AmneziaWG is exactly the lie this field
// exists to stop. So a disagreement reports false and says which half is
// missing, rather than true on the strength of the half that is there.
//
// ⚠ The userspace amneziawg-go implementation needs no module and would be
// reported false here. Nothing refuses anything on this field, it is shown, and
// the log line says what was found; a node running amneziawg-go is a case to
// teach this function about when one actually exists, not one to guess at now.
func (a *Adapter) Installed() bool {
	present := core.BinaryPresent(a.cfg.AwgBin) && core.BinaryPresent(a.cfg.AwgQuickBin)
	// Present is not enough, and the stand proved it: ru-02 carries a binary
	// called `awg` that is ordinary wireguard-tools v1.0.20210914. It answers
	// every command and speaks none of the obfuscation, so a check that looked
	// only for the file would report this node as running AmneziaWG.
	genuine := present && a.toolsAreAmneziawg()
	module := kernelModuleLoaded()
	if genuine != module {
		a.logger.Warn("amneziawg is half installed, reporting it as not installed",
			"awgBinPresent", present,
			"toolsAreAmneziawg", genuine,
			"kernelModule", module,
			"awgBin", a.cfg.AwgBin)
	}
	return genuine && module
}

// toolsAreAmneziawg asks the binary who it is.
//
// amneziawg-tools and wireguard-tools both answer `--version` with
// "<name> vX - <url>", and the name is the only thing that tells them apart:
// the fork keeps every command, every flag and the file name. A node with the
// wrong one accepts the config, brings the interface up and carries traffic
// with NO obfuscation at all, which is the failure this whole product exists to
// avoid, and it looks healthy the entire time.
//
// Asked through core.VersionProbe, so the binary runs again only when the file
// changes. A failure to run it at all (missing, not executable, timeout) counts
// as "not amneziawg": an answer we could not get is not a yes.
func (a *Adapter) toolsAreAmneziawg() bool {
	out, verdict := a.toolsAnswer()
	if out != "" && !verdict {
		a.mu.Lock()
		fresh := a.toolsWarned != out
		a.toolsWarned = out
		a.mu.Unlock()
		if fresh {
			a.logger.Warn("the binary at AwgBin is not amneziawg-tools",
				"awgBin", a.cfg.AwgBin, "version", strings.TrimSpace(out))
		}
	}
	return verdict
}

// toolsAnswer is what `awg --version` printed and whether it names amneziawg.
func (a *Adapter) toolsAnswer() (string, bool) {
	out, ok := a.tools.Answer(a.cfg.AwgBin, []string{"--version"}, core.RunForOutput(a.cfg.runCmd))
	return out, ok && strings.Contains(strings.ToLower(out), "amneziawg")
}

// ToolsVersion implements core.ToolsVersioner with `awg --version`
// ("amneziawg-tools v1.0.20260618-2 - ..." gives "1.0.20260618-2"), the
// component amneziawg-tools in the version manifest. Empty when the binary is
// not amneziawg-tools at all: wireguard-tools under the name `awg` has a version
// too, and reporting it here would put a number for the wrong program beside
// the AmneziaWG pin.
var _ core.ToolsVersioner = (*Adapter)(nil)

func (a *Adapter) ToolsVersion() string {
	out, genuine := a.toolsAnswer()
	if !genuine {
		return ""
	}
	return core.ParseVersion([]byte(out))
}

// CoreVersion implements core.Versioner with the KERNEL MODULE's version, read
// from /sys/module/amneziawg/version (the file `modinfo` reads, without an
// exec on every poll). The module is the core here: it speaks the protocol,
// and its tag carries the protocol generation (v1.x against v3.x), which is
// the one number an operator needs off this card. The tools version is not
// folded into this string; two numbers in one field are one the panel cannot
// compare. Empty when the module is not loaded.
//
// Ф7.1: every generation's module calls itself 1.0.0 there (Ф7.0 on se-02), so
// the version the bootstrap INSTALLED wins, from AMNEZIAWG_MODULE_VERSION, but
// only while the loaded module is that build: its srcversion has to match
// AMNEZIAWG_MODULE_SRCVERSION. A module swapped since (a reinstall by hand, a
// build that did not load) falls back to what /sys/module says, which is a
// number the panel will not mistake for the pin.
func (a *Adapter) CoreVersion() string {
	b, err := os.ReadFile(moduleVersionPath)
	if err != nil {
		return ""
	}
	if a.cfg.ModuleVersion != "" && a.cfg.ModuleSrcVersion != "" {
		if src, err := os.ReadFile(moduleSrcVersionPath); err == nil && strings.TrimSpace(string(src)) == a.cfg.ModuleSrcVersion {
			return a.cfg.ModuleVersion
		}
	}
	return strings.TrimSpace(string(b))
}

// moduleVersionPath and moduleSrcVersionPath are variables so the tests can
// point them at files.
var (
	moduleVersionPath    = "/sys/module/amneziawg/version"
	moduleSrcVersionPath = "/sys/module/amneziawg/srcversion"
)

// kernelModuleLoaded reports whether the amneziawg kernel module is loaded.
//
// /sys/module rather than shelling out to lsmod: this runs on every healthcheck
// poll, and the directory is the same thing lsmod reads. Absent on a kernel
// without the module, and on any non-Linux host, which is the right answer in
// both cases.
func kernelModuleLoaded() bool {
	info, err := os.Stat("/sys/module/amneziawg")
	return err == nil && info.IsDir()
}

// ReservedPorts: none. AmneziaWG is a kernel interface driven through the awg
// CLI, so there is no loopback API to hold a port, and the listen port itself
// is the inbound the panel already knows.
//
// Empty rather than absent, same rule as the other two: an answer, not a
// silence.
func (a *Adapter) ReservedPorts() []core.ReservedPort { return nil }

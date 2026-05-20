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

	// runCmd is an injection point for tests. nil → real exec.CommandContext.
	runCmd func(ctx context.Context, name string, args ...string) ([]byte, error)
}

// Adapter implements core.CoreAdapter for AmneziaWG.
type Adapter struct {
	cfg    Config
	logger *slog.Logger

	mu      sync.Mutex
	peers   map[string]Peer // key: userId
	started bool
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
		cfg:    cfg,
		logger: logger,
		peers:  make(map[string]Peer),
	}
}

func realRunCmd(ctx context.Context, name string, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	out, err := cmd.CombinedOutput()
	return out, err
}

func (a *Adapter) Name() string { return Name }

// Start writes the initial (no-peer) config and brings the awg interface up.
// In config-only mode (AwgQuickBin == "") it just writes the config.
//
// Special case: on a freshly-bootstrapped node, main.go can only fill in the
// interface name and bin paths — every other field (PrivateKey, Address,
// H1-H4, S1-S4, Jc/Jmin/Jmax) lives in panel-side `Profile.config` and only
// arrives via the first `ApplyInbound` over mTLS. Calling `renderConfig`
// here would fail validation with "PrivateKey is required" and crash the
// agent in a loop. Detect that empty-config state and *defer* the bring-up
// until ApplyInbound supplies real values — that handler already calls
// restartInterfaceLocked which writes the config + awg-quick up and flips
// `started` to true. Caught live cycle #6 2026-05-12 on awg-VPS.
func (a *Adapter) Start(ctx context.Context) error {
	a.mu.Lock()
	defer a.mu.Unlock()

	if a.cfg.Inbound.PrivateKey == "" {
		a.logger.Info("amneziawg adapter deferred — awaiting first ApplyInbound from panel",
			"interface", a.cfg.Inbound.Interface)
		return nil
	}

	if err := a.writeCurrentConfigLocked(); err != nil {
		return err
	}

	if a.cfg.AwgQuickBin != "" {
		if out, err := a.cfg.runCmd(ctx, a.cfg.AwgQuickBin, "up", a.cfg.Inbound.Interface); err != nil {
			// awg-quick up is idempotent-ish — failing because the iface is
			// already up is fine. Anything else is a real error.
			if !strings.Contains(strings.ToLower(string(out)), "already exists") {
				return fmt.Errorf("awg-quick up %s failed: %w (%s)", a.cfg.Inbound.Interface, err, strings.TrimSpace(string(out)))
			}
		}
	}

	a.started = true
	a.logger.Info("amneziawg adapter started",
		"interface", a.cfg.Inbound.Interface,
		"managed", a.cfg.AwgQuickBin != "")
	return nil
}

// Stop tears the interface down. Safe to call multiple times.
func (a *Adapter) Stop(ctx context.Context) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.started = false

	if a.cfg.AwgQuickBin == "" {
		return nil
	}
	if _, err := a.cfg.runCmd(ctx, a.cfg.AwgQuickBin, "down", a.cfg.Inbound.Interface); err != nil {
		// "iface not running" is expected on a clean stop after a failed start
		a.logger.Warn("awg-quick down returned non-zero (often safe)", "err", err)
	}
	return nil
}

// AddUser registers / updates a peer. No-op for users without amneziawg
// credentials. Idempotent.
func (a *Adapter) AddUser(user core.User) error {
	if user.AmneziaWGPublicKey == "" || user.AmneziaWGAllowedIP == "" {
		return nil
	}

	a.mu.Lock()
	defer a.mu.Unlock()

	desired := Peer{
		PublicKey: user.AmneziaWGPublicKey,
		AllowedIP: ensureCIDR(user.AmneziaWGAllowedIP),
	}
	if existing, ok := a.peers[user.UserID]; ok && existing == desired {
		return nil
	}
	a.peers[user.UserID] = desired
	return a.regenerateAndSyncLocked(context.Background())
}

// RemoveUser drops the peer and reloads the interface. Idempotent.
func (a *Adapter) RemoveUser(userID string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if _, ok := a.peers[userID]; !ok {
		return nil
	}
	delete(a.peers, userID)
	return a.regenerateAndSyncLocked(context.Background())
}

// GetStats parses `awg show <iface> dump` and maps per-peer RX/TX counters
// back to user IDs via the tracked peers. Counters are kernel-cumulative
// (lifetime of the interface) — the panel computes daily/monthly deltas
// by snapshotting these values periodically.
//
// In config-only mode (no AwgBin) returns zero counters per user without
// shelling out, mirroring the old stub behaviour for dev environments
// without amneziawg installed.
func (a *Adapter) GetStats() (*core.Stats, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	users := make([]core.UserStats, 0, len(a.peers))

	if a.cfg.AwgBin == "" {
		for id := range a.peers {
			users = append(users, core.UserStats{UserID: id})
		}
		return &core.Stats{Users: users}, nil
	}

	iface := a.cfg.Inbound.Interface
	if iface == "" {
		iface = "awg0"
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	out, err := a.cfg.runCmd(ctx, a.cfg.AwgBin, "show", iface, "dump")
	if err != nil {
		// Interface may be down or never started — fall back to zero counters
		// rather than failing the whole stats poll.
		for id := range a.peers {
			users = append(users, core.UserStats{UserID: id})
		}
		return &core.Stats{Users: users}, nil
	}

	rxByPub, txByPub := parseAwgDump(string(out))

	var totalIn, totalOut int64
	for id, peer := range a.peers {
		rx := rxByPub[peer.PublicKey]
		tx := txByPub[peer.PublicKey]
		users = append(users, core.UserStats{
			UserID:   id,
			BytesIn:  rx,
			BytesOut: tx,
		})
		totalIn += rx
		totalOut += tx
	}

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

// Healthy reports whether the adapter has finished Start successfully and
// (when managed) the awg interface still exists.
func (a *Adapter) Healthy() bool {
	a.mu.Lock()
	started := a.started
	managed := a.cfg.AwgQuickBin != ""
	iface := a.cfg.Inbound.Interface
	a.mu.Unlock()

	if !started {
		return false
	}
	if !managed {
		return true
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_, err := a.cfg.runCmd(ctx, a.cfg.AwgBin, "show", iface)
	return err == nil
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
// Background context for the reload — the inbound HTTP request that triggered
// this may have a short deadline, but we want the interface to come back up
// even if the caller times out (matches the xray adapter pattern).
func (a *Adapter) ApplyInbound(port int, rawCfg json.RawMessage) error {
	var wire inboundCfgWire
	if err := json.Unmarshal(rawCfg, &wire); err != nil {
		return fmt.Errorf("amneziawg ApplyInbound: parse cfg: %w", err)
	}

	a.mu.Lock()
	defer a.mu.Unlock()

	// Slice 50: prefer the panel-pushed port over install-time fallback.
	// Pre-slice-50 panel paths still work because port=0 falls through to
	// a.cfg.Inbound.ListenPort below.
	listenPort := port
	if listenPort == 0 {
		listenPort = a.cfg.Inbound.ListenPort
	}
	newInbound, err := wire.toInboundConfig(a.cfg.Inbound.Interface, listenPort)
	if err != nil {
		return fmt.Errorf("amneziawg ApplyInbound: %w", err)
	}
	// Preserve install-time PostUp/PostDown and Interface defaults — those
	// aren't in the panel wire. Interface name is install-time identity; if
	// the wire expressed a new one it'd be a separate diffRestart anyway.
	newInbound.PostUp = a.cfg.Inbound.PostUp
	newInbound.PostDown = a.cfg.Inbound.PostDown

	kind := classifyDiff(a.cfg.Inbound, newInbound)
	switch kind {
	case diffNone:
		a.logger.Info("amneziawg ApplyInbound: config unchanged, skipping")
		return nil
	case diffSubnet:
		if len(a.peers) > 0 {
			return fmt.Errorf("amneziawg ApplyInbound: subnet change rejected — %d peer(s) already allocated; drain peers before changing subnet", len(a.peers))
		}
		// No peers: subnet change is safe and only needs a full restart to
		// re-attach the new IP to the interface.
		a.cfg.Inbound = newInbound
		a.logger.Info("amneziawg ApplyInbound: subnet change with no peers, restarting interface",
			"address", newInbound.Address)
		return a.restartInterfaceLocked(context.Background())
	case diffSyncconf:
		a.cfg.Inbound = newInbound
		a.logger.Info("amneziawg ApplyInbound: syncconf-eligible change", "iface", newInbound.Interface)
		return a.regenerateAndSyncLocked(context.Background())
	case diffRestart:
		a.cfg.Inbound = newInbound
		a.logger.Info("amneziawg ApplyInbound: interface-level change, full restart",
			"iface", newInbound.Interface)
		return a.restartInterfaceLocked(context.Background())
	default:
		return fmt.Errorf("amneziawg ApplyInbound: unknown diffKind %d", kind)
	}
}

// restartInterfaceLocked writes the new config and bounces the interface via
// awg-quick down/up. Used for changes that syncconf can't apply (H1-H4, keys,
// listen port). Caller must hold a.mu.
//
// In config-only mode (AwgQuickBin == "") we just rewrite the file and skip
// the actual bounce — that's what the unit tests rely on, and what dev
// machines without amneziawg installed need.
func (a *Adapter) restartInterfaceLocked(parent context.Context) error {
	if err := a.writeCurrentConfigLocked(); err != nil {
		return err
	}
	if a.cfg.AwgQuickBin == "" {
		a.logger.Info("amneziawg restart skipped (config-only mode)")
		a.started = true
		return nil
	}
	ctx, cancel := context.WithTimeout(parent, 30*time.Second)
	defer cancel()

	if out, err := a.cfg.runCmd(ctx, a.cfg.AwgQuickBin, "down", a.cfg.Inbound.Interface); err != nil {
		// "iface not running" is fine — we're about to bring it up.
		a.logger.Warn("awg-quick down returned non-zero (often safe)",
			"err", err, "out", strings.TrimSpace(string(out)))
	}
	if out, err := a.cfg.runCmd(ctx, a.cfg.AwgQuickBin, "up", a.cfg.Inbound.Interface); err != nil {
		return fmt.Errorf("awg-quick up %s: %w (%s)", a.cfg.Inbound.Interface, err, strings.TrimSpace(string(out)))
	}
	// Mark started so Healthy() returns true and main.go's heartbeat sees
	// a ready adapter after the first ApplyInbound on a freshly-bootstrapped
	// node (Start() returned early because PrivateKey was empty).
	a.started = true
	a.logger.Info("amneziawg interface bounced", "iface", a.cfg.Inbound.Interface)
	return nil
}

// regenerateAndSyncLocked must be called with a.mu held. It writes the
// current config to disk and (when managed) reloads the running interface
// via `awg syncconf`, falling back to `systemctl restart awg-quick@<iface>`
// on failure or timeout.
func (a *Adapter) regenerateAndSyncLocked(ctx context.Context) error {
	if err := a.writeCurrentConfigLocked(); err != nil {
		return err
	}

	if a.cfg.AwgQuickBin == "" {
		a.logger.Info("amneziawg config written (config-only mode)", "peers", len(a.peers))
		return nil
	}

	if err := a.syncconfLocked(ctx); err != nil {
		a.logger.Warn("awg syncconf failed; falling back to systemctl restart", "err", err)
		return a.restartViaSystemctlLocked(ctx)
	}
	a.logger.Info("amneziawg synced", "peers", len(a.peers))
	return nil
}

func (a *Adapter) syncconfLocked(parent context.Context) error {
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

	out, err := a.cfg.runCmd(ctx, a.cfg.AwgBin, "syncconf", a.cfg.Inbound.Interface, tmpPath)
	if err != nil {
		return fmt.Errorf("awg syncconf: %w (%s)", err, strings.TrimSpace(string(out)))
	}
	return nil
}

func (a *Adapter) restartViaSystemctlLocked(parent context.Context) error {
	if a.cfg.SystemctlBin == "" {
		return errors.New("syncconf failed and no SystemctlBin configured for fallback")
	}
	ctx, cancel := context.WithTimeout(parent, 15*time.Second)
	defer cancel()
	unit := "awg-quick@" + a.cfg.Inbound.Interface
	out, err := a.cfg.runCmd(ctx, a.cfg.SystemctlBin, "restart", unit)
	if err != nil {
		return fmt.Errorf("systemctl restart %s: %w (%s)", unit, err, strings.TrimSpace(string(out)))
	}
	return nil
}

func (a *Adapter) writeCurrentConfigLocked() error {
	peers := sortedPeers(a.peers)
	blob, err := renderConfig(a.cfg.Inbound, peers)
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

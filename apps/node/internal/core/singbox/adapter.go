// Package singbox implements CoreAdapter using the sing-box engine. The first
// protocol it serves is TUIC v5 (Name == "tuic"), which the xray-based cores
// can't do. Future sing-box protocols (AnyTLS, ShadowTLS) reuse this same
// subprocess runner.
//
// Architecture:
//   - sing-box runs as a managed subprocess (`sing-box run -c config.json`),
//     same lifecycle model as the xray adapter.
//   - TUIC users live inside the inbound's `users[]`, so AddUser/RemoveUser
//     re-render the config and restart sing-box (config-restart model). Live
//     user management without restart is a later optimisation.
//   - regenerateAndRestart is serialized by restartMu; a.mu is held only for
//     fast in-memory snapshots, never across the subprocess Stop/Start IO, so
//     Healthy()/GetStats never block behind a multi-second restart (bug #1).
package singbox

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/icecompany-tech/iceslab/apps/node/internal/core"
	"github.com/icecompany-tech/iceslab/apps/node/internal/core/subprocess"
)

// Name matches dto.ProtocolName. The engine is sing-box; the protocol is TUIC.
const Name = "tuic"

// Config holds install-time settings. BinaryPath empty = config-only/inert
// mode (tests, or a node where sing-box isn't installed): the adapter accepts
// users/inbounds in memory but never spawns a subprocess.
type Config struct {
	// Protocol this adapter serves = its Name() for the dispatcher. "tuic"
	// (default) or "anytls". One sing-box engine, one adapter per protocol.
	Protocol   string
	BinaryPath string // path to the `sing-box` executable
	ConfigPath string // rendered config, passed to `sing-box run -c`
	CertPath   string // TLS certificate file (TUIC requires TLS)
	KeyPath    string // TLS private key file

	// StatsListen is the loopback host:port for sing-box's experimental
	// v2ray_api (e.g. "127.0.0.1:8082"). Empty disables stats collection.
	StatsListen string
	// XrayStatsBin is the xray binary used as a generic v2ray-stats gRPC
	// client to read StatsListen (sing-box ships no stats CLI). Empty means
	// GetStats degrades to zero counters.
	XrayStatsBin string
	// RunCmd runs the stats query; nil defaults to os/exec. Tests inject a fake.
	RunCmd RunCmdFunc
}

type Adapter struct {
	cfg      Config
	protocol string
	logger   *slog.Logger

	// mu protects in-memory state (users, inbound, proc, started, ctx). Held
	// ONLY for fast ops. The slow render + subprocess Stop/Start runs under
	// restartMu with mu released.
	mu      sync.Mutex
	started bool
	ctx     context.Context
	users   map[string]userEntry // key: userId
	inbound InboundConfig
	proc    *subprocess.Subprocess

	// restartMu serializes regenerateAndRestart so concurrent user/inbound
	// changes can't race the subprocess swap. Never held together with mu
	// across IO.
	restartMu sync.Mutex
}

func New(cfg Config, logger *slog.Logger) *Adapter {
	if cfg.RunCmd == nil {
		cfg.RunCmd = defaultRunCmd
	}
	if cfg.Protocol == "" {
		cfg.Protocol = Name
	}
	return &Adapter{
		cfg:      cfg,
		protocol: cfg.Protocol,
		logger:   logger,
		users:    make(map[string]userEntry),
	}
}

func (a *Adapter) Name() string { return a.protocol }

// Engine reports the proxy core: always "singbox" for this adapter, regardless
// of which protocol (tuic/anytls/...) it currently renders.
func (a *Adapter) Engine() string { return "singbox" }

// Start records the lifetime ctx (reused for subprocess spawns) and, if an
// inbound was already applied (e.g. persisted-store replay before Start),
// brings sing-box up. Normally the first ApplyInbound triggers the spawn.
func (a *Adapter) Start(ctx context.Context) error {
	a.mu.Lock()
	a.started = true
	a.ctx = ctx
	hasInbound := a.inbound.ListenPort != 0
	a.mu.Unlock()
	if hasInbound {
		return a.regenerateAndRestart()
	}
	return nil
}

func (a *Adapter) Stop(ctx context.Context) error {
	a.mu.Lock()
	a.started = false
	proc := a.proc
	a.proc = nil
	a.mu.Unlock()
	if proc == nil {
		return nil
	}
	return proc.Stop(ctx)
}

// AddUser registers a TUIC user and restarts sing-box so the new user lands in
// the inbound's users[]. Idempotent: re-adding identical credentials is a no-op
// (no restart).
func (a *Adapter) AddUser(user core.User) error {
	uuid, password := a.credsFor(user)
	if uuid == "" && password == "" {
		// No credentials for this protocol — nothing to do.
		return nil
	}
	a.mu.Lock()
	cur, ok := a.users[user.UserID]
	if ok && cur.UUID == uuid && cur.Password == password {
		a.mu.Unlock()
		return nil
	}
	a.users[user.UserID] = userEntry{
		UUID:     uuid,
		Password: password,
		Username: user.Username,
	}
	a.mu.Unlock()
	return a.regenerateAndRestart()
}

// credsFor extracts (uuid, password) for the adapter's protocol from a user.
// TUIC uses uuid+password; AnyTLS is password-only (uuid empty).
func (a *Adapter) credsFor(user core.User) (uuid, password string) {
	switch a.protocol {
	case "anytls":
		return "", user.AnytlsPassword
	case "xray":
		// vless/vmess use the xray uuid as uuid; trojan uses it as password.
		// Store it in both slots; renderXrayFamilyConfig picks the right one per
		// subprotocol. Empty xrayUuid -> the AddUser guard skips this user.
		return user.XrayUUID, user.XrayUUID
	case "hysteria":
		return "", user.HysteriaPassword
	case "shadowsocks":
		// Store the raw xray UUID; renderShadowsocksConfig derives the SS2022
		// uPSK from it (method-aware). Empty xrayUuid -> AddUser guard skips.
		return "", user.XrayUUID
	case "shadowtls":
		return "", user.ShadowtlsPassword
	default: // tuic
		return user.TuicUUID, user.TuicPassword
	}
}

// RemoveUser drops a user and restarts sing-box. Idempotent: removing an
// unknown user is a no-op (no restart).
func (a *Adapter) RemoveUser(userID string) error {
	a.mu.Lock()
	if _, ok := a.users[userID]; !ok {
		a.mu.Unlock()
		return nil
	}
	delete(a.users, userID)
	a.mu.Unlock()
	return a.regenerateAndRestart()
}

// GetStats reports per-user cumulative byte counters, read from sing-box's
// v2ray_api via the xray-binary stats client (see stats.go). Non-destructive
// read -> Cumulative=true, so the panel computes deltas against its snapshot
// (mirrors xray, #5). Degrades gracefully to zero counters when stats aren't
// configured or the query fails, so a stats outage never poisons the poller.
func (a *Adapter) GetStats() (*core.Stats, error) {
	a.mu.Lock()
	statsListen := a.cfg.StatsListen
	bin := a.cfg.XrayStatsBin
	run := a.cfg.RunCmd
	userIDs := make([]string, 0, len(a.users))
	for id := range a.users {
		userIDs = append(userIDs, id)
	}
	a.mu.Unlock()

	zero := func() *core.Stats {
		out := make([]core.UserStats, 0, len(userIDs))
		for _, id := range userIDs {
			out = append(out, core.UserStats{UserID: id})
		}
		return &core.Stats{Users: out}
	}

	if statsListen == "" || bin == "" || run == nil {
		return zero(), nil
	}

	counters, err := queryUserStats(context.Background(), run, bin, statsListen)
	if err != nil {
		a.logger.Warn("singbox GetStats: statsquery failed", "err", err)
		return zero(), nil
	}

	out := make([]core.UserStats, 0, len(userIDs))
	for _, id := range userIDs {
		c := counters[id]
		out = append(out, core.UserStats{UserID: id, BytesIn: c.UplinkBytes, BytesOut: c.DownlinkBytes})
	}
	return &core.Stats{Users: out, Cumulative: true}, nil
}

// Healthy: agent must be started; if a TUIC inbound is configured and a binary
// is set, the subprocess must be running. Before any inbound is applied (or in
// config-only mode) the agent itself is up, so report healthy.
func (a *Adapter) Healthy() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	if !a.started {
		return false
	}
	if a.cfg.BinaryPath == "" || a.inbound.ListenPort == 0 {
		return true
	}
	return a.proc != nil && a.proc.Running()
}

// ApplyInbound parses the panel-pushed TUIC config, diffs against the last
// applied inbound, and on change re-renders + restarts. Idempotent.
func (a *Adapter) ApplyInbound(port int, rawCfg json.RawMessage) error {
	var newInbound InboundConfig
	switch a.protocol {
	case "xray":
		var wire xrayFamilyWire
		if err := json.Unmarshal(rawCfg, &wire); err != nil {
			return fmt.Errorf("singbox ApplyInbound: parse xray cfg: %w", err)
		}
		ic, err := wire.toInboundConfig(port)
		if err != nil {
			return fmt.Errorf("singbox ApplyInbound: %w", err)
		}
		newInbound = ic
	case "hysteria":
		var wire hy2FamilyWire
		if err := json.Unmarshal(rawCfg, &wire); err != nil {
			return fmt.Errorf("singbox ApplyInbound: parse hysteria cfg: %w", err)
		}
		newInbound = wire.toInboundConfig(port)
	case "shadowsocks":
		var wire ssFamilyWire
		if err := json.Unmarshal(rawCfg, &wire); err != nil {
			return fmt.Errorf("singbox ApplyInbound: parse shadowsocks cfg: %w", err)
		}
		ic, err := wire.toInboundConfig(port)
		if err != nil {
			return fmt.Errorf("singbox ApplyInbound: %w", err)
		}
		newInbound = ic
	case "shadowtls":
		var wire shadowtlsWire
		if err := json.Unmarshal(rawCfg, &wire); err != nil {
			return fmt.Errorf("singbox ApplyInbound: parse shadowtls cfg: %w", err)
		}
		ic, err := wire.toInboundConfig(port)
		if err != nil {
			return fmt.Errorf("singbox ApplyInbound: %w", err)
		}
		newInbound = ic
	default:
		var wire inboundCfgWire
		if err := json.Unmarshal(rawCfg, &wire); err != nil {
			return fmt.Errorf("singbox ApplyInbound: parse cfg: %w", err)
		}
		newInbound = wire.toInboundConfig(port)
	}

	a.mu.Lock()
	if a.inbound == newInbound {
		a.mu.Unlock()
		a.logger.Info("singbox ApplyInbound: config unchanged, skipping")
		return nil
	}
	a.inbound = newInbound
	a.mu.Unlock()
	return a.regenerateAndRestart()
}

// regenerateAndRestart re-renders the sing-box config from current state and
// swaps the subprocess. Serialized by restartMu; mu is only held for the
// snapshot. No-op in config-only mode (no binary) or before an inbound exists.
func (a *Adapter) regenerateAndRestart() error {
	a.restartMu.Lock()
	defer a.restartMu.Unlock()

	a.mu.Lock()
	inbound := a.inbound
	binPath := a.cfg.BinaryPath
	cfgPath := a.cfg.ConfigPath
	certPath := a.cfg.CertPath
	keyPath := a.cfg.KeyPath
	statsListen := a.cfg.StatsListen
	ctx := a.ctx
	oldProc := a.proc
	users := make(map[string]userEntry, len(a.users))
	for k, v := range a.users {
		users[k] = v
	}
	a.mu.Unlock()

	if binPath == "" || inbound.ListenPort == 0 {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}

	var blob []byte
	var err error
	switch a.protocol {
	case "anytls":
		blob, err = renderAnytlsConfig(certPath, keyPath, statsListen, inbound, users)
	case "xray":
		blob, err = renderXrayFamilyConfig(statsListen, inbound, users)
	case "hysteria":
		blob, err = renderHysteria2Config(certPath, keyPath, statsListen, inbound, users)
	case "shadowsocks":
		blob, err = renderShadowsocksConfig(statsListen, inbound, users)
	case "shadowtls":
		blob, err = renderShadowtlsConfig(statsListen, inbound, users)
	default:
		blob, err = renderConfig(certPath, keyPath, statsListen, inbound, users)
	}
	if err != nil {
		return fmt.Errorf("singbox: render config: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(cfgPath), 0o755); err != nil {
		return fmt.Errorf("singbox: mkdir config dir: %w", err)
	}
	if err := os.WriteFile(cfgPath, blob, 0o600); err != nil {
		return fmt.Errorf("singbox: write %s: %w", cfgPath, err)
	}

	// Stop the old subprocess (IO under restartMu, mu released) then spawn anew.
	if oldProc != nil {
		_ = oldProc.Stop(context.Background())
	}
	proc := subprocess.New(subprocess.Config{
		Name:           a.protocol,
		Binary:         binPath,
		Args:           []string{"run", "-c", cfgPath},
		Logger:         a.logger,
		MaxRestarts:    subprocess.DefaultMaxRestarts,
		RestartBackoff: subprocess.DefaultRestartBackoff,
	})
	if err := proc.Start(ctx); err != nil {
		return fmt.Errorf("singbox: start subprocess: %w", err)
	}

	a.mu.Lock()
	a.proc = proc
	a.mu.Unlock()
	a.logger.Info("singbox: config applied and (re)started",
		"port", inbound.ListenPort, "users", len(users))
	return nil
}

// ───── panel wire config ─────
//
// The panel pushes a small TUIC config blob via /applyInbounds. Port comes from
// the outer InboundDto.Port (first-class since slice 50); the rest is here.

type inboundCfgWire struct {
	ServerName        string `json:"serverName,omitempty"`
	CongestionControl string `json:"congestionControl,omitempty"`
}

func (w inboundCfgWire) toInboundConfig(port int) InboundConfig {
	return InboundConfig{
		ListenPort:        port,
		ServerName:        w.ServerName,
		CongestionControl: w.CongestionControl,
	}
}

// xrayFamilyWire is the subset of the xray inbound config (xrayInboundCfgWire in
// the xray adapter / XrayInboundCfg in transport.ts) that the sing-box engine
// can render for vless/vmess/trojan. Field tags match what the panel pushes.
// Unsupported features are rejected in toInboundConfig so the operator gets a
// clear "use the xray engine" error rather than a silently-wrong config.
type xrayFamilyWire struct {
	Subprotocol        string          `json:"subprotocol"`
	Security           string          `json:"security"`
	Network            string          `json:"network"`
	RealityDest        string          `json:"realityDest"`
	RealityServerNames []string        `json:"realityServerNames"`
	RealityPrivateKey  string          `json:"realityPrivateKey"`
	RealityShortIDs    []string        `json:"realityShortIds"`
	RealityMaxTimeDiff int             `json:"realityMaxTimeDiff"`
	RealityMode        string          `json:"realityMode"`
	Flow               string          `json:"flow"`
	Cascade            json.RawMessage `json:"cascade"`
}

// toInboundConfig validates the pushed xray config against what the sing-box
// engine supports (EC2: vless/vmess/trojan, REALITY steal-others, network=raw)
// and maps it to an InboundConfig. Everything else errors out by design.
func (w xrayFamilyWire) toInboundConfig(port int) (InboundConfig, error) {
	sub := w.Subprotocol
	if sub == "" {
		sub = "vless"
	}
	if sub != "vless" && sub != "vmess" && sub != "trojan" {
		return InboundConfig{}, fmt.Errorf("subprotocol %q not supported via sing-box engine", sub)
	}
	// REALITY (steal-others) only. tls/none security needs operator-cert handling
	// (deferred); self-steal needs the local TLS fallback the xray adapter runs;
	// non-raw transports and cascade aren't mapped to sing-box yet.
	if w.Security != "" && w.Security != "reality" {
		return InboundConfig{}, fmt.Errorf("security %q not supported via sing-box engine (use the xray engine)", w.Security)
	}
	if w.RealityMode == "self-steal" {
		return InboundConfig{}, fmt.Errorf("reality self-steal mode not supported via sing-box engine (use the xray engine)")
	}
	if w.Network != "" && w.Network != "raw" {
		return InboundConfig{}, fmt.Errorf("transport %q not supported via sing-box engine (use the xray engine)", w.Network)
	}
	if len(w.Cascade) > 0 && string(w.Cascade) != "null" {
		return InboundConfig{}, fmt.Errorf("cascade not supported via sing-box engine (use the xray engine)")
	}
	if w.RealityPrivateKey == "" {
		return InboundConfig{}, fmt.Errorf("realityPrivateKey is required")
	}
	if len(w.RealityServerNames) == 0 {
		return InboundConfig{}, fmt.Errorf("realityServerNames must have at least one entry")
	}
	if len(w.RealityShortIDs) == 0 {
		return InboundConfig{}, fmt.Errorf("realityShortIds must have at least one entry")
	}

	flow := ""
	if sub == "vless" {
		flow = w.Flow // Vision is VLESS-only; vmess/trojan have no flow.
	}
	return InboundConfig{
		ListenPort:         port,
		Subprotocol:        sub,
		RealityDest:        w.RealityDest,
		RealityServerName:  w.RealityServerNames[0], // sing-box tls.server_name is single
		RealityPrivateKey:  w.RealityPrivateKey,
		RealityShortIDsCSV: strings.Join(w.RealityShortIDs, ","),
		RealityMaxTimeDiff: w.RealityMaxTimeDiff,
		Flow:               flow,
	}, nil
}

// hy2FamilyWire is the subset of the hysteria inbound config (inboundCfgWire in
// the hysteria adapter / HysteriaConfigSchema in transport.ts) the sing-box
// engine renders. All fields are optional; there are no unsupported-feature
// guards (unlike the xray family) because obfs/masquerade/bandwidth all map 1:1.
type hy2FamilyWire struct {
	ObfsPassword   string `json:"obfsPassword"`
	MasqueradeURL  string `json:"masqueradeUrl"`
	BrutalUpMbps   int    `json:"brutalUpMbps"`
	BrutalDownMbps int    `json:"brutalDownMbps"`
	// ServerName is an optional SNI for the self-signed cert; the hysteria wire
	// usually omits it (the xray-hysteria path is ACME-domain based).
	ServerName string `json:"serverName"`
}

func (w hy2FamilyWire) toInboundConfig(port int) InboundConfig {
	return InboundConfig{
		ListenPort:     port,
		ServerName:     w.ServerName,
		ObfsPassword:   w.ObfsPassword,
		MasqueradeURL:  w.MasqueradeURL,
		BrutalUpMbps:   w.BrutalUpMbps,
		BrutalDownMbps: w.BrutalDownMbps,
	}
}

// ssFamilyWire is the subset of the shadowsocks inbound config (inboundCfgWire
// in the shadowsocks adapter / ShadowsocksConfigSchema in transport.ts) the
// sing-box engine renders. method + serverPsk are required; per-user uPSKs are
// derived on the node from each user's xray UUID (see renderShadowsocksConfig).
type ssFamilyWire struct {
	Method    string `json:"method"`
	ServerPSK string `json:"serverPsk"`
}

func (w ssFamilyWire) toInboundConfig(port int) (InboundConfig, error) {
	if w.Method == "" {
		return InboundConfig{}, fmt.Errorf("shadowsocks method is required")
	}
	if w.ServerPSK == "" {
		return InboundConfig{}, fmt.Errorf("shadowsocks serverPsk is required")
	}
	return InboundConfig{
		ListenPort: port,
		Method:     w.Method,
		ServerPSK:  w.ServerPSK,
	}, nil
}

// shadowtlsWire is the panel-pushed ShadowTLS config: the camouflage handshake
// target plus the inner shadowsocks key (a single server-wide key, reused via
// Method/ServerPSK). Per-user shadowtls passwords ride users[] from AddUser, not
// this wire. There is no share-link for ShadowTLS - clients consume it via full
// sing-box/clash config only.
type shadowtlsWire struct {
	Handshake  string `json:"handshake"`  // camouflage host[:port]
	SsMethod   string `json:"ssMethod"`   // inner ss cipher; default 2022-blake3-aes-128-gcm
	SsPassword string `json:"ssPassword"` // inner ss server key (panel-generated base64)
}

func (w shadowtlsWire) toInboundConfig(port int) (InboundConfig, error) {
	if w.Handshake == "" {
		return InboundConfig{}, fmt.Errorf("shadowtls handshake (camouflage domain) is required")
	}
	if w.SsPassword == "" {
		return InboundConfig{}, fmt.Errorf("shadowtls ssPassword (inner shadowsocks key) is required")
	}
	method := w.SsMethod
	if method == "" {
		method = "2022-blake3-aes-128-gcm"
	}
	return InboundConfig{
		ListenPort:         port,
		ShadowtlsHandshake: w.Handshake,
		Method:             method,
		ServerPSK:          w.SsPassword,
	}, nil
}

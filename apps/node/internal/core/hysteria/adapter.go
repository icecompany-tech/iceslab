// Package hysteria implements CoreAdapter for the Hysteria 2 proxy core.
//
// Architecture:
//   - The agent maintains an in-memory map of `password → userId`. AddUser /
//     RemoveUser mutate this map.
//   - Hysteria server runs as a subprocess (when BinaryPath is configured)
//     and is told to authenticate clients via HTTP callback. The callback
//     URL points at our local auth server (see auth.go).
//   - When a client tries to connect, Hysteria POSTs to /auth on our local
//     server with the supplied password; we look it up in the map.
//
// Adding/removing users does NOT restart Hysteria, the state map is updated
// live and the next auth callback uses the new state.
package hysteria

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os/exec"
	"sync"
	"time"

	"github.com/icecompany-tech/iceslab/apps/node/internal/core"
	"github.com/icecompany-tech/iceslab/apps/node/internal/core/subprocess"
)

const Name = "hysteria"

// Config holds per-instance settings. Defaults applied in New if zero.
type Config struct {
	// AuthCallbackHost is where the local /auth HTTP server binds.
	// Default: "127.0.0.1" (loopback only, Hysteria subprocess on same host).
	AuthCallbackHost string

	// AuthCallbackPort for the /auth HTTP server. Default: 9000.
	AuthCallbackPort int

	// AuthCallbackPath is the URL path the callback server listens on. The
	// path doubles as a shared secret: any local process on the VPS can
	// reach 127.0.0.1:9000, so a fixed "/auth" lets a low-priv attacker
	// brute-force passwords by hitting it directly. We generate a random
	// 32-hex-char suffix at New() (e.g. "/auth/9f3a…") and embed the same
	// path in hysteria-server's auth.http.url; probes of the canonical
	// "/auth" return 404. Empty → "/auth" (tests / backwards-compat only).
	AuthCallbackPath string

	// BinaryPath to the `hysteria` executable. If empty, the adapter runs in
	// callback-only mode (no subprocess), useful for tests and for slice 11
	// before slice 13 wires real subprocess + config generation.
	BinaryPath string

	// ConfigPath is the YAML config file passed to `hysteria server -c`.
	// Used both when BinaryPath is set (subprocess mode) and when the server
	// runs as an external systemd unit (slice 24b2: ApplyInbound rewrites
	// this file and asks systemd to restart the unit).
	ConfigPath string

	// Hostname is the public FQDN that Hysteria's ACME (Let's Encrypt http-01)
	// uses for cert issuance. Required for ApplyInbound to render config.yaml.
	// Set at install time via env (HYSTERIA_HOSTNAME), the panel never pushes
	// this; it's identity for the node, not per-inbound config.
	Hostname string

	// ACMEEmail is the contact address Let's Encrypt uses for renewal warnings.
	ACMEEmail string

	// ListenPort is the public UDP port Hysteria listens on. Default: 443.
	ListenPort int

	// ServiceUnit is the systemd unit name to restart after rewriting
	// ConfigPath (slice 24b2). When empty, ApplyInbound writes the YAML but
	// skips the restart, useful for tests, dry-runs, and the case where the
	// adapter manages hysteria as its own subprocess.
	ServiceUnit string

	// RunCmd is the injectable command runner used to invoke `systemctl
	// restart <ServiceUnit>`. Defaults to running the real binary via os/exec.
	// Tests inject a fake to assert which commands fire without spawning anything.
	RunCmd RunCmdFunc

	// TrafficStatsListen is the `host:port` where hysteria-server's traffic
	// API listens (e.g. "127.0.0.1:9999"). When set, renderConfig emits a
	// `trafficStats:` block in /etc/hysteria/config.yaml and GetStats polls
	// the endpoint to populate per-user uplink/downlink bytes. Empty disables
	// stats collection (GetStats returns user list with zero counters).
	TrafficStatsListen string

	// TrafficStatsSecret is the bearer token the adapter sends as the
	// `Authorization:` header when polling the traffic API. Hysteria-server
	// requires it to match `trafficStats.secret` in its config. Generated
	// once at install time and persisted in /etc/iceslab-node/env.
	TrafficStatsSecret string

	// HTTPClient is the client used to poll the traffic API. Nil → built
	// at first use with a short timeout. Tests inject a recorder.
	HTTPClient HTTPClient
}

// HTTPClient is the subset of *http.Client we use, keeps the adapter
// testable without dragging the full Client surface into mocks.
type HTTPClient interface {
	Do(req *http.Request) (*http.Response, error)
}

// RunCmdFunc executes an external command synchronously. The default impl
// shells out via os/exec; tests pass a recorder fake.
type RunCmdFunc func(ctx context.Context, name string, args ...string) error

type Adapter struct {
	cfg    Config
	logger *slog.Logger

	mu      sync.RWMutex
	users   map[string]userEntry // key: HysteriaPassword
	inbound InboundConfig        // last applied panel config; zero value = none

	callbackSrv *http.Server
	proc        *subprocess.Subprocess // hysteria subprocess; nil when BinaryPath is empty

	// Cached `systemctl is-active` probe for systemd mode (guarded by mu).
	// Healthy() serves unitHealthy and refreshes it in the background once
	// older than unitProbeTTL, so the health path never forks systemctl inline
	// (same shape as the AmneziaWG adapter's cached probe).
	unitCheckedAt time.Time
	unitHealthy   bool
	unitProbing   bool
}

type userEntry struct {
	UserID   string
	Username string
}

// New builds an adapter with defaults filled in.
func New(cfg Config, logger *slog.Logger) *Adapter {
	if cfg.AuthCallbackHost == "" {
		cfg.AuthCallbackHost = "127.0.0.1"
	}
	if cfg.AuthCallbackPort == 0 {
		cfg.AuthCallbackPort = 9000
	}
	if cfg.AuthCallbackPath == "" {
		cfg.AuthCallbackPath = "/auth/" + randomHex(16)
	}
	if cfg.RunCmd == nil {
		cfg.RunCmd = defaultRunCmd
	}
	return &Adapter{
		cfg:    cfg,
		logger: logger,
		users:  make(map[string]userEntry),
	}
}

// randomHex returns n random bytes hex-encoded (2n chars). PANICs on RNG
// failure, the auth-callback URL is a shared secret, an enumerable
// time-derived fallback would defeat the whole defence (anyone with
// approximate boot timestamp could guess the path). An agent that can't
// read /dev/urandom should refuse to start; the panic propagates up
// through New() → Start() to the supervisor.
func randomHex(n int) string {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		panic(fmt.Sprintf("hysteria adapter: crypto/rand failure (no system entropy?): %v", err))
	}
	return hex.EncodeToString(buf)
}

// validateTrafficStatsListen rejects non-loopback bind addresses. Hysteria's
// traffic API exposes per-user byte counters and accepts a single shared
// secret as bearer; binding it to 0.0.0.0 (e.g. for debugging) demotes the
// secret to the only barrier against any internet host enumerating users.
// We refuse to start in that configuration.
func validateTrafficStatsListen(listen string) error {
	if listen == "" {
		return nil
	}
	host, _, err := net.SplitHostPort(listen)
	if err != nil {
		return fmt.Errorf("invalid host:port %q: %w", listen, err)
	}
	if host == "" || host == "localhost" {
		return nil
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return fmt.Errorf("TrafficStatsListen host %q is not an IP, refuse to bind unresolved", host)
	}
	if !ip.IsLoopback() {
		return fmt.Errorf("TrafficStatsListen %q is not loopback, refuse to expose traffic API publicly", listen)
	}
	return nil
}

// defaultRunCmd shells out via os/exec. Production path; tests inject a fake.
func defaultRunCmd(ctx context.Context, name string, args ...string) error {
	cmd := exec.CommandContext(ctx, name, args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s %v: %w (output: %s)", name, args, err, string(out))
	}
	return nil
}

func (a *Adapter) Name() string { return Name }

// Engine reports the native proxy core. Hysteria2 runs on the hysteria binary;
// engine-choice can alternatively route hy2 to the sing-box adapter.
func (a *Adapter) Engine() string { return "hysteria" }

// Start brings up the auth-callback server, then optionally spawns the
// hysteria subprocess via the shared subprocess package.
//
// Two lifecycle modes:
//
//	ServiceUnit set    → hysteria runs as a systemd unit (install-iceslab-node.sh
//	                     wrote /etc/systemd/system/hysteria.service). The
//	                     agent only writes the config + reloads via
//	                     `systemctl restart <unit>` on ApplyInbound.
//	                     We MUST NOT also spawn an in-process copy or
//	                     the two compete for :443/udp and the second one
//	                     FATALs on "address already in use".
//
//	ServiceUnit empty  → "spawn mode", agent owns the subprocess. Used
//	                     in tests + setups that don't want systemd in
//	                     the lifecycle loop.
func (a *Adapter) Start(ctx context.Context) error {
	if err := validateTrafficStatsListen(a.cfg.TrafficStatsListen); err != nil {
		return fmt.Errorf("invalid TrafficStatsListen: %w", err)
	}
	if err := a.startAuthCallback(); err != nil {
		return fmt.Errorf("start auth callback: %w", err)
	}

	if a.cfg.BinaryPath == "" {
		a.logger.Info("hysteria binary not configured, callback-only mode")
		return nil
	}

	if a.cfg.ServiceUnit != "" {
		a.logger.Info("hysteria managed by systemd, skipping in-process spawn",
			"unit", a.cfg.ServiceUnit,
		)
		return nil
	}

	proc := subprocess.New(subprocess.Config{
		Name:           Name,
		Binary:         a.cfg.BinaryPath,
		Args:           []string{"server", "-c", a.cfg.ConfigPath},
		Logger:         a.logger,
		MaxRestarts:    subprocess.DefaultMaxRestarts,
		RestartBackoff: subprocess.DefaultRestartBackoff,
	})
	if err := proc.Start(ctx); err != nil {
		// Best-effort: tear down the auth callback we just started.
		_ = a.stopAuthCallback(context.Background())
		return err
	}
	a.mu.Lock()
	a.proc = proc
	a.mu.Unlock()
	return nil
}

// Stop gracefully shuts down the subprocess (if any) and then the callback
// server, with a 5s deadline before SIGKILL.
func (a *Adapter) Stop(ctx context.Context) error {
	a.mu.Lock()
	proc := a.proc
	a.proc = nil
	a.mu.Unlock()

	var firstErr error
	if proc != nil {
		if err := proc.Stop(ctx); err != nil {
			firstErr = err
		}
	}
	if err := a.stopAuthCallback(ctx); err != nil && firstErr == nil {
		firstErr = err
	}
	return firstErr
}

func (a *Adapter) AddUser(user core.User) error {
	if user.HysteriaPassword == "" {
		// User has no Hysteria credentials, nothing to do for this protocol.
		return nil
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	a.users[user.HysteriaPassword] = userEntry{
		UserID:   user.UserID,
		Username: user.Username,
	}
	return nil
}

func (a *Adapter) RemoveUser(userID string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	for password, entry := range a.users {
		if entry.UserID == userID {
			delete(a.users, password)
		}
	}
	return nil
}

// GetStats returns per-user uplink/downlink byte counters.
//
// Implementation pulls from hysteria-server's traffic API endpoint
// (`trafficStats:` block in config.yaml, see renderConfig). The endpoint
// returns a JSON map keyed by the userId we returned from /auth callback:
//
//	{
//	  "user-uuid-1": {"tx": 12345, "rx": 67890},
//	  "user-uuid-2": {"tx": 100,   "rx": 200}
//	}
//
// We hit it with ?clear=1 so hysteria resets counters after read, that
// way the panel can ingest deltas instead of computing them itself, same
// model as xray's `statsquery -reset`.
//
// Soft-fails on every error path (network, auth, parse): returns the
// known userId list with zero counters so a temporary stats outage
// doesn't poison the cron poller for the rest of the node's adapters.
func (a *Adapter) GetStats() (*core.Stats, error) {
	a.mu.RLock()
	statsListen := a.cfg.TrafficStatsListen
	statsSecret := a.cfg.TrafficStatsSecret
	httpClient := a.cfg.HTTPClient
	users := make([]userEntry, 0, len(a.users))
	for _, e := range a.users {
		users = append(users, e)
	}
	a.mu.RUnlock()

	out := make([]core.UserStats, 0, len(users))

	// Stats endpoint not configured (older agent OR explicitly disabled),
	// return the userId list with zero counters so the panel still sees
	// who's registered even without traffic data.
	if statsListen == "" || statsSecret == "" {
		for _, e := range users {
			out = append(out, core.UserStats{UserID: e.UserID})
		}
		return &core.Stats{Users: out}, nil
	}

	if httpClient == nil {
		httpClient = &http.Client{Timeout: 5 * time.Second}
	}

	counters, err := fetchTrafficStats(httpClient, statsListen, statsSecret)
	if err != nil {
		a.logger.Warn("hysteria GetStats: traffic API fetch failed", "err", err)
		for _, e := range users {
			out = append(out, core.UserStats{UserID: e.UserID})
		}
		return &core.Stats{Users: out}, nil
	}

	for _, e := range users {
		c := counters[e.UserID]
		out = append(out, core.UserStats{
			UserID:   e.UserID,
			BytesIn:  c.Tx,
			BytesOut: c.Rx,
		})
	}
	return &core.Stats{Users: out}, nil
}

// trafficStat mirrors the per-user shape of hysteria's traffic API
// response. Field names are byte counters since the last reset
// (we always pass ?clear=1).
type trafficStat struct {
	Tx int64 `json:"tx"`
	Rx int64 `json:"rx"`
}

func fetchTrafficStats(client HTTPClient, listen, secret string) (map[string]trafficStat, error) {
	url := fmt.Sprintf("http://%s/traffic?clear=1", listen)
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", secret)
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("traffic API HTTP %d", resp.StatusCode)
	}
	var out map[string]trafficStat
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, fmt.Errorf("decode: %w", err)
	}
	return out, nil
}

// unitProbeTTL caps how often Healthy() shells out to `systemctl is-active`.
const unitProbeTTL = 20 * time.Second

// Healthy reports whether the adapter is ready to serve traffic.
// In callback-only mode (no BinaryPath), only the auth-callback server
// must be up. With a binary configured, hysteria itself must also be up, and
// how we establish that depends on who owns its lifecycle:
//
//	ServiceUnit set    → systemd owns it. Start() deliberately skips the
//	                     in-process spawn, so a.proc is nil BY DESIGN and
//	                     asserting it reports every systemd-managed node as
//	                     permanently unhealthy, which is how genuine
//	                     degradation went unnoticed in the field. Ask systemd.
//	ServiceUnit empty  → spawn mode, we own the subprocess and can check it
//	                     directly.
func (a *Adapter) Healthy() bool {
	a.mu.RLock()
	callbackUp := a.callbackSrv != nil
	proc := a.proc
	a.mu.RUnlock()

	if !callbackUp {
		return false
	}
	if a.cfg.BinaryPath == "" {
		return true
	}
	if a.cfg.ServiceUnit != "" {
		return a.unitActive()
	}
	return proc != nil && proc.Running()
}

// unitActive reports the cached verdict on the systemd unit, refreshing it in
// the background when stale. Serving a slightly old answer is the point: the
// panel's healthcheck fan-out hits every node, and forking systemctl inline on
// each call would put an external process on that hot path.
func (a *Adapter) unitActive() bool {
	a.mu.Lock()
	if a.unitCheckedAt.IsZero() {
		// Nothing cached yet, so probe synchronously rather than report a
		// zero-value verdict we never actually measured.
		a.mu.Unlock()
		return a.probeUnit()
	}
	if time.Since(a.unitCheckedAt) >= unitProbeTTL && !a.unitProbing {
		a.unitProbing = true
		go func() {
			a.probeUnit()
			a.mu.Lock()
			a.unitProbing = false
			a.mu.Unlock()
		}()
	}
	res := a.unitHealthy
	a.mu.Unlock()
	return res
}

// probeUnit asks systemd whether the hysteria unit is active and caches the
// answer. `systemctl is-active` exits non-zero for every state but active, so
// the error IS the signal. Bounded by 2s so a wedged systemctl cannot pin the
// background refresh forever.
func (a *Adapter) probeUnit() bool {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	err := a.cfg.RunCmd(ctx, "systemctl", "is-active", "--quiet", a.cfg.ServiceUnit)
	ok := err == nil
	a.mu.Lock()
	a.unitHealthy = ok
	a.unitCheckedAt = time.Now()
	a.mu.Unlock()
	return ok
}

// ApplyInbound parses panel-pushed Hysteria config, diffs vs the last applied
// state, and on change rewrites ConfigPath + restarts the systemd unit.
//
// Idempotent: byte-equivalent input → no-op (no file rewrite, no systemctl).
//
// Hysteria's runtime config lives under a separate systemd unit (typically
// `hysteria-server.service`), not under node-agent. node-agent has the
// privileges to rewrite the YAML and trigger `systemctl restart`, that's
// what RunCmd does. The cross-unit dependency is intentional: the upstream
// hysteria binary self-manages ACME, and we don't want to fight it.
//
// When ConfigPath is empty, the adapter logs and returns nil without writing,
// useful for callback-only nodes (config managed by hand).
func (a *Adapter) ApplyInbound(port int, rawCfg json.RawMessage) error {
	var wire inboundCfgWire
	if err := json.Unmarshal(rawCfg, &wire); err != nil {
		return fmt.Errorf("hysteria ApplyInbound: parse cfg: %w", err)
	}
	newInbound := wire.toInboundConfig(port)

	a.mu.Lock()
	defer a.mu.Unlock()

	if inboundEqual(a.inbound, newInbound) {
		a.logger.Info("hysteria ApplyInbound: config unchanged, skipping rewrite")
		return nil
	}

	if a.cfg.ConfigPath == "" {
		a.logger.Info("hysteria ApplyInbound: ConfigPath not set, accepting in memory only",
			"obfs", newInbound.ObfsPassword != "",
			"masquerade", newInbound.MasqueradeURL != "")
		a.inbound = newInbound
		return nil
	}

	blob, err := renderConfig(a.cfg, newInbound)
	if err != nil {
		return fmt.Errorf("hysteria ApplyInbound: render: %w", err)
	}
	if err := writeConfig(a.cfg.ConfigPath, blob); err != nil {
		return fmt.Errorf("hysteria ApplyInbound: write %s: %w", a.cfg.ConfigPath, err)
	}

	a.inbound = newInbound
	a.logger.Info("hysteria ApplyInbound: config rewritten",
		"path", a.cfg.ConfigPath,
		"obfs", newInbound.ObfsPassword != "",
		"masquerade", newInbound.MasqueradeURL != "",
		"bandwidth", newInbound.BrutalUpMbps > 0 || newInbound.BrutalDownMbps > 0)

	if a.cfg.ServiceUnit == "" {
		a.logger.Info("hysteria ApplyInbound: ServiceUnit not set, skipping restart",
			"hint", "set HYSTERIA_SERVICE_UNIT to enable auto-restart")
		return nil
	}

	// Background context: the inbound HTTP request that triggered this call
	// may have a short deadline, but we want hysteria to come back up even
	// if the caller times out (matches the xray adapter's pattern).
	if err := a.cfg.RunCmd(context.Background(), "systemctl", "restart", a.cfg.ServiceUnit); err != nil {
		return fmt.Errorf("hysteria ApplyInbound: restart %s: %w", a.cfg.ServiceUnit, err)
	}
	a.logger.Info("hysteria ApplyInbound: service restarted", "unit", a.cfg.ServiceUnit)
	return nil
}

// LookupByPassword consults the in-memory state for a given password.
// Used by the local /auth callback handler.
func (a *Adapter) LookupByPassword(password string) (userID string, ok bool) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	entry, found := a.users[password]
	if !found {
		return "", false
	}
	return entry.UserID, true
}

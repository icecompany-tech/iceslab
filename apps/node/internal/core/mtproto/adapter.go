package mtproto

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/icecompany-tech/iceslab/apps/node/internal/core"
	"github.com/icecompany-tech/iceslab/apps/node/internal/core/subprocess"
)

const Name = "mtproto"

// Config is per-instance settings for the MTProtoAdapter.
type Config struct {
	// BinaryPath to the `mtg` executable. Empty → config-only mode.
	BinaryPath string

	// ConfigPath is where the generated mtg TOML is written.
	ConfigPath string

	// Inbound is the static settings (domain, secret, ports). The Secret
	// must be set before mtg can bind — adapter waits on first ApplyInbound
	// from panel before starting.
	Inbound InboundConfig

	// RunCmd is the injectable command runner for stats scraping.
	// Defaults to os/exec; tests inject a fake.
	RunCmd RunCmdFunc

	// MetricsURL is the mtg Prometheus stats endpoint. mtg's config.toml
	// hard-codes `bind-to = "127.0.0.1:3129"` per renderConfig, so this
	// defaults to that — overridable for tests.
	MetricsURL string

	// metricsClient is the HTTP client used for scraping. nil → default
	// 2-second-timeout client. Tests inject a fake transport.
	metricsClient *http.Client
}

type RunCmdFunc func(ctx context.Context, name string, args ...string) ([]byte, error)

// Adapter implements core.CoreAdapter for MTProto.
//
// Per-user state is intentionally absent — mtg is single-secret upstream,
// so AddUser/RemoveUser are no-ops. The adapter just tracks which user
// IDs are "associated with this inbound" for GetStats book-keeping.
type Adapter struct {
	cfg    Config
	logger *slog.Logger

	// mu protects in-memory state; held only for fast ops. The slow render +
	// subprocess Stop/Start runs under restartMu so Healthy()/GetStats don't
	// block behind a restart. Bug #1.
	mu      sync.Mutex
	users   map[string]struct{} // userIDs that the panel has assigned to this inbound
	started bool

	proc *subprocess.Subprocess

	// restartMu serializes regenerateAndRestart; never held with mu across IO.
	restartMu sync.Mutex
}

func New(cfg Config, logger *slog.Logger) *Adapter {
	if cfg.RunCmd == nil {
		cfg.RunCmd = defaultRunCmd
	}
	if cfg.MetricsURL == "" {
		cfg.MetricsURL = "http://127.0.0.1:3129/metrics"
	}
	if cfg.metricsClient == nil {
		cfg.metricsClient = &http.Client{Timeout: 2 * time.Second}
	}
	return &Adapter{
		cfg:    cfg,
		logger: logger,
		users:  make(map[string]struct{}),
	}
}

func defaultRunCmd(ctx context.Context, name string, args ...string) ([]byte, error) {
	return exec.CommandContext(ctx, name, args...).CombinedOutput()
}

func (a *Adapter) Name() string { return Name }

// Engine reports the native proxy core (mtg; no alternate engine).
func (a *Adapter) Engine() string { return "mtproto" }

// Start writes the initial config (if Domain+Secret are set) and spawns
// mtg. If either is empty, defers — first ApplyInbound activates it.
func (a *Adapter) Start(ctx context.Context) error {
	a.mu.Lock()
	notReady := a.cfg.Inbound.Domain == "" || a.cfg.Inbound.Secret == ""
	a.mu.Unlock()
	if notReady {
		a.logger.Info("mtproto adapter: domain or secret not set — waiting for ApplyInbound from panel")
		return nil
	}
	return a.regenerateAndRestart(ctx)
}

// Stop terminates mtg. Reads + clears the shared fields under a.mu, then does
// the slow proc.Stop with the lock released so Healthy()/GetStats never block
// behind it (Bug #1).
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

// AddUser is a panel-side bookkeeping no-op for MTProto. The mtg server
// has no per-user concept — every user with this inbound's URI uses the
// same shared secret. We track userIDs so GetStats can report them as
// "online" without claiming per-user byte counters we can't measure.
func (a *Adapter) AddUser(user core.User) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.users[user.UserID] = struct{}{}
	return nil
}

func (a *Adapter) RemoveUser(userID string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	delete(a.users, userID)
	return nil
}

// inboundCfgWire mirrors `MtprotoInboundCfg` in shared/transport.ts.
type inboundCfgWire struct {
	Domain string `json:"domain"`
	// Secret is computed by the panel from the inbound ID + domain
	// (DeriveSecret) and pushed here. The agent doesn't re-derive — it
	// trusts the panel's value, so panel and agent stay in sync even if
	// derivation logic ever changes.
	Secret string `json:"secret"`
}

// ApplyInbound updates the masquerade domain and secret. Both can change
// simultaneously (panel rotates the secret on domain change).
//
// Wave-14 C1: port now flows from the panel binding into mtg's bind-to.
// Pre-wave port was install-time only (MTG_PORT env, typically 443) and
// admin port changes from the UI were silently dropped. Fallback chain:
//
//	panel-pushed port → install-time ListenPort → 443 (mtg historic default
//	applied by withDefaults at render).
func (a *Adapter) ApplyInbound(port int, rawCfg json.RawMessage) error {
	var wire inboundCfgWire
	if err := json.Unmarshal(rawCfg, &wire); err != nil {
		return fmt.Errorf("mtproto ApplyInbound: parse cfg: %w", err)
	}
	if wire.Domain == "" {
		return fmt.Errorf("mtproto ApplyInbound: domain is required")
	}
	if wire.Secret == "" {
		return fmt.Errorf("mtproto ApplyInbound: secret is required")
	}

	a.mu.Lock()
	effectivePort := port
	if effectivePort == 0 {
		effectivePort = a.cfg.Inbound.ListenPort
	}
	if a.cfg.Inbound.Domain == wire.Domain &&
		a.cfg.Inbound.Secret == wire.Secret &&
		a.cfg.Inbound.ListenPort == effectivePort {
		a.mu.Unlock()
		a.logger.Info("mtproto ApplyInbound: config unchanged, skipping")
		return nil
	}

	a.cfg.Inbound.Domain = wire.Domain
	a.cfg.Inbound.Secret = wire.Secret
	if effectivePort != 0 {
		a.cfg.Inbound.ListenPort = effectivePort
	}
	newPort := a.cfg.Inbound.ListenPort
	a.mu.Unlock()
	a.logger.Info("mtproto ApplyInbound: config changed, regenerating + restarting",
		"domain", wire.Domain, "port", newPort)
	return a.regenerateAndRestart(context.Background())
}

// GetStats returns tracked users with zero per-user counters plus
// node-wide totals scraped from mtg's Prometheus endpoint.
//
// Per-user accounting is architecturally impossible: mtg is single-secret
// upstream, every user in the inbound's squad shares the same wire
// identity, so the kernel/userspace can't attribute bytes back to a
// specific userId. We surface that honestly by leaving UserStats counters
// at zero and pushing the real numbers into Stats.TotalBytesIn/Out.
//
// Metric source: `mtg_telegram_traffic{direction="from_client"|"to_client",...}`
// summed across all (dc, telegram_ip) label combinations. `mtg_domain_fronting_traffic`
// is deliberately ignored — that's SNI-probe traffic from non-Telegram
// scanners that mtg forwards to the cover domain as camouflage, not user
// traffic.
func (a *Adapter) GetStats() (*core.Stats, error) {
	a.mu.Lock()
	users := make([]core.UserStats, 0, len(a.users))
	for id := range a.users {
		users = append(users, core.UserStats{UserID: id})
	}
	url := a.cfg.MetricsURL
	client := a.cfg.metricsClient
	a.mu.Unlock()

	// N10 - parity with the SS/xray guard: no tracked users means nothing to
	// attribute, so skip the HTTP scrape of the mtg metrics endpoint. On a node
	// where mtproto is registered defensively but unused, this stops a pointless
	// GET (and its warn-spam when the endpoint is down) every cron tick.
	if len(users) == 0 {
		return &core.Stats{Users: users}, nil
	}

	in, out, err := scrapeMtgMetrics(client, url)
	if err != nil {
		// Stats poll must not fail just because metrics endpoint is
		// momentarily unreachable (mtg restart, port not yet bound, ...).
		// Log + return zero totals so the panel-side cron stays happy.
		a.logger.Warn("mtproto: prometheus scrape failed, returning zero totals", "err", err)
		return &core.Stats{Users: users}, nil
	}
	return &core.Stats{
		Users:         users,
		TotalBytesIn:  in,
		TotalBytesOut: out,
	}, nil
}

// scrapeMtgMetrics fetches the mtg Prometheus endpoint and sums
// `mtg_telegram_traffic{direction=...}` across all label sets.
//
// Returns (bytesIn, bytesOut, err). bytesIn = from_client (Telegram client
// → server → DC); bytesOut = to_client (DC → server → client).
func scrapeMtgMetrics(client *http.Client, url string) (int64, int64, error) {
	resp, err := client.Get(url)
	if err != nil {
		return 0, 0, fmt.Errorf("GET %s: %w", url, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 0, 0, fmt.Errorf("GET %s: status %d", url, resp.StatusCode)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return 0, 0, fmt.Errorf("read body: %w", err)
	}
	return parseMtgTelegramTraffic(string(body))
}

// parseMtgTelegramTraffic scans Prometheus exposition text for lines of
// the form `mtg_telegram_traffic{...direction="from_client"...} <number>`
// and sums them per direction.
func parseMtgTelegramTraffic(body string) (int64, int64, error) {
	var in, out int64
	for _, line := range strings.Split(body, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "mtg_telegram_traffic{") {
			continue
		}
		braceEnd := strings.IndexByte(line, '}')
		if braceEnd < 0 {
			continue
		}
		labels := line[len("mtg_telegram_traffic{"):braceEnd]
		valueField := strings.TrimSpace(line[braceEnd+1:])
		// Strip optional Prometheus timestamp after the value.
		if sp := strings.IndexByte(valueField, ' '); sp > 0 {
			valueField = valueField[:sp]
		}
		v, err := strconv.ParseFloat(valueField, 64)
		if err != nil {
			continue
		}
		switch {
		case strings.Contains(labels, `direction="from_client"`):
			in += int64(v)
		case strings.Contains(labels, `direction="to_client"`):
			out += int64(v)
		}
	}
	return in, out, nil
}

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

// regenerateAndRestartLocked must be called with a.mu held. mtg has no
// SIGHUP-based hot reload for the secret — restart on every config
// change. Domain changes are infrequent (admin-driven) so the
// brief downtime is acceptable.
// regenerateAndRestart renders config + (re)starts mtg. Bug #1: must NOT be
// called with a.mu held. restartMu serializes restarts; a.mu is taken only for
// the snapshot + final proc swap so Healthy()/GetStats don't block behind the
// multi-second Stop/Start.
func (a *Adapter) regenerateAndRestart(ctx context.Context) error {
	a.restartMu.Lock()
	defer a.restartMu.Unlock()

	a.mu.Lock()
	inbound := a.cfg.Inbound
	cfgPath := a.cfg.ConfigPath
	binPath := a.cfg.BinaryPath
	a.mu.Unlock()

	blob, err := renderConfig(inbound)
	if err != nil {
		return fmt.Errorf("render mtproto config: %w", err)
	}
	if cfgPath != "" {
		if err := writeConfig(cfgPath, blob); err != nil {
			return err
		}
	}
	if binPath == "" {
		a.mu.Lock()
		a.started = true
		a.mu.Unlock()
		a.logger.Info("mtproto config written (config-only mode)")
		return nil
	}

	// Restart cleanly — there's no graceful reload path in mtg for the
	// secret. ~1s downtime is fine; users' clients reconnect.
	a.mu.Lock()
	old := a.proc
	a.mu.Unlock()
	if old != nil {
		_ = old.Stop(ctx)
	}
	proc := subprocess.New(subprocess.Config{
		Name:           Name,
		Binary:         binPath,
		Args:           []string{"run", cfgPath},
		Logger:         a.logger,
		MaxRestarts:    subprocess.DefaultMaxRestarts,
		RestartBackoff: subprocess.DefaultRestartBackoff,
	})
	if err := proc.Start(ctx); err != nil {
		a.mu.Lock()
		a.proc = nil
		a.mu.Unlock()
		return fmt.Errorf("start mtg: %w", err)
	}
	a.mu.Lock()
	a.proc = proc
	a.started = true
	a.mu.Unlock()
	a.logger.Info("mtproto (mtg) (re)started", "domain", inbound.Domain)
	return nil
}

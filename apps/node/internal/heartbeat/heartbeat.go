// Package heartbeat polls the panel's /api/internal/nodes/me/status
// endpoint to detect operator-initiated deletion (or a CA mismatch from
// a panel rebuild) and triggers a clean shutdown when the panel reports
// the node is gone.
//
// Why pull-from-agent and not push-from-panel:
//   - The agent already runs an HTTPS server; adding outbound polling
//     keeps the panel-side stateless, no per-node connection bookkeeping.
//   - When the panel is rebuilt with a new CA, the panel's *push* attempts
//     fail at the TLS layer, but the agent never learns why. A pull lets
//     the agent see the explicit 410 / 401 response.
//
// Self-destruct policy (deliberately conservative):
//   - Only an explicit HTTP 410 Gone counts toward "delete me." Network
//     errors, timeouts, 5xx responses, and 401 are NOT counted as 410.
//     This keeps panel-restarts and brief outages from killing nodes.
//   - 3 consecutive 410s (default ~3 min at 60s interval) before exit.
//   - "Min-uptime" gate: we refuse to honor OnGone until we've seen at
//     least one "active" response since this agent started. A MITM with
//     a public CA-issued cert for `panel.example.com` could otherwise
//     return 410 to the very first poll on every fresh agent and wipe
//     the fleet within minutes. With the gate, the attacker would have
//     to first impersonate "active", which is harder with mTLS pinning
//     (see CACertPem below).
//
// Failsafe: setting ICESLAB_NODE_DISABLE_HEARTBEAT=1 disables the loop. Use
// this if the heartbeat itself ever misbehaves; the agent will just be
// orphaned-but-running until you SSH in to clean up.
package heartbeat

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

// Config bundles everything the loop needs. PanelURL is the public URL
// of the panel (e.g. https://panel.example.com); we tack on the
// `/api/internal/nodes/me/status` path internally.
type Config struct {
	PanelURL       string
	HeartbeatToken string
	// CACertPem is the PEM-encoded CA bundle from the bootstrap payload.
	// When set, the heartbeat HTTP client trusts ONLY this CA, system
	// trust store is bypassed. Without pinning, a MITM with a public-CA
	// cert for the panel hostname could feed 410 responses and wipe the
	// fleet via OnGone. Empty (legacy / older payloads) → fall back to
	// system trust store; log a warning at startup.
	CACertPem string
	// AgentStartTime is a per-process identifier that lets the panel detect
	// when this agent has restarted (and therefore lost its in-memory user
	// map). Sent in every heartbeat as the `X-Agent-Start-Time` header. The
	// panel side stores the last-seen value per node; when it differs from
	// what's incoming, the panel re-issues applyInbounds + addUser fan-out
	// without admin intervention.
	//
	// Slice 38 follow-up (2026-05-11): closes the cycle-5 operational gap
	// where agent restart silently dropped iOS auth callbacks until an
	// admin toggled a profile in the UI.
	//
	// Format is free-form (the panel just byte-compares); we use unix-nano
	// of process start which is monotonic per host and trivially unique.
	AgentStartTime string
	// Optional: nil means use a freshly-built http.Client with the pinned
	// CA + a 10s timeout. Tests inject a recording client. Production
	// callers should leave nil.
	HTTPClient *http.Client
	// Interval between polls. Defaults to 60s.
	Interval time.Duration
	// How many consecutive 410s before triggering OnGone. Defaults to 3.
	GoneThreshold int
	// Called when self-destruct conditions are met. The runner is
	// expected to start a graceful shutdown (stop adapters, then exit).
	OnGone func(reason string)
}

const (
	defaultInterval = 60 * time.Second
	defaultGone     = 3
	defaultTimeout  = 10 * time.Second
)

// buildHybridClient returns an http.Client whose TLS pool is (system roots)
// ∪ (panel CA from bootstrap payload).
//
// Wave-13 (2026-05-21): pre-wave the client was strictly panel-CA-only.
// In a typical production deploy the panel sits behind Caddy/nginx serving
// a Let's Encrypt cert on a public hostname (e.g. iceslab.example.com), so
// EVERY heartbeat hit `tls: certificate signed by unknown authority` and
// the loop ran with `seenActive == false` forever, orphaning nodes that
// admins thought they'd deleted in the UI. Strict pinning was defense in
// depth, not the only defense: pollOnce + the seenActive gate already
// block first-contact-410 MITM.
//
// MITM caveat (acknowledged): an attacker with a public-CA-issued cert
// for the panel hostname plus a path to intercept node→panel traffic can,
// over sustained MITM, walk the loop into honoring OnGone. The gate keeps
// the bar at >1 forged "active" then `goneThreshold` consecutive forged
// "gone", order of 10+ minutes of sustained interception with no real
// panel response leaking through. Acceptable risk vs. orphaned nodes.
//
// Returns nil + nil if the PEM is empty (caller refuses to run); returns
// nil + error if the PEM is non-empty but unparseable, so a corrupted
// payload doesn't silently demote us.
func buildHybridClient(caPem string) (*http.Client, error) {
	if caPem == "" {
		return nil, nil
	}
	// Start from system roots so LE-served public panels (the common
	// deployment) work without extra config. SystemCertPool returns
	// nil + err on Windows pre-Go-1.18, fall back to an empty pool
	// there, the panel-CA append below still works.
	pool, err := x509.SystemCertPool()
	if err != nil || pool == nil {
		pool = x509.NewCertPool()
	}
	if !pool.AppendCertsFromPEM([]byte(caPem)) {
		return nil, errors.New("heartbeat: CACertPem in payload is not parseable as PEM")
	}
	return &http.Client{
		Timeout: defaultTimeout,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{
				RootCAs:    pool,
				MinVersion: tls.VersionTLS12,
			},
		},
	}, nil
}

// Run blocks until ctx is cancelled. Returns nil, heartbeat failures
// are non-fatal and only logged; OnGone is the single way the agent
// learns "you should stop."
func Run(ctx context.Context, cfg Config, logger *slog.Logger) {
	if cfg.PanelURL == "" || cfg.HeartbeatToken == "" {
		logger.Info("heartbeat: disabled (payload lacks panelUrl/heartbeatToken)")
		return
	}
	interval := cfg.Interval
	if interval <= 0 {
		interval = defaultInterval
	}
	threshold := cfg.GoneThreshold
	if threshold <= 0 {
		threshold = defaultGone
	}
	client := cfg.HTTPClient
	if client == nil {
		hybrid, err := buildHybridClient(cfg.CACertPem)
		switch {
		case err != nil:
			logger.Error("heartbeat: refusing to start, payload CA unparseable", "err", err)
			return
		case hybrid != nil:
			client = hybrid
		default:
			// Legacy payload without CACertPem. We refuse to run with
			// system-only trust because the seenActive + threshold gate
			// alone, with no per-payload identity at all, gives a network
			// MITM more room to walk the loop into OnGone. Operator path:
			// re-bootstrap (admin clicks "Refresh bootstrap" + re-runs
			// install with --reset) to get a CACertPem in the payload.
			// To force-disable cleanly, set ICESLAB_NODE_DISABLE_HEARTBEAT=1.
			logger.Error("heartbeat: CACertPem missing from payload, refusing to start. Re-bootstrap the node, or set ICESLAB_NODE_DISABLE_HEARTBEAT=1 to silence this.")
			return
		}
	}
	url := strings.TrimRight(cfg.PanelURL, "/") + "/api/internal/nodes/me/status"

	logger.Info("heartbeat: starting",
		"interval", interval.String(),
		"goneThreshold", threshold,
		"panelUrl", cfg.PanelURL,
		"trust", "system+panelCA",
	)

	// Min-uptime gate: refuse to honor OnGone until we've seen at least
	// one "active" response post-start. Closes the cold-boot MITM where
	// an attacker just returns 410 to every request from a fresh agent.
	seenActive := false
	gone := 0
	tick := time.NewTimer(0) // fire immediately on start
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}

		status, err := pollOnce(ctx, client, url, cfg.HeartbeatToken, cfg.AgentStartTime)
		switch {
		case err != nil:
			// Network error / timeout / parse fail: DO NOT count as gone.
			logger.Warn("heartbeat: poll failed (panel unreachable, ignoring)", "err", err)
		case status == "active":
			if gone > 0 {
				logger.Info("heartbeat: panel says active, resetting gone counter")
			}
			gone = 0
			seenActive = true
		case status == "disabled":
			// Admin disabled the node, agent stays alive but logs at info
			// so operator can see the state. No counter increment.
			logger.Info("heartbeat: panel says disabled (node soft-paused, staying alive)")
			gone = 0
			seenActive = true
		case status == "gone":
			gone++
			if !seenActive {
				// Refuse to act on a "gone" we've never been "active" against,
				// first contact being 410 is the exact MITM-on-cold-boot
				// signature.
				logger.Warn("heartbeat: panel says gone but we never saw active, ignoring (cold-boot MITM guard)",
					"consecutive", gone, "threshold", threshold)
				break
			}
			logger.Warn("heartbeat: panel says gone", "consecutive", gone, "threshold", threshold)
			if gone >= threshold && cfg.OnGone != nil {
				cfg.OnGone("panel returned 410 Gone for this node")
				return
			}
		default:
			logger.Warn("heartbeat: unknown status", "status", status)
		}

		tick.Reset(interval)
	}
}

// pollOnce returns the high-level status string the loop cares about:
// "active", "disabled", "gone", or an error for everything else.
//
// 401 (bad token) is NOT mapped to "gone", that case usually means the
// agent's payload is from a different panel install and the right thing
// is to log loudly and let an admin re-bootstrap. Auto-destructing on
// 401 would be too aggressive: any future panel-side bug that broke
// HMAC verification globally would silently kill every node in the
// fleet at once.
func pollOnce(ctx context.Context, client *http.Client, url, token, agentStartTime string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	if agentStartTime != "" {
		req.Header.Set("X-Agent-Start-Time", agentStartTime)
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case http.StatusGone:
		// Drain so the connection can be reused.
		_, _ = io.Copy(io.Discard, resp.Body)
		return "gone", nil
	case http.StatusUnauthorized:
		_, _ = io.Copy(io.Discard, resp.Body)
		return "", errors.New("panel returned 401, token invalid (likely orphaned payload)")
	case http.StatusOK:
		var body struct {
			Status string `json:"status"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
			return "", err
		}
		switch body.Status {
		case "active", "disabled":
			return body.Status, nil
		default:
			return "", errors.New("unexpected status field: " + body.Status)
		}
	default:
		_, _ = io.Copy(io.Discard, resp.Body)
		return "", errors.New("unexpected http status: " + resp.Status)
	}
}

// Package server hosts the node-agent's mTLS HTTPS server. It dispatches
// `addUser` / `removeUser` / `getStats` calls to every registered CoreAdapter.
package server

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/icecompany-tech/iceslab/apps/node/internal/atomicfile"
	"github.com/icecompany-tech/iceslab/apps/node/internal/core"
	"github.com/icecompany-tech/iceslab/apps/node/internal/dto"
	"github.com/icecompany-tech/iceslab/apps/node/internal/firewall"
	"github.com/icecompany-tech/iceslab/apps/node/internal/metrics"
	"github.com/icecompany-tech/iceslab/apps/node/internal/payload"
)

// protoForInbound returns the L4 protocols the given inbound listens on.
// Keep in sync with apps/node/main.go default-port env keys and with
// scripts/install-iceslab-node.sh's per-protocol ufw block.
//   - hysteria, amneziawg: UDP only (QUIC / WireGuard)
//   - xray, naive, mtproto: TCP only
//   - shadowsocks, mieru: both TCP and UDP (xray-core SS2022 listens on
//     both; mita supports either depending on per-port transport)
func protoForInbound(p dto.ProtocolName) []string {
	switch p {
	case "hysteria", "amneziawg":
		return []string{"udp"}
	case "shadowsocks", "mieru":
		return []string{"tcp", "udp"}
	default:
		// xray, naive, mtproto, plus any new TCP-only protocol.
		return []string{"tcp"}
	}
}

type Config struct {
	Host    string
	Port    string
	Payload *payload.Payload
	Logger  *slog.Logger
	// Adapters is the ordered list of registered cores. The dispatcher fans
	// AddUser / RemoveUser out to all of them and merges Stats. May be empty
	// (callback-only mode).
	Adapters []core.CoreAdapter
	// InboundsStorePath is where /applyInbounds persists the latest pushed
	// state to disk so it survives node-agent restarts. Default
	// `/etc/iceslab-node/inbounds.json`. Empty means in-memory only
	// (used in tests).
	InboundsStorePath string
}

type Server struct {
	cfg       Config
	logger    *slog.Logger
	startedAt time.Time
	collector *metrics.Collector
}

func New(cfg Config) (*Server, error) {
	if cfg.Logger == nil {
		return nil, errors.New("logger is required")
	}
	if cfg.Payload == nil {
		return nil, errors.New("payload is required")
	}
	return &Server{
		cfg:       cfg,
		logger:    cfg.Logger,
		collector: metrics.New("/"),
	}, nil
}

// Run starts the HTTPS server and blocks until ctx is cancelled or it errors.
// On cancellation it gracefully shuts down with a 5s deadline.
func (s *Server) Run(ctx context.Context) error {
	s.startedAt = time.Now()

	// Self-heal the firewall on boot: re-open UFW for every persisted inbound
	// port. Covers restarts and the case where a push-time `ufw allow` failed
	// transiently (it has no retry) or the rule was lost to a reimage.
	s.ensureFirewallFromStore(ctx)

	cert, err := tls.X509KeyPair(
		[]byte(s.cfg.Payload.NodeCertPem),
		[]byte(s.cfg.Payload.NodeKeyPem),
	)
	if err != nil {
		return fmt.Errorf("load node keypair: %w", err)
	}

	caPool := x509.NewCertPool()
	if !caPool.AppendCertsFromPEM([]byte(s.cfg.Payload.CACertPem)) {
		return errors.New("invalid CA pem in payload")
	}

	// Slice S6 — pin the panel-client cert by SHA-256 fingerprint. CA-trust
	// alone is not enough: with a single CA in the trust pool, ANY
	// CA-signed leaf passes verification, including a leaf stolen from a
	// compromised peer node. Pinning the panel-client cert collapses the
	// blast radius back to "panel only."
	//
	// Backwards compat: payloads issued before S6 don't carry a fingerprint.
	// Those agents fall back to "verify CA chain only" — same as before. To
	// roll the fleet to pinning, re-issue bootstrap tokens (admin clicks
	// "Refresh bootstrap" + reinstalls with --reset).
	expectedFingerprint := strings.ToLower(s.cfg.Payload.PanelClientFingerprint)
	if expectedFingerprint == "" {
		// Pre-S6 payloads omitted the panel-client fingerprint, so the
		// agent would fall back to "trust any CA-signed leaf" — which
		// means a stolen peer-node cert passes. For alpha we fail-closed:
		// operator must re-bootstrap (admin clicks "Refresh bootstrap" +
		// reinstalls with --reset) to get a payload that carries the pin.
		return errors.New("payload missing PanelClientFingerprint — re-bootstrap required (panel admin: Refresh bootstrap, then re-run install with --reset)")
	}
	verifyPeer := func(rawCerts [][]byte, _ [][]*x509.Certificate) error {
		if len(rawCerts) == 0 {
			return errors.New("client presented no cert")
		}
		sum := sha256.Sum256(rawCerts[0])
		gotFingerprint := hex.EncodeToString(sum[:])
		// Wave-14 #8: subtle.ConstantTimeCompare to remove timing oracle on
		// the pinned panel cert. SHA-256 hex space is huge so practical
		// exploit is limited, but pinning is the last line of defence
		// against a stolen CA-signed peer-node cert — make the comparison
		// not leak partial-match info via byte-by-byte short-circuiting.
		if subtle.ConstantTimeCompare([]byte(gotFingerprint), []byte(expectedFingerprint)) != 1 {
			return fmt.Errorf("panel-client cert fingerprint mismatch (got %s, expected %s)", gotFingerprint, expectedFingerprint)
		}
		return nil
	}

	httpSrv := &http.Server{
		Addr:    s.cfg.Host + ":" + s.cfg.Port,
		Handler: s.routes(),
		TLSConfig: &tls.Config{
			Certificates:          []tls.Certificate{cert},
			ClientCAs:             caPool,
			ClientAuth:            tls.RequireAndVerifyClientCert,
			MinVersion:            tls.VersionTLS12,
			VerifyPeerCertificate: verifyPeer,
		},
		ReadHeaderTimeout: 10 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		s.logger.Info("listening", "addr", httpSrv.Addr)
		err := httpSrv.ListenAndServeTLS("", "")
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
		close(errCh)
	}()

	select {
	case <-ctx.Done():
		s.logger.Info("shutdown signal received")
		shutCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return httpSrv.Shutdown(shutCtx)
	case err := <-errCh:
		return err
	}
}

// maxRequestBodyBytes caps every panel→agent request body. Even though the
// transport is mTLS-gated, a buggy or compromised panel-cert holder shouldn't
// be able to OOM the agent by streaming a 10 GB applyInbounds. 1 MiB is well
// above any realistic ApplyInbounds payload (current largest seen: ~12 KiB).
const maxRequestBodyBytes = 1 << 20

// decodeJSONBody wraps json.NewDecoder + http.MaxBytesReader with proper
// HTTP-status mapping. The body-too-large case is 413 (BODY_TOO_LARGE), not
// 400 (INVALID_BODY) — distinguishing the two lets the panel side log
// "agent rejected oversized push" separately from "agent rejected malformed
// JSON," which means different operator-facing diagnoses.
func decodeJSONBody(w http.ResponseWriter, r *http.Request, dst any) error {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxRequestBodyBytes))
	if err := dec.Decode(dst); err != nil {
		var maxBytes *http.MaxBytesError
		if errors.As(err, &maxBytes) {
			writeError(w, http.StatusRequestEntityTooLarge, "BODY_TOO_LARGE",
				fmt.Sprintf("request body exceeds %d bytes", maxRequestBodyBytes))
			return err
		}
		writeError(w, http.StatusBadRequest, "INVALID_BODY", err.Error())
		return err
	}
	return nil
}

func (s *Server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", s.handleHealth)
	mux.HandleFunc("/addUser", s.handleAddUser)
	mux.HandleFunc("/removeUser", s.handleRemoveUser)
	mux.HandleFunc("/applyInbounds", s.handleApplyInbounds)
	mux.HandleFunc("/stats", s.handleStats)
	mux.HandleFunc("/metrics", s.handleMetrics)
	return mux
}

// ───── Handlers ─────

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "GET only")
		return
	}
	// N8 - probe cores concurrently. Each Healthy() may fork a CLI (awg show);
	// serial probing stacked the per-core timeouts into one slow healthcheck.
	// Fixed-index slots avoid a shared-write race and preserve adapter order.
	cores := make([]dto.CoreStatus, len(s.cfg.Adapters))
	var wg sync.WaitGroup
	for i, adapter := range s.cfg.Adapters {
		wg.Add(1)
		go func(i int, adapter core.CoreAdapter) {
			defer wg.Done()
			cores[i] = dto.CoreStatus{
				Name:    dto.ProtocolName(adapter.Name()),
				Running: adapter.Healthy(),
			}
		}(i, adapter)
	}
	wg.Wait()

	allHealthy := true
	for _, c := range cores {
		if !c.Running {
			allHealthy = false
			break
		}
	}
	status := "ok"
	if !allHealthy {
		status = "degraded"
	}
	writeJSON(w, http.StatusOK, dto.HealthcheckResponse{Status: status, Cores: cores})
}

func (s *Server) handleAddUser(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "POST only")
		return
	}
	var req dto.AddUserRequest
	if err := decodeJSONBody(w, r, &req); err != nil {
		return
	}

	coreUser := core.User{
		UserID:             req.UserID,
		ShortID:            req.ShortID,
		Username:           req.Username,
		HysteriaPassword:   req.Credentials.HysteriaPassword,
		XrayUUID:           req.Credentials.XrayUUID,
		NaivePassword:      req.Credentials.NaivePassword,
		AmneziaWGPublicKey: req.Credentials.AmneziaWGPublicKey,
		AmneziaWGAllowedIP: req.Credentials.AmneziaWGAllowedIP,
	}

	// Best-effort fanout. A failure on a dormant adapter (no ApplyInbound
	// received yet, not Healthy()) is logged at WARN and ignored — adapters
	// cache users in memory regardless of started state, so a "not ready"
	// AddUser still lands in the cache and gets flushed on next ApplyInbound.
	// Only failures from already-Healthy() adapters propagate as 500 — those
	// are real (process up but rejected the user). Cycle #6 bug:
	// pre-2026-05-21 ANY adapter error 500'd the request, which kept
	// BullMQ retrying backfill against a fresh node where xray wasn't up yet
	// but mtproto had already accepted the user.
	var healthyFailed []string
	for _, adapter := range s.cfg.Adapters {
		isHealthy := adapter.Healthy()
		if err := adapter.AddUser(coreUser); err != nil {
			if isHealthy {
				s.logger.Error("adapter addUser failed", "core", adapter.Name(), "err", err)
				healthyFailed = append(healthyFailed, adapter.Name())
			} else {
				s.logger.Warn("adapter addUser failed (dormant — ignored)", "core", adapter.Name(), "err", err)
			}
		}
	}
	if len(healthyFailed) > 0 {
		writeError(w, http.StatusInternalServerError, "ADAPTER_FAILED",
			fmt.Sprintf("active adapters failed: %s", strings.Join(healthyFailed, ", ")))
		return
	}

	s.logger.Info("addUser ok", "userId", req.UserID, "username", req.Username)
	writeJSON(w, http.StatusOK, dto.AddUserResponse{OK: true})
}

func (s *Server) handleRemoveUser(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "POST only")
		return
	}
	var req dto.RemoveUserRequest
	if err := decodeJSONBody(w, r, &req); err != nil {
		return
	}

	// Same best-effort semantics as handleAddUser — see comment there.
	var healthyFailed []string
	for _, adapter := range s.cfg.Adapters {
		isHealthy := adapter.Healthy()
		if err := adapter.RemoveUser(req.UserID); err != nil {
			if isHealthy {
				s.logger.Error("adapter removeUser failed", "core", adapter.Name(), "err", err)
				healthyFailed = append(healthyFailed, adapter.Name())
			} else {
				s.logger.Warn("adapter removeUser failed (dormant — ignored)", "core", adapter.Name(), "err", err)
			}
		}
	}
	if len(healthyFailed) > 0 {
		writeError(w, http.StatusInternalServerError, "ADAPTER_FAILED",
			fmt.Sprintf("active adapters failed: %s", strings.Join(healthyFailed, ", ")))
		return
	}

	s.logger.Info("removeUser ok", "userId", req.UserID)
	writeJSON(w, http.StatusOK, dto.RemoveUserResponse{OK: true})
}

// handleApplyInbounds receives the panel's full inbound set for this node
// and persists it to disk so the next node-agent / adapter restart picks it
// up. Slice 24 v1 — minimal version: persists + logs, no per-protocol live
// reconfiguration yet (that's per-adapter follow-up work). Idempotent: the
// `applied` / `skipped` counters in the response always reflect "everything
// was overwritten", so the panel can use it as a generic ack.
func (s *Server) handleApplyInbounds(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "POST only")
		return
	}
	var req dto.ApplyInboundsRequest
	if err := decodeJSONBody(w, r, &req); err != nil {
		return
	}

	if s.cfg.InboundsStorePath != "" {
		if err := writeInboundsAtomically(s.cfg.InboundsStorePath, req.Inbounds); err != nil {
			s.logger.Error("persist inbounds failed", "err", err, "path", s.cfg.InboundsStorePath)
			writeError(w, http.StatusInternalServerError, "PERSIST_FAILED", err.Error())
			return
		}
	}

	// Dispatch each inbound to the matching adapter by protocol name. Adapters
	// that don't recognise the protocol return nil (defensive no-op contract).
	// Slice 24b — Xray has a real reconfig impl; the others are stubs that
	// log and rely on the persisted inbounds.json for next-restart pickup.
	applied := 0
	failed := 0
	for _, ib := range req.Inbounds {
		s.logger.Info("applyInbounds received",
			"id", ib.ID, "name", ib.Name, "protocol", ib.Protocol, "port", ib.Port)

		var matched core.CoreAdapter
		for _, adapter := range s.cfg.Adapters {
			if adapter.Name() == string(ib.Protocol) {
				matched = adapter
				break
			}
		}
		if matched == nil {
			s.logger.Warn("applyInbounds: no adapter for protocol — config persisted but not applied live",
				"protocol", ib.Protocol)
			continue
		}
		if err := matched.ApplyInbound(ib.Port, ib.Config); err != nil {
			s.logger.Error("adapter ApplyInbound failed",
				"core", matched.Name(), "inboundId", ib.ID, "err", err)
			failed++
			continue
		}
		// Open UFW for the inbound's port. Extracted into ensureInboundFirewall
		// so the exact same logic also runs on boot (ensureFirewallFromStore),
		// not only when a push lands.
		s.ensureInboundFirewall(r.Context(), ib)
		applied++
	}

	if failed > 0 {
		writeError(w, http.StatusInternalServerError, "ADAPTER_FAILED",
			fmt.Sprintf("%d/%d inbounds failed to apply", failed, len(req.Inbounds)))
		return
	}

	writeJSON(w, http.StatusOK, dto.ApplyInboundsResponse{
		OK:      true,
		Applied: applied,
		Skipped: len(req.Inbounds) - applied,
	})
}

// ensureInboundFirewall opens UFW for one inbound's port. Per-protocol UDP vs
// TCP from protoForInbound() keeps it in lockstep with install-iceslab-node.sh.
// Idempotent: ufw skips already-existing rules silently.
//
// Bug #9: when ib.Port == 0 (legacy pre-slice-50 push), the adapter falls back
// to its install-time ListenPort, but the server can't see that port, so
// firewall.Allow(0) is a no-op and the real port may have no UFW rule. The
// current panel always sends a concrete port, so this is a defensive log.
func (s *Server) ensureInboundFirewall(ctx context.Context, ib dto.InboundDto) {
	if ib.Port == 0 {
		s.logger.Warn("applyInbounds: inbound has port=0 (legacy push); "+
			"firewall rule NOT opened automatically, open the adapter's "+
			"install-time port manually if clients can't connect",
			"protocol", ib.Protocol, "inboundId", ib.ID)
		return
	}
	for _, proto := range protoForInbound(ib.Protocol) {
		firewall.Allow(ctx, s.logger, ib.Port, proto)
	}
}

// ensureFirewallFromStore re-opens UFW for every persisted inbound port on boot.
// The applyInbounds handler opens ports too, but only when a push lands; a node
// that restarts (or whose ufw rule was lost to a reimage, or to a transient
// `ufw allow` failure that has no retry) would otherwise run its cores with the
// firewall closed until the next panel push. Re-ensuring from the persisted set
// on every start makes the firewall self-heal. Best-effort: a missing or
// unparseable store is skipped silently (fresh node = nothing to ensure).
func (s *Server) ensureFirewallFromStore(ctx context.Context) {
	if s.cfg.InboundsStorePath == "" {
		return
	}
	body, err := os.ReadFile(s.cfg.InboundsStorePath)
	if err != nil {
		return // no persisted inbounds yet
	}
	var inbounds []dto.InboundDto
	if err := json.Unmarshal(body, &inbounds); err != nil {
		s.logger.Warn("ensureFirewallFromStore: cannot parse persisted inbounds", "err", err)
		return
	}
	for _, ib := range inbounds {
		s.ensureInboundFirewall(ctx, ib)
	}
	if len(inbounds) > 0 {
		s.logger.Info("ensureFirewallFromStore: re-ensured firewall for persisted inbounds", "count", len(inbounds))
	}
}

// writeInboundsAtomically marshals the inbound set and delegates to the
// shared atomicfile helper (fsync(file)+fsync(dir) for power-loss durability).
// Mode 0600 because the configs may embed REALITY private keys / WireGuard
// server keys.
//
// Previously had a bespoke tmp+rename without fsync — bypassed the Wave-4
// hardening the proxy-core writers got. Now consistent with them.
func writeInboundsAtomically(path string, inbounds []dto.InboundDto) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("mkdir %s: %w", dir, err)
	}
	body, err := json.MarshalIndent(inbounds, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal: %w", err)
	}
	return atomicfile.Write(path, body, 0o600)
}

func (s *Server) handleMetrics(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "GET only")
		return
	}
	snap, err := s.collector.Collect()
	if err != nil {
		// Soft-fail: emit whatever sections succeeded; the panel can render
		// partial data rather than show "node down" because /proc/loadavg
		// briefly EBUSY'd. Hard-fail only when *every* section returned err
		// (Collect propagates that as a non-nil error in that case only).
		s.logger.Warn("metrics collect partial", "err", err)
	}
	writeJSON(w, http.StatusOK, dto.HostMetricsResponse{
		CPU: dto.CPUMetricsDto{
			UsagePercent: snap.CPU.UsagePercent,
			LoadAvg1:     snap.CPU.LoadAvg1,
			LoadAvg5:     snap.CPU.LoadAvg5,
			LoadAvg15:    snap.CPU.LoadAvg15,
			Cores:        snap.CPU.Cores,
		},
		Memory: dto.MemoryMetricsDto{
			TotalBytes:     snap.Memory.TotalBytes,
			AvailableBytes: snap.Memory.AvailableBytes,
			UsedBytes:      snap.Memory.UsedBytes,
			UsedPercent:    snap.Memory.UsedPercent,
		},
		Disk: dto.DiskMetricsDto{
			Path:        snap.Disk.Path,
			TotalBytes:  snap.Disk.TotalBytes,
			UsedBytes:   snap.Disk.UsedBytes,
			UsedPercent: snap.Disk.UsedPercent,
		},
		UptimeSeconds: snap.UptimeSeconds,
		CollectedAt:   snap.CollectedAt.UTC().Format(time.RFC3339Nano),
	})
}

func (s *Server) handleStats(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "GET only")
		return
	}
	// N8 - poll adapters concurrently. Each GetStats forks a CLI/binary (xray
	// statsquery, awg show dump); serial polling stacked the per-adapter
	// timeouts into one long request. Per-index slots avoid a shared-write race.
	type statResult struct {
		users      []dto.UserStats
		in         int64
		out        int64
		cumulative bool
	}
	results := make([]statResult, len(s.cfg.Adapters))
	var wg sync.WaitGroup
	for i, adapter := range s.cfg.Adapters {
		wg.Add(1)
		go func(i int, adapter core.CoreAdapter) {
			defer wg.Done()
			stats, err := adapter.GetStats()
			if err != nil {
				s.logger.Error("adapter getStats failed", "core", adapter.Name(), "err", err)
				return
			}
			res := statResult{in: stats.TotalBytesIn, out: stats.TotalBytesOut, cumulative: stats.Cumulative}
			for _, u := range stats.Users {
				res.users = append(res.users, dto.UserStats{
					UserID:   u.UserID,
					BytesIn:  u.BytesIn,
					BytesOut: u.BytesOut,
				})
			}
			results[i] = res
		}(i, adapter)
	}
	wg.Wait()

	allUsers := []dto.UserStats{}
	var totalIn, totalOut int64
	var cumulative bool
	for _, res := range results {
		allUsers = append(allUsers, res.users...)
		totalIn += res.in
		totalOut += res.out
		// #5 - only xray fills Users[] and it reports cumulative; OR the flag so
		// the panel uses the snapshot-delta path for this node's per-user counters.
		cumulative = cumulative || res.cumulative
	}
	uptime := int64(time.Since(s.startedAt).Seconds())
	writeJSON(w, http.StatusOK, dto.GetStatsResponse{
		Users:         allUsers,
		Uptime:        uptime,
		TotalBytesIn:  totalIn,
		TotalBytesOut: totalOut,
		Cumulative:    cumulative,
	})
}

// ───── Helpers ─────

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, status int, code, msg string) {
	writeJSON(w, status, dto.ErrorResponse{Error: code, Message: msg})
}

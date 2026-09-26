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
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/icecompany-tech/iceslab/apps/node/internal/atomicfile"
	"github.com/icecompany-tech/iceslab/apps/node/internal/chain"
	"github.com/icecompany-tech/iceslab/apps/node/internal/core"
	"github.com/icecompany-tech/iceslab/apps/node/internal/dto"
	"github.com/icecompany-tech/iceslab/apps/node/internal/firewall"
	"github.com/icecompany-tech/iceslab/apps/node/internal/geo"
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
	case "hysteria", "amneziawg", "tuic":
		// tuic is QUIC (UDP-only), like hysteria.
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
	// Chain runs the cascade as its own process (phase 4). Nil means this
	// build cannot draw a chain that way, and a pushed chain block is then
	// refused out loud rather than dropped: the panel would otherwise believe
	// a chain is up that nothing is running.
	Chain *chain.Manager
	// Geo is the geo directory (phase 9). Nil means this agent keeps none:
	// /assets answers 404 and a push carrying geo is refused.
	Geo *geo.Store
	// ResolverProbe asks the host's resolver on every /healthz (E37); an error
	// degrades the node with dto.ResolverDownReason. main wires
	// SystemResolverProbe. Nil asks nothing, which is what tests get.
	ResolverProbe func(ctx context.Context) error
	// EnvFile is the agent's env, where the bootstraps declare their cores
	// (E42, declaredEngines). Empty reports nothing, which is what tests get.
	EnvFile string
}

type Server struct {
	cfg       Config
	logger    *slog.Logger
	startedAt time.Time
	collector *metrics.Collector

	// idle holds the cores the last APPLIED push did not name (keyed by
	// adapter). /healthz reports them running:false with core.IdleReason and
	// does not let them degrade the node: nothing is meant to run there. Empty
	// until a push lands; a push the agent refused changes nothing in it.
	idleMu sync.Mutex
	idle   map[core.CoreAdapter]bool

	// geoVersion is the geo version of the last applied push that carried
	// one, for /healthz. Nil until then.
	geoMu      sync.Mutex
	geoVersion *string
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

	// And the cores themselves, from the same file. See restoreFromStore: until
	// 2026-09-22 a restarted agent brought back the firewall and nothing else,
	// and waited for a panel that could not always speak.
	s.restoreFromStore(ctx)

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

	// Slice S6: pin the panel-client cert by SHA-256 fingerprint. CA-trust
	// alone is not enough: with a single CA in the trust pool, ANY
	// CA-signed leaf passes verification, including a leaf stolen from a
	// compromised peer node. Pinning the panel-client cert collapses the
	// blast radius back to "panel only."
	//
	// Backwards compat: payloads issued before S6 don't carry a fingerprint.
	// Those agents fall back to "verify CA chain only", same as before. To
	// roll the fleet to pinning, re-issue bootstrap tokens (admin clicks
	// "Refresh bootstrap" + reinstalls with --reset).
	expectedFingerprint := strings.ToLower(s.cfg.Payload.PanelClientFingerprint)
	if expectedFingerprint == "" {
		// Pre-S6 payloads omitted the panel-client fingerprint, so the
		// agent would fall back to "trust any CA-signed leaf", which
		// means a stolen peer-node cert passes. For alpha we fail-closed:
		// operator must re-bootstrap (admin clicks "Refresh bootstrap" +
		// reinstalls with --reset) to get a payload that carries the pin.
		return errors.New("payload missing PanelClientFingerprint, re-bootstrap required (panel admin: Refresh bootstrap, then re-run install with --reset)")
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
		// against a stolen CA-signed peer-node cert, make the comparison
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
// 400 (INVALID_BODY), distinguishing the two lets the panel side log
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
	mux.HandleFunc("/ufwPorts", s.handleUfwPorts)
	mux.HandleFunc("/assets", s.handleAssetsList)
	mux.HandleFunc("/assets/", s.handleAssetPut)
	return mux
}

// handleAssetsList answers GET /assets: the geo files on disk with their
// sha256, which is what the panel compares before sending only what differs.
func (s *Server) handleAssetsList(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "GET only")
		return
	}
	if s.cfg.Geo == nil {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "this agent keeps no geo directory")
		return
	}
	files, err := s.cfg.Geo.List()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "ASSETS_READ_FAILED", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, dto.GeoAssetsResponse{Files: files})
}

// handleAssetPut answers PUT /assets/<name>: one geo file, its body the
// bytes, X-Content-Sha256 what they must hash to. Nothing on disk changes
// unless they do. The only route whose body may exceed maxRequestBodyBytes;
// its own ceiling is geo.MaxFileBytes.
func (s *Server) handleAssetPut(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		writeError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "PUT only")
		return
	}
	if s.cfg.Geo == nil {
		writeError(w, http.StatusNotFound, "NOT_FOUND", "this agent keeps no geo directory")
		return
	}
	name := strings.TrimPrefix(r.URL.Path, "/assets/")
	if !geo.ValidName(name) {
		writeError(w, http.StatusBadRequest, "ASSET_NAME_INVALID",
			fmt.Sprintf("%q is not a geo file name (geosite.dat, geoip.dat, iceslab-<set>.dat, iceslab-<set>.<tag>.json)", name))
		return
	}
	want := strings.TrimSpace(r.Header.Get("X-Content-Sha256"))
	if len(want) != 64 {
		writeError(w, http.StatusBadRequest, "ASSET_SHA_REQUIRED", "X-Content-Sha256 must carry the file's sha256, 64 hex characters")
		return
	}
	if r.ContentLength > geo.MaxFileBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "ASSET_TOO_LARGE",
			fmt.Sprintf("%d bytes, the ceiling is %d", r.ContentLength, geo.MaxFileBytes))
		return
	}
	file, err := s.cfg.Geo.Put(name, r.Body, want)
	var mismatch *geo.ShaMismatchError
	switch {
	case err == nil:
		writeJSON(w, http.StatusOK, file)
	case errors.Is(err, geo.ErrTooLarge):
		writeError(w, http.StatusRequestEntityTooLarge, "ASSET_TOO_LARGE", fmt.Sprintf("the ceiling is %d bytes", geo.MaxFileBytes))
	case errors.As(err, &mismatch):
		writeJSON(w, http.StatusUnprocessableEntity, map[string]string{
			"error": "ASSET_SHA_MISMATCH", "message": mismatch.Error(),
			"expected": mismatch.Expected, "got": mismatch.Got,
		})
	case geo.IsNoSpace(err):
		writeError(w, http.StatusInsufficientStorage, "ASSET_NO_SPACE", err.Error())
	default:
		writeError(w, http.StatusInternalServerError, "ASSET_WRITE_FAILED", err.Error())
	}
}

// geoFingerprint is what an adapter that reads files at start compares: the
// files of one reader, by name and sha256, in a stable order.
func geoFingerprint(g *dto.NodeGeo, reader string) string {
	parts := []string{}
	for _, f := range g.Files {
		if f.Reader == reader {
			parts = append(parts, f.Name+"="+strings.ToLower(f.Sha256))
		}
	}
	sort.Strings(parts)
	return strings.Join(parts, ",")
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
	// The host's resolver, asked beside the cores rather than after them, so a
	// dead one costs the healthcheck its 2 s once and not on top of the rest.
	resolverDown := false
	if s.cfg.ResolverProbe != nil {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ctx, cancel := context.WithTimeout(r.Context(), resolverProbeTimeout)
			defer cancel()
			if err := s.cfg.ResolverProbe(ctx); err != nil {
				s.logger.Warn("the host's resolver did not answer", "err", err)
				resolverDown = true
			}
		}()
	}
	for i, adapter := range s.cfg.Adapters {
		wg.Add(1)
		go func(i int, adapter core.CoreAdapter) {
			defer wg.Done()
			cs := dto.CoreStatus{
				Name:    dto.ProtocolName(adapter.Name()),
				Running: adapter.Healthy(),
				Engine:  adapter.Engine(),
			}
			idle := s.isIdle(adapter)
			// Which node-level settings this core actually carries out. Both are
			// optional interfaces, and today only one adapter implements either,
			// so on a node whose cores do not the operator's policy and resolver
			// are saved in the panel and applied nowhere. The panel cannot work
			// this out on its own without keeping a copy of this list, which
			// would go stale the first time an adapter learns to render one.
			//
			// Per CORE and not per node on purpose: a node running xray and
			// sing-box applies the policy to its xray users and not to the
			// others, so "this node applies the policy" is already a lie.
			_, rendersPolicy := adapter.(core.PolicyReceiver)
			_, rendersDns := adapter.(core.DnsReceiver)
			cs.RendersPolicy = &rendersPolicy
			cs.RendersDns = &rendersDns
			// Whether this core is configured at all. Same optional-interface
			// pattern; adapters that don't report count as configured.
			if p, ok := adapter.(core.Provisionable); ok {
				provisioned := p.Provisioned()
				cs.Provisioned = &provisioned
			}
			// E26, stand 24.09: a node whose push names no hysteria read as
			// DEGRADED, "not running: hysteria", right after the hysteria
			// bootstrap: the unit waits for a config nobody sends, which is
			// exactly right. A core the last push did not name is idle BY THAT
			// PUSH, whatever its own Provisioned says, and says so.
			if idle {
				f := false
				cs.Running = false
				cs.Provisioned = &f
				cs.Reason = core.IdleReason
			}
			// And whether it is even on the machine, which is a different
			// question: a core can be configured perfectly and absent from
			// disk, and then it renders nothing. The panel showed a node
			// applying a routing policy no installed core carries out.
			if i, ok := adapter.(core.Installable); ok {
				installed := i.Installed()
				cs.Installed = &installed
			}
			// T7: surface the core version when the adapter can report it, so
			// the panel can gate min-version features (xray >= 25.9.5 for
			// cascade exit selection). Cached adapter-side, cheap to call.
			//
			// Only for a core that is on the machine (E35, ru-02 25.09): a
			// leftover of an old install answers with a version of its own,
			// the DKMS module 1.0.0 there, and "not installed, version 1.0.0"
			// is a number for something that is not the core.
			if cs.Installed == nil || *cs.Installed {
				if v, ok := adapter.(core.Versioner); ok {
					cs.Version = v.CoreVersion()
				}
				if v, ok := adapter.(core.ToolsVersioner); ok {
					cs.ToolsVersion = v.ToolsVersion()
				}
				if g, ok := adapter.(core.AwgProtocolReporter); ok {
					cs.AwgProtocol = g.AwgProtocol()
					cs.AwgGenerations = g.AwgGenerations()
				}
			}
			// The certificate this core serves (E30a), for the panel's "Cores"
			// beside the certificate it minted. Absent = unknown.
			if tr, ok := adapter.(core.TLSReporter); ok {
				if f := tr.TLSFact(); f != nil {
					t := dto.CoreTLSDto{Source: f.Source, CertSha256: f.CertSha256}
					if !f.NotAfter.IsZero() {
						t.NotAfter = f.NotAfter.UTC().Format(time.RFC3339)
					}
					cs.TLS = &t
				}
			}
			// Ports this core's own services hold. The panel refuses a binding
			// on a port a profile or a cascade leg already has, and had nothing
			// to say about these: the save went through and the node failed to
			// bring one of the two listeners up.
			if pr, ok := adapter.(core.PortReserver); ok {
				// Non-nil from the start, so an adapter that implements the
				// interface and holds nothing answers `[]` rather than
				// vanishing. Saying "I hold nothing" is what lets the panel be
				// certain about the node; staying silent is what it does when
				// it cannot say.
				held := []dto.ReservedPortDto{}
				for _, rp := range pr.ReservedPorts() {
					if rp.Port <= 0 {
						continue
					}
					held = append(held, dto.ReservedPortDto{
						Owner: rp.Owner,
						Port:  rp.Port,
						// Every one of them is a loopback TCP socket. Sent
						// rather than assumed by the panel, which compares it
						// against a binding's transport.
						Transport: "tcp",
					})
				}
				cs.ReservedPorts = &held
			}
			// Restart tally, same optional-interface pattern. Without it a
			// memory-watchdog restart is invisible: the core bounces, users
			// see drops, and this endpoint keeps saying "running: true".
			if r, ok := adapter.(core.RestartReporter); ok {
				st := r.RestartStats()
				dtoRestarts := dto.CoreRestartsDto{
					Core:             adapter.Name(),
					Total:            st.Crash + st.Memory,
					Crash:            st.Crash,
					Memory:           st.Memory,
					LastReason:       st.LastReason,
					MemoryLimitBytes: st.MemoryLimitBytes,
					RssBytes:         st.RSSBytes,
				}
				if !st.LastAt.IsZero() {
					dtoRestarts.LastAt = st.LastAt.UTC().Format(time.RFC3339)
				}
				if !st.SinceAt.IsZero() {
					dtoRestarts.SinceAt = st.SinceAt.UTC().Format(time.RFC3339)
				}
				cs.Restarts = &dtoRestarts
			}
			cores[i] = cs
		}(i, adapter)
	}
	wg.Wait()

	// Only a CONFIGURED core that is down makes the node degraded. A core the
	// operator never configured is idle by design and used to make every healthy
	// node report `degraded` forever, which meant the status stopped changing
	// when something actually broke.
	allHealthy := true
	for _, c := range cores {
		if c.Provisioned != nil && !*c.Provisioned {
			continue
		}
		if !c.Running {
			allHealthy = false
			break
		}
	}
	// The chain process, when this node holds one. Its own field rather than an
	// entry in `cores`: CoreStatus.Name is a ProtocolName and the chain is not
	// a protocol.
	var chainStatus *dto.ChainStatusDto
	if s.cfg.Chain != nil {
		// Its ports come with it, inside its own block. They were briefly
		// appended to a core's list, which read as "xray holds 26000" about a
		// port the chain holds, and made the answer depend on which cores the
		// node happens to run.
		chainStatus = s.cfg.Chain.Status()
	}

	status := "ok"
	if !allHealthy {
		status = "degraded"
	}
	// A chain this node was TOLD to run and is not running degrades it, for the
	// same reason a configured core does: something the panel asked for is not
	// happening. A node with no chain says nothing, and a panel must never read
	// that silence as a failure.
	if chainStatus != nil && !chainStatus.Running {
		status = "degraded"
	}
	// E37, 25.09 on nl-01: the stub resolver stopped answering, every xray host
	// on the node died, and every core still ran, so the node read ONLINE. A
	// machine that cannot resolve names cannot serve, whatever its cores say.
	reason := ""
	if resolverDown {
		status = "degraded"
		reason = dto.ResolverDownReason
	}
	writeJSON(w, http.StatusOK, dto.HealthcheckResponse{
		Status: status,
		Cores:  cores,
		Chain:  chainStatus,
		Arch:   core.MachineArch(),
		Geo:    s.geoStatus(),
		Reason: reason,
		// The cores the env declares, read now: a bootstrap run or a --remove
		// since the agent started shows on the next healthcheck (E42).
		DeclaredEngines: declaredEngines(s.cfg.EnvFile),
		ChainEngine:     s.chainEngine(),
	})
}

// chainEngine: the engine the chain process runs when this agent has one,
// which is every agent built with a chain manager. E46: such an agent ignores
// the legacy xray drawing as soon as a chain block reaches it (chainInForce in
// applyPush, and a failed Apply still holds the chain), so the panel must not
// accept a leg onto a node without that engine.
func (s *Server) chainEngine() dto.EngineName {
	if s.cfg.Chain == nil {
		return ""
	}
	return dto.EngineName(chain.Engine)
}

// resolverProbeTimeout: how long the host's resolver has to answer (E37).
const resolverProbeTimeout = 2 * time.Second

// probeNames are asked in turn; one answer is enough. Two operators' names, so
// a single domain's own trouble does not read as the node's.
var probeNames = []string{"www.google.com", "one.one.one.one"}

// SystemResolverProbe asks the host's own resolver, the one xray's `localhost`
// and every process without its own DNS use (/etc/resolv.conf, on a systemd
// host the stub at 127.0.0.53). Nil when any name resolves.
func SystemResolverProbe(ctx context.Context) error {
	var last error
	for _, name := range probeNames {
		_, err := net.DefaultResolver.LookupHost(ctx, name)
		if err == nil {
			return nil
		}
		last = err
		if ctx.Err() != nil {
			break
		}
	}
	return last
}

// geoStatus is the healthcheck's geo: the files on disk (sha256 from the
// store's size+mtime cache, not read every 30 seconds) and the version of the
// last push that carried geo. Nil only when this agent keeps no directory; a
// directory that cannot be read says so with no files rather than vanishing.
func (s *Server) geoStatus() *dto.GeoStatusDto {
	if s.cfg.Geo == nil {
		return nil
	}
	files, err := s.cfg.Geo.List()
	if err != nil {
		s.logger.Warn("geo: cannot list the directory for /healthz", "err", err)
		files = []dto.GeoFileDto{}
	}
	s.geoMu.Lock()
	v := s.geoVersion
	s.geoMu.Unlock()
	return &dto.GeoStatusDto{Version: v, Files: files}
}

// handleUfwPorts (G4 probe-exposure) reports the ufw-allowed inbound ports so
// the panel can flag anything open beyond the expected set (binding ports +
// SSH + the mTLS agent port). Read-only; inherits the server's mTLS gate like
// every other handler. ufw absent -> Managed=false so the panel skips.
func (s *Server) handleUfwPorts(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "GET only")
		return
	}
	allowed, err := firewall.ListAllowed(r.Context(), s.logger)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "UFW_QUERY_FAILED", err.Error())
		return
	}
	ports := make([]dto.UfwPortDto, 0, len(allowed))
	for _, p := range allowed {
		ports = append(ports, dto.UfwPortDto{Port: p.Port, Proto: p.Proto})
	}
	// allowed == nil only when ufw isn't installed -> Managed=false.
	writeJSON(w, http.StatusOK, dto.UfwPortsResponse{Managed: allowed != nil, Ports: ports})
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
		UserID:              req.UserID,
		ShortID:             req.ShortID,
		Username:            req.Username,
		HysteriaPassword:    req.Credentials.HysteriaPassword,
		XrayUUID:            req.Credentials.XrayUUID,
		NaivePassword:       req.Credentials.NaivePassword,
		AmneziaWGPublicKey:  req.Credentials.AmneziaWGPublicKey,
		AmneziaWGAllowedIP:  req.Credentials.AmneziaWGAllowedIP,
		AmneziaWGAllowedIP3: req.Credentials.AmneziaWGAllowedIP3,
		TuicUUID:            req.Credentials.TuicUUID,
		TuicPassword:        req.Credentials.TuicPassword,
		AnytlsPassword:      req.Credentials.AnytlsPassword,
		ShadowtlsPassword:   req.Credentials.ShadowtlsPassword,
	}

	// Best-effort fanout. A failure on a dormant adapter (no ApplyInbound
	// received yet, not Healthy()) is logged at WARN and ignored, adapters
	// cache users in memory regardless of started state, so a "not ready"
	// AddUser still lands in the cache and gets flushed on next ApplyInbound.
	// Only failures from already-Healthy() adapters propagate as 500, those
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
				s.logger.Warn("adapter addUser failed (dormant, ignored)", "core", adapter.Name(), "err", err)
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

	// Same best-effort semantics as handleAddUser, see comment there.
	var healthyFailed []string
	for _, adapter := range s.cfg.Adapters {
		isHealthy := adapter.Healthy()
		if err := adapter.RemoveUser(req.UserID); err != nil {
			if isHealthy {
				s.logger.Error("adapter removeUser failed", "core", adapter.Name(), "err", err)
				healthyFailed = append(healthyFailed, adapter.Name())
			} else {
				s.logger.Warn("adapter removeUser failed (dormant, ignored)", "core", adapter.Name(), "err", err)
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
// up. Slice 24 v1, minimal version: persists + logs, no per-protocol live
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

	// Geo files first, and before the push is even written down: a push whose
	// lists are not all here is not a fact about this node yet. Applying it
	// would hand xray an `ext:` it cannot open, or, for the built-in names,
	// let it quietly read the copy its installer left in /usr/local/share/xray
	// (common/platform/others.go:19-24). The panel lays the files out and
	// pushes again.
	if req.Geo != nil {
		if s.cfg.Geo == nil {
			writeError(w, http.StatusConflict, "GEO_UNSUPPORTED", "this agent keeps no geo directory")
			return
		}
		missing, err := s.cfg.Geo.Missing(req.Geo.Files)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "ASSETS_READ_FAILED", err.Error())
			return
		}
		if len(missing) > 0 {
			writeJSON(w, http.StatusConflict, dto.GeoMissingResponse{
				Error:   "GEO_MISSING",
				Message: fmt.Sprintf("geo files not here with the expected sha256: %s", strings.Join(missing, ", ")),
				Files:   missing,
			})
			return
		}
	}

	if s.cfg.InboundsStorePath != "" {
		// The WHOLE push, not only the inbounds: this file is what a restart
		// restores from, and inbounds without the node-level policy and
		// resolver would come back as a node quietly running other routing
		// than the operator saved.
		if err := writePushStore(s.cfg.InboundsStorePath, req); err != nil {
			s.logger.Error("persist inbounds failed", "err", err, "path", s.cfg.InboundsStorePath)
			writeError(w, http.StatusInternalServerError, "PERSIST_FAILED", err.Error())
			return
		}
	}

	applied, failed, reasons := s.applyPush(r.Context(), req)
	if failed > 0 {
		writeError(w, http.StatusInternalServerError, "ADAPTER_FAILED",
			fmt.Sprintf("%d/%d inbounds failed to apply: %s",
				failed, len(req.Inbounds), strings.Join(reasons, "; ")))
		return
	}
	writeJSON(w, http.StatusOK, dto.ApplyInboundsResponse{
		OK:      true,
		Applied: applied,
		Skipped: len(req.Inbounds) - applied,
	})
}

/*
applyPush hands one push to the adapters: the node-level blocks first, then the
inbounds, then the reconcile pass.

Split out of the handler because the agent must be able to do this to ITSELF on
boot, from the copy on disk, with the panel saying nothing. One body for both,
so a restart cannot apply a push in a different order or skip a step the live
path takes. See restoreFromStore.
*/
func (s *Server) applyPush(
	ctx context.Context,
	req dto.ApplyInboundsRequest,
) (applied int, failed int, reasons []string) {
	// The geo files this push stands on, noted before anything renders, so a
	// restart the push causes anyway picks them up and FlushGeo below has
	// nothing left to do. Absent geo leaves every adapter where it was.
	if req.Geo != nil {
		fp := geoFingerprint(req.Geo, "xray")
		for _, adapter := range s.cfg.Adapters {
			if gr, ok := adapter.(core.GeoReceiver); ok {
				gr.NoteGeo(fp)
			}
		}
	}

	// The node-level policy goes out BEFORE the inbounds, so the render that
	// each inbound triggers already carries it. The other order would restart
	// the core twice for one push: once without the policy, once with it.
	//
	// A failure here is not fatal to the request. The inbounds below are what
	// keeps users connected; refusing the whole push over a policy the operator
	// can fix in the panel would take the node dark for a routing preference.
	for _, adapter := range s.cfg.Adapters {
		pr, ok := adapter.(core.PolicyReceiver)
		if !ok {
			continue
		}
		if err := pr.ApplyPolicy(req.Policy); err != nil {
			s.logger.Error("adapter ApplyPolicy failed", "core", adapter.Name(), "err", err)
		}
	}

	// The resolver, same timing and the same reasoning as the policy above: a
	// node-level setting that the inbound renders have to already carry, and a
	// failure that must not take the node dark. Sent separately from the policy
	// so a policy this core cannot render does not also cost the operator the
	// resolver they changed in the same save.
	for _, adapter := range s.cfg.Adapters {
		dr, ok := adapter.(core.DnsReceiver)
		if !ok {
			continue
		}
		if err := dr.ApplyDns(req.Dns); err != nil {
			s.logger.Error("adapter ApplyDns failed", "core", adapter.Name(), "err", err)
		}
	}

	// The cascade, before the inbounds for the same reason as the two above, and
	// unlike them NOT broadcast: the request names the node's router in `engine`
	// and only that adapter is told. Two cores drawing the same chain would
	// fight over the link port.
	//
	// Every other CascadeReceiver is called with nil. That is not a wasted call:
	// it is what says "this push carried no node-level cascade", which is how an
	// adapter knows to keep reading the transitional copy on the inbound, and
	// how it stops ignoring that copy after the panel is rolled back.
	// The chain as its own process, BEFORE the cascade fragments, because
	// whether it took is what decides who draws the chain on this node.
	//
	// ⚠ For one transitional release the panel sends BOTH blocks, so that an
	// agent too old to know this field keeps working off `cascade`. An agent
	// that knows it must therefore IGNORE the fragments: two processes drawing
	// one chain fight over the link port, and the loser's users go nowhere.
	chainInForce := false
	if s.cfg.Chain != nil {
		if err := s.cfg.Chain.Apply(ctx, req.Chain); err != nil {
			// Not fatal to the push: the inbounds below are what keeps users
			// connected, and a chain that will not start is a reason to report,
			// not a reason to take the node dark. It travels back as a failure
			// reason and stands in the healthcheck as chain.error.
			s.logger.Error("chain block failed to apply", "err", err)
			failed++
			reasons = append(reasons, fmt.Sprintf("chain: %s", err.Error()))
		}
		chainInForce = s.cfg.Chain.Active()
	} else if req.Chain != nil {
		// Loud, and counted: the panel believes this node draws a chain in its
		// own process, and nothing here does.
		s.logger.Error("applyInbounds: a chain block arrived but this agent runs no chain manager")
		failed++
		reasons = append(reasons, "chain: this agent cannot run a chain process")
	}

	var cascadeFragments json.RawMessage
	router := ""
	// Set when the userCore block is malformed. Then NO adapter is told about a
	// cascade in this push, not even "nil": nil means "you are no longer an
	// entry", and a hysteria entry told that renders with no outbounds, which
	// sends its users straight out of the entry country. Refusing leaves every
	// core on whatever it last applied, and the refusal travels back as a reason.
	userCoreRefused := false
	if chainInForce {
		// The chain block brings its own drawing for the user's core: the same
		// fragments with a loopback socks outbound where each leg used to be.
		// The `cascade` block is the OLD drawing, kept on the wire for agents
		// that cannot see `chain` at all, and applying it here would put two
		// processes on one chain.
		if req.Cascade != nil {
			s.cfg.Chain.NoteCascadeIgnored()
		}
		if req.Chain != nil && req.Chain.UserCore != nil {
			// One shape per engine since phase 6: xray gets its fragments, a
			// hysteria entry gets the socks hand-off. A block whose halves do not
			// match its engine is refused OUT LOUD and delivered to nobody: handed
			// on as "nothing", a hysteria entry would render with no outbounds and
			// send every user out of the entry country with a working connection.
			payload, err := req.Chain.UserCore.Payload()
			if err != nil {
				s.logger.Error("applyInbounds: chain userCore refused, every core keeps what it had", "err", err)
				failed++
				reasons = append(reasons, err.Error())
				userCoreRefused = true
			} else {
				cascadeFragments = payload
				router = string(req.Chain.UserCore.Engine)
			}
		}
	} else if req.Cascade != nil {
		cascadeFragments = req.Cascade.Fragments
		router = string(req.Cascade.Engine)
	}
	deliveredCascade := false
	// The cores this push names: every one an inbound matches below, and the
	// one handed a non-empty cascade drawing here (xray on the exit of a legacy
	// cascade has no inbound and must keep running for the leg).
	named := make(map[core.CoreAdapter]bool, len(s.cfg.Adapters))
	for _, adapter := range s.cfg.Adapters {
		if userCoreRefused {
			break
		}
		cr, ok := adapter.(core.CascadeReceiver)
		if !ok {
			continue
		}
		// E47: first say whether the chain holds this node's cascade, so a nil
		// below reads as "no cascade here" and not as "take the copy on your
		// inbound", which would draw a leg's link-in on the chain's port.
		if ca, ok := adapter.(core.ChainAware); ok {
			ca.SetChainHolds(chainInForce)
		}
		var mine json.RawMessage
		if router != "" && adapter.Engine() == router {
			mine = cascadeFragments
			deliveredCascade = true
			if len(mine) > 0 && string(mine) != "null" {
				named[adapter] = true
			}
		}
		if err := cr.ApplyCascade(mine); err != nil {
			s.logger.Error("adapter ApplyCascade failed", "core", adapter.Name(), "err", err)
		}
	}
	// Loud, because the quiet version of this is the worst outcome the cascade
	// has: a chain nobody drew is a user egressing from the ENTRY country while
	// their client shows the exit. Same fail-closed rule as a router that dies.
	// Asked about what there WAS to deliver, not about which block it came in.
	// Under handover the fragments are the chain's, and a transit or an exit
	// has none at all: there the cores are meant to receive nil, and shouting
	// about it would teach an operator to ignore the one line that matters.
	if router != "" && !deliveredCascade {
		s.logger.Error("applyInbounds: no core on this node draws the cascade, the chain is NOT applied",
			"engine", router)
	}

	// Which core each inbound goes to, settled before any of them is applied,
	// so the cores this push does not name are known up front.
	matchedBy := make([]core.CoreAdapter, len(req.Inbounds))
	for i, ib := range req.Inbounds {
		if m := s.adapterFor(ib); m != nil {
			matchedBy[i] = m
			named[m] = true
		}
	}

	// And those stop serving BEFORE the named ones start, because they may hold
	// the very port a named inbound is about to take. E34, 25.09 on nl-01: a
	// hysteria with no inbound sat on 443/udp, the push's AWG inbound on 443/udp
	// failed "Address already in use", and hysteria was idled only after that,
	// so the node needed a second push to come up. Two cores asking for one port
	// in the SAME push is the panel's refusal to make, not this ordering's.
	//
	// Not after a chain or userCore refusal: those are the push being refused in
	// part, which is not a fact about what should run here, and stopping a core
	// on it would turn one bad block into an outage of another core. An inbound
	// that fails below no longer holds the idle back: the push named what it
	// named whether or not that inbound then applies, and the core it names is
	// named, so a failure cannot idle it.
	if failed == 0 {
		s.idleUnnamed(ctx, named)
	}

	// Dispatch each inbound to the matching adapter by protocol name. Adapters
	// that don't recognise the protocol return nil (defensive no-op contract).
	// Slice 24b: Xray has a real reconfig impl; the others are stubs that
	// log and rely on the persisted inbounds.json for next-restart pickup.
	// Why each one failed, in the core's own words, to travel back in the
	// response. Until now these lived only in this process's journal: the panel
	// was told "1/3 failed" and could not say which inbound or why, so the
	// operator's only route to the reason was ssh. The core names the offending
	// field, and that sentence is the whole value of the refusal.
	//
	// Capped at the first three: a node with forty inbounds and a broken shared
	// profile would otherwise answer with a wall of the same sentence.
	for i, ib := range req.Inbounds {
		s.logger.Info("applyInbounds received",
			"id", ib.ID, "name", ib.Name, "protocol", ib.Protocol, "port", ib.Port)

		matched := matchedBy[i]
		if matched == nil {
			s.logger.Warn("applyInbounds: no adapter for protocol/engine, config persisted but not applied live",
				"protocol", ib.Protocol, "engine", ib.ResolvedEngine())
			continue
		}
		if err := matched.ApplyInbound(ib.Port, ib.Config); err != nil {
			s.logger.Error("adapter ApplyInbound failed",
				"core", matched.Name(), "inboundId", ib.ID, "err", err)
			failed++
			if len(reasons) < 3 {
				// The name, not the id: the operator reads this in the panel,
				// where an inbound is a name and the uuid means nothing.
				reasons = append(reasons, fmt.Sprintf("%s (%s): %v", ib.Name, ib.Protocol, err))
			}
			continue
		}
		// Open UFW for the inbound's port. Extracted into ensureInboundFirewall
		// so the exact same logic also runs on boot (ensureFirewallFromStore),
		// not only when a push lands.
		s.ensureInboundFirewall(ctx, ib)
		// And for the cascade inter-hop link port (buried in the xray cascade
		// fragment, not a top-level inbound, so ensureInboundFirewall misses it).
		s.ensureCascadeFirewall(ctx, ib)
		applied++
	}

	// Reconcile: the push above is per-inbound, so an adapter holding several
	// has no way to notice a DELETION. Hand each one the full set that just
	// arrived for it, and let it drop the rest. Runs even when the list is
	// empty for an adapter - that is exactly the "last inbound removed" case,
	// and skipping it would leave a deleted inbound serving forever.
	keepByProtocol := make(map[string][]string, len(req.Inbounds))
	for _, ib := range req.Inbounds {
		key := string(ib.Protocol) + "|" + string(ib.ResolvedEngine())
		keepByProtocol[key] = append(keepByProtocol[key], ib.ID)
	}
	for _, adapter := range s.cfg.Adapters {
		rec, ok := adapter.(core.InboundReconciler)
		if !ok {
			continue
		}
		key := adapter.Name() + "|" + adapter.Engine()
		if err := rec.RetainInbounds(keepByProtocol[key]); err != nil {
			// Not fatal for the request: the inbounds that DID apply are live,
			// and reporting this as a total failure would make the panel retry
			// a push that already half-landed.
			s.logger.Error("adapter RetainInbounds failed", "core", adapter.Name(), "err", err)
		}
	}

	if req.Geo != nil {
		s.settleGeo(ctx, req.Geo, failed == 0)
	}

	return applied, failed, reasons
}

// settleGeo finishes a push that carried geo: a core still running on files
// the push replaced restarts, and, when the push applied whole, the files it
// did not name leave the directory (a push refused in part is not a fact
// about what this node needs).
func (s *Server) settleGeo(ctx context.Context, g *dto.NodeGeo, whole bool) {
	for _, adapter := range s.cfg.Adapters {
		if gr, ok := adapter.(core.GeoReceiver); ok {
			if err := gr.FlushGeo(ctx); err != nil {
				s.logger.Error("adapter FlushGeo failed", "core", adapter.Name(), "err", err)
			}
		}
	}
	if !whole || s.cfg.Geo == nil {
		return
	}
	names := make([]string, 0, len(g.Files))
	for _, f := range g.Files {
		names = append(names, f.Name)
	}
	if err := s.cfg.Geo.Retain(names); err != nil {
		s.logger.Error("geo: removing files the push no longer names failed", "err", err)
	}
	v := g.Version
	s.geoMu.Lock()
	s.geoVersion = &v
	s.geoMu.Unlock()
}

// adapterFor is the core an inbound goes to, nil when this node has none.
// Engine-choice: routed by the (protocol, engine) pair, not protocol alone. An
// inbound that pins engine=singbox for a shared protocol (vless/vmess/trojan/
// ss/hy2) lands on the sing-box adapter instead of the native core. Empty
// engine resolves to the protocol's native core, so pre-engine-choice inbounds
// keep matching their original adapter.
func (s *Server) adapterFor(ib dto.InboundDto) core.CoreAdapter {
	wantEngine := ib.ResolvedEngine()
	for _, adapter := range s.cfg.Adapters {
		// A stand-in for a core that is not installed is reported, never
		// matched: its inbound takes the "no adapter" path, as it did when the
		// stand-in did not exist.
		if core.IsAbsent(adapter) {
			continue
		}
		if adapter.Name() == string(ib.Protocol) && adapter.Engine() == string(wantEngine) {
			return adapter
		}
	}
	return nil
}

// idleUnnamed stops every registered core the applied push did not name and
// remembers which, for /healthz. A stand-in for a core that is not installed
// is skipped: it runs nothing and reports its own state.
func (s *Server) idleUnnamed(ctx context.Context, named map[core.CoreAdapter]bool) {
	idle := make(map[core.CoreAdapter]bool, len(s.cfg.Adapters))
	for _, adapter := range s.cfg.Adapters {
		if named[adapter] || core.IsAbsent(adapter) {
			continue
		}
		idle[adapter] = true
		if id, ok := adapter.(core.Idler); ok {
			if err := id.Idle(ctx); err != nil {
				s.logger.Error("adapter Idle failed", "core", adapter.Name(), "engine", adapter.Engine(), "err", err)
			}
		}
	}
	s.idleMu.Lock()
	s.idle = idle
	s.idleMu.Unlock()
}

// isIdle: the last applied push did not name this core.
func (s *Server) isIdle(adapter core.CoreAdapter) bool {
	s.idleMu.Lock()
	defer s.idleMu.Unlock()
	return s.idle[adapter]
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

// ensureCascadeFirewall opens UFW for the inter-hop cascade link port carried in
// an xray inbound's cascade fragment. The link-in inbound listens on a high port
// (LINK_PORT_BASE+i) that install-time rules and ensureInboundFirewall don't know
// about - it lives inside the cascade fragment, not as a top-level inbound - so
// without this the previous hop's dial is silently dropped at the firewall and
// the cascade never forwards (the manual `ufw allow from <entry-ip> ...` step).
// Restricted to the peer hop's address (resolved to IP inside firewall.AllowFrom,
// fail-open if it can't be pinned). No-op for plain inbounds and non-xray cores.
func (s *Server) ensureCascadeFirewall(ctx context.Context, ib dto.InboundDto) {
	if ib.Protocol != dto.ProtocolXray || len(ib.Config) == 0 {
		return
	}
	var cfg struct {
		Cascade *struct {
			LinkIngressPort int      `json:"linkIngressPort"`
			LinkAllowFrom   []string `json:"linkAllowFrom"`
		} `json:"cascade"`
	}
	if err := json.Unmarshal(ib.Config, &cfg); err != nil {
		return
	}
	if cfg.Cascade == nil || cfg.Cascade.LinkIngressPort == 0 {
		return
	}
	// The vless link rides TCP; the ss2022 link cell is tcp+udp. Open both so
	// either cell works - both stay restricted to the peer source.
	for _, proto := range []string{"tcp", "udp"} {
		firewall.AllowFrom(ctx, s.logger, cfg.Cascade.LinkIngressPort, proto, cfg.Cascade.LinkAllowFrom)
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
	req, err := readPushStore(s.cfg.InboundsStorePath)
	if err != nil {
		if !os.IsNotExist(err) {
			s.logger.Warn("ensureFirewallFromStore: cannot parse persisted inbounds", "err", err)
		}
		return // no persisted inbounds yet
	}
	inbounds := req.Inbounds
	for _, ib := range inbounds {
		s.ensureInboundFirewall(ctx, ib)
		s.ensureCascadeFirewall(ctx, ib)
	}
	if len(inbounds) > 0 {
		s.logger.Info("ensureFirewallFromStore: re-ensured firewall for persisted inbounds", "count", len(inbounds))
	}
}

/*
restoreFromStore brings the cores back up from the last push, without the panel.

THE INCIDENT, 2026-09-22. Four agents were restarted. The old process stopped
xray cleanly; the new one logged "no REALITY key yet, waiting for ApplyInbound
from panel" (adapter.go, Start) and sat there, because an adapter's idea of what
it serves lives in memory and a new process has none. Two of the four were
cascade entries whose push the panel could not build at all, so nothing ever
came: `pgrep xray` stayed empty for over an hour while a config that had been
valid a second earlier sat on disk, unread.

The config on disk is the panel's own last word, written atomically when it
landed. A node that has it needs nobody's permission to come back up.

Deliberately the same body as a live push (applyPush), not a private shortcut:
a restore that applied things in a different order, or skipped the reconcile,
would be a second way for a node to be configured, and the whole point is that
there is one.

Best-effort throughout. A missing store is a fresh node with nothing to restore.
A push that fails here is logged and the agent carries on: refusing to start
because one inbound cannot be applied would turn a partial outage into a total
one, and the panel's next push is still coming.
*/
func (s *Server) restoreFromStore(ctx context.Context) {
	if s.cfg.InboundsStorePath == "" {
		return
	}
	req, err := readPushStore(s.cfg.InboundsStorePath)
	if err != nil {
		if !os.IsNotExist(err) {
			s.logger.Warn("restore from disk: cannot read the last push",
				"err", err, "path", s.cfg.InboundsStorePath)
		}
		return
	}
	if len(req.Inbounds) == 0 {
		return
	}
	// The files were checked when this push landed; a file gone since is said
	// out loud and the push still restored, because the alternative is a node
	// that stays dark until the panel speaks.
	if req.Geo != nil && s.cfg.Geo != nil {
		if missing, err := s.cfg.Geo.Missing(req.Geo.Files); err == nil && len(missing) > 0 {
			s.logger.Error("restore from disk: geo files of the last push are gone or changed", "files", missing)
		}
	}

	applied, failed, reasons := s.applyPush(ctx, req)
	if failed > 0 {
		s.logger.Error("restored from disk with failures",
			"applied", applied, "failed", failed,
			"total", len(req.Inbounds), "reasons", strings.Join(reasons, "; "))
		return
	}
	s.logger.Info("restored from disk",
		"applied", applied, "total", len(req.Inbounds), "path", s.cfg.InboundsStorePath)
}

// writeInboundsAtomically marshals the inbound set and delegates to the
// shared atomicfile helper (fsync(file)+fsync(dir) for power-loss durability).
// Mode 0600 because the configs may embed REALITY private keys / WireGuard
// server keys.
//
// Previously had a bespoke tmp+rename without fsync, bypassed the Wave-4
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
					// Tag each user with the producing adapter's counter mode so the
					// panel treats cumulative-core (xray/singbox) and delta-core
					// (awg/hysteria/ss) users correctly on a mixed node.
					Cumulative: stats.Cumulative,
					// And with its protocol, the inbound the user came through: the
					// panel decides per entry whether bytes or presence count.
					Protocol: adapter.Name(),
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
		// #5 - response-level flag stays as the OR across cores so older panels
		// still enter the snapshot-delta path. New panels read the per-user
		// dto.UserStats.Cumulative set above, which is what makes a mixed
		// cumulative+delta node bill each user correctly.
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

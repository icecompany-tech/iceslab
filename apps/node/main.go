package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/icecompany-tech/iceslab/apps/node/internal/core"
	"github.com/icecompany-tech/iceslab/apps/node/internal/core/amneziawg"
	"github.com/icecompany-tech/iceslab/apps/node/internal/core/hysteria"
	"github.com/icecompany-tech/iceslab/apps/node/internal/core/mieru"
	"github.com/icecompany-tech/iceslab/apps/node/internal/core/mtproto"
	"github.com/icecompany-tech/iceslab/apps/node/internal/core/naive"
	"github.com/icecompany-tech/iceslab/apps/node/internal/core/shadowsocks"
	"github.com/icecompany-tech/iceslab/apps/node/internal/core/singbox"
	"github.com/icecompany-tech/iceslab/apps/node/internal/core/xray"
	"github.com/icecompany-tech/iceslab/apps/node/internal/heartbeat"
	"github.com/icecompany-tech/iceslab/apps/node/internal/payload"
	"github.com/icecompany-tech/iceslab/apps/node/internal/server"
)

const (
	defaultPort                = "1337"
	defaultHost                = "0.0.0.0"
	defaultAuthCallbackPort    = 9000
	defaultXrayPort            = 443
	defaultXrayConfigPath      = "/etc/xray/config.json"
	defaultXrayRealityDest     = "www.cloudflare.com:443"
	defaultXrayRealitySNI      = "www.cloudflare.com"
	defaultInboundsStorePath   = "/etc/iceslab-node/inbounds.json"
	adapterStopShutdownTimeout = 10 * time.Second
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	payloadEnv := os.Getenv("NODE_PAYLOAD")
	if payloadEnv == "" {
		logger.Error("NODE_PAYLOAD env is required")
		os.Exit(1)
	}

	pld, err := payload.Decode(payloadEnv)
	if err != nil {
		logger.Error("decode payload", "err", err)
		os.Exit(1)
	}

	adapters := buildAdapters(logger)

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	// Start every adapter before the HTTPS server — we want auth callbacks
	// listening before any addUser request can arrive.
	for _, a := range adapters {
		if err := a.Start(ctx); err != nil {
			logger.Error("start adapter", "name", a.Name(), "err", err)
			stopAdapters(adapters, logger)
			os.Exit(1)
		}
	}

	srv, err := server.New(server.Config{
		Host:              getenv("NODE_HOST", defaultHost),
		Port:              getenv("NODE_PORT", defaultPort),
		Payload:           pld,
		Logger:            logger,
		Adapters:          adapters,
		InboundsStorePath: getenv("NODE_INBOUNDS_STORE", defaultInboundsStorePath),
	})
	if err != nil {
		logger.Error("build server", "err", err)
		stopAdapters(adapters, logger)
		os.Exit(1)
	}

	// Slice 38 — heartbeat self-destruct. Runs in the background, polls
	// the panel for "you are still wanted." On 410 Gone (3 in a row) it
	// cancels the root context, which makes srv.Run return; the rest of
	// shutdown happens via the existing stopAdapters path below. After
	// stopAdapters we exit with code 42, which the systemd unit treats
	// as "do not restart." Any other path falls through to a normal exit.
	// Slice 38 follow-up — process-start identifier. Sent in every heartbeat
	// so the panel can detect agent restart and re-issue applyInbounds +
	// addUser fan-out. Unix-nano is per-host monotonic and unique enough;
	// the panel side only byte-compares.
	agentStartTime := strconv.FormatInt(time.Now().UnixNano(), 10)

	selfDestruct := false
	if os.Getenv("ICESLAB_NODE_DISABLE_HEARTBEAT") != "1" {
		go heartbeat.Run(ctx, heartbeat.Config{
			PanelURL:       pld.PanelURL,
			HeartbeatToken: pld.HeartbeatToken,
			CACertPem:      pld.CACertPem,
			AgentStartTime: agentStartTime,
			OnGone: func(reason string) {
				logger.Warn("heartbeat triggered self-destruct — initiating shutdown", "reason", reason)
				selfDestruct = true
				cancel()
			},
		}, logger)
	} else {
		logger.Info("heartbeat: disabled via ICESLAB_NODE_DISABLE_HEARTBEAT=1")
	}

	if err := srv.Run(ctx); err != nil {
		logger.Error("server exited with error", "err", err)
	}

	stopAdapters(adapters, logger)

	if selfDestruct {
		logger.Warn("self-destruct complete — exiting with code 42 (systemd will not restart)")
		os.Exit(42)
	}
}

func buildAdapters(logger *slog.Logger) []core.CoreAdapter {
	adapters := []core.CoreAdapter{
		hysteria.New(hysteria.Config{
			AuthCallbackHost:   getenv("HYSTERIA_AUTH_HOST", "127.0.0.1"),
			AuthCallbackPort:   getenvInt("HYSTERIA_AUTH_PORT", defaultAuthCallbackPort),
			BinaryPath:         os.Getenv("HYSTERIA_BINARY"),
			ConfigPath:         os.Getenv("HYSTERIA_CONFIG"),
			Hostname:           os.Getenv("HYSTERIA_HOSTNAME"),
			ACMEEmail:          os.Getenv("HYSTERIA_ACME_EMAIL"),
			ListenPort:         getenvInt("HYSTERIA_LISTEN_PORT", 443),
			ServiceUnit:        os.Getenv("HYSTERIA_SERVICE_UNIT"),
			TrafficStatsListen: getenv("HYSTERIA_STATS_LISTEN", "127.0.0.1:9999"),
			TrafficStatsSecret: os.Getenv("HYSTERIA_STATS_SECRET"),
		}, logger),
	}

	// Xray adapter is always registered when XRAY_BINARY is set so that
	// ApplyInbound (panel push) can configure REALITY keys at runtime without
	// requiring them to be baked into the env file at install time.
	// If XRAY_REALITY_PRIVATE_KEY is already in env, the adapter pre-seeds its
	// config and starts xray immediately on boot.
	if os.Getenv("XRAY_BINARY") != "" {
		cfg, _ := buildXrayConfig()
		// buildXrayConfig returns zero Config when REALITY keys are not in env
		// (deferred-key flow). Still need BinaryPath so the adapter can spawn
		// xray after receiving ApplyInbound from the panel.
		if cfg.BinaryPath == "" {
			cfg.BinaryPath = os.Getenv("XRAY_BINARY")
			cfg.ConfigPath = getenv("XRAY_CONFIG", defaultXrayConfigPath)
			cfg.Inbound.ApiPort = getenvInt("XRAY_API_PORT", 8080)
		}
		adapters = append(adapters, xray.New(cfg, logger))
		logger.Info("xray adapter registered")
	}

	// Slice 24d — Shadowsocks shares the xray binary. We register the SS
	// adapter whenever XRAY_BINARY is set; the panel decides whether the
	// node actually has an SS inbound by either sending an ApplyInbound or
	// not. Adapter starts in deferred-method mode (no Method set) until the
	// first ApplyInbound flips it on.
	if os.Getenv("XRAY_BINARY") != "" {
		ssCfg := shadowsocks.Config{
			BinaryPath: os.Getenv("XRAY_BINARY"),
			ConfigPath: getenv("SHADOWSOCKS_CONFIG", "/etc/xray/shadowsocks.json"),
			Inbound: shadowsocks.InboundConfig{
				ListenPort: getenvInt("SHADOWSOCKS_PORT", 8388),
				ApiPort:    getenvInt("SHADOWSOCKS_API_PORT", 8081),
				Method:     os.Getenv("SHADOWSOCKS_METHOD"), // empty → deferred until ApplyInbound
			},
		}
		adapters = append(adapters, shadowsocks.New(ssCfg, logger))
		logger.Info("shadowsocks adapter registered")
	}

	// Slice 41 — MTProto via 9seconds/mtg. Adapter waits for the panel to
	// push a Domain via ApplyInbound; until then it sits inert.
	if os.Getenv("MTG_BINARY") != "" {
		mtgCfg := mtproto.Config{
			BinaryPath: os.Getenv("MTG_BINARY"),
			ConfigPath: getenv("MTG_CONFIG", "/etc/mtg/config.toml"),
			Inbound: mtproto.InboundConfig{
				ListenPort: getenvInt("MTG_PORT", 443),
				StatsPort:  getenvInt("MTG_STATS_PORT", 3129),
				Domain:     os.Getenv("MTG_DOMAIN"), // empty → deferred until ApplyInbound
			},
		}
		adapters = append(adapters, mtproto.New(mtgCfg, logger))
		logger.Info("mtproto adapter registered")
	}

	// Slice 40 — Mieru via enfein/mieru's `mita` server.
	if os.Getenv("MITA_BINARY") != "" {
		mieruCfg := mieru.Config{
			BinaryPath: os.Getenv("MITA_BINARY"),
			// mita reads JSON via `mita apply config <path.json>` (it then
			// stores its own protobuf-encoded copy at /etc/mita/server.conf.pb).
			ConfigPath: getenv("MITA_CONFIG", "/etc/mita/server.json"),
			Inbound: mieru.InboundConfig{
				ListenPort:   getenvInt("MITA_PORT", 2012),
				MTU:          getenvInt("MITA_MTU", 1400),
				LoggingLevel: getenv("MITA_LOG_LEVEL", "INFO"),
			},
		}
		adapters = append(adapters, mieru.New(mieruCfg, logger))
		logger.Info("mieru adapter registered")
	}

	// Slice 19 — AmneziaWG (DPI-resistant WireGuard fork). Registered
	// unconditionally when the `amneziawg` CLI exists on $PATH — that's
	// our "is this an AWG-capable node" probe. bootstrap-amneziawg.sh
	// (called by install-iceslab-node.sh when --protocol amneziawg) installs the
	// kernel module via DKMS and builds awg / awg-quick into /usr/bin.
	// On non-AWG nodes the binary is absent and we skip registration
	// (config-only mode would be useless without the CLI).
	//
	// Caught live cycle #6 reality-check 2026-05-12: adapter code shipped
	// with slice 19 but was never wired into the registry, so applyInbound
	// for amneziawg landed with `no adapter for protocol — config persisted
	// but not applied live`. Hence the explicit registration here.
	awgBinPath := getenv("AMNEZIAWG_BIN", "/usr/bin/awg")
	awgQuickBinPath := getenv("AMNEZIAWG_QUICK_BIN", "/usr/bin/awg-quick")
	if _, err := os.Stat(awgBinPath); err == nil {
		awgCfg := amneziawg.Config{
			AwgBin:       awgBinPath,
			AwgQuickBin:  awgQuickBinPath,
			SystemctlBin: getenv("SYSTEMCTL_BIN", "/usr/bin/systemctl"),
			Inbound: amneziawg.InboundConfig{
				Interface: getenv("AMNEZIAWG_INTERFACE", "awg0"),
			},
		}
		adapters = append(adapters, amneziawg.New(awgCfg, logger))
		logger.Info("amneziawg adapter registered", "bin", awgBinPath)
	}

	// Slice 20 — NaiveProxy via Caddy + klzgrad/forwardproxy@naive plugin.
	// bootstrap-naive.sh builds a custom Caddy at /usr/local/bin/caddy-naive
	// (the upstream `caddy` package would lack the forward_proxy module).
	// Register unconditionally when that binary exists — that's our
	// "naive-capable node" probe, same pattern as amneziawg.
	//
	// Caught live cycle #8 reality-check 2026-05-13: adapter code shipped
	// with slice 20 but was never wired into the registry, so applyInbound
	// for naive landed with `no adapter for protocol — config persisted
	// but not applied live`. Hence the explicit registration here.
	caddyBinPath := getenv("CADDY_NAIVE_BIN", "/usr/local/bin/caddy-naive")
	if _, err := os.Stat(caddyBinPath); err == nil {
		naiveCfg := naive.Config{
			CaddyBin:      caddyBinPath,
			CaddyfilePath: getenv("NAIVE_CONFIG", "/etc/caddy/Caddyfile"),
			Inbound: naive.InboundConfig{
				ListenPort: getenvInt("NAIVE_PORT", 443),
			},
		}
		adapters = append(adapters, naive.New(naiveCfg, logger))
		logger.Info("naive adapter registered", "bin", caddyBinPath)
	}

	// sing-box engine — first protocol TUIC (slice singbox-S1). Registered when
	// SINGBOX_BINARY is set; bootstrap-singbox.sh installs the binary plus a
	// self-signed TLS cert (TUIC requires TLS). Inert until the panel pushes a
	// tuic inbound via ApplyInbound.
	if os.Getenv("SINGBOX_BINARY") != "" {
		singboxBin := os.Getenv("SINGBOX_BINARY")
		// Stats client: a dedicated SINGBOX_STATS_BIN wins, else reuse XRAY_BINARY
		// when the node also runs xray. Empty -> zero counters (graceful).
		singboxStatsBin := getenv("SINGBOX_STATS_BIN", os.Getenv("XRAY_BINARY"))

		// One sing-box engine, one adapter per protocol. On a node only the
		// protocol whose inbound the panel pushes actually spawns sing-box;
		// the other stays inert. Distinct config path + stats port so they
		// never collide if both ever run on one host.
		adapters = append(adapters, singbox.New(singbox.Config{
			Protocol:     "tuic",
			BinaryPath:   singboxBin,
			ConfigPath:   getenv("SINGBOX_CONFIG", "/etc/sing-box/config.json"),
			CertPath:     getenv("SINGBOX_CERT", "/etc/sing-box/cert.pem"),
			KeyPath:      getenv("SINGBOX_KEY", "/etc/sing-box/key.pem"),
			StatsListen:  getenv("SINGBOX_API_LISTEN", "127.0.0.1:8082"),
			XrayStatsBin: singboxStatsBin,
		}, logger))
		logger.Info("singbox (tuic) adapter registered")

		adapters = append(adapters, singbox.New(singbox.Config{
			Protocol:     "anytls",
			BinaryPath:   singboxBin,
			ConfigPath:   getenv("SINGBOX_ANYTLS_CONFIG", "/etc/sing-box/anytls.json"),
			CertPath:     getenv("SINGBOX_CERT", "/etc/sing-box/cert.pem"),
			KeyPath:      getenv("SINGBOX_KEY", "/etc/sing-box/key.pem"),
			StatsListen:  getenv("SINGBOX_ANYTLS_API_LISTEN", "127.0.0.1:8083"),
			XrayStatsBin: singboxStatsBin,
		}, logger))
		logger.Info("singbox (anytls) adapter registered")

		// Engine-choice (EC2): vless/vmess/trojan via the sing-box engine. Inert
		// until the panel pushes an xray inbound pinned to engine=singbox. No
		// cert/key (REALITY carries its own key); distinct config + stats port.
		adapters = append(adapters, singbox.New(singbox.Config{
			Protocol:     "xray",
			BinaryPath:   singboxBin,
			ConfigPath:   getenv("SINGBOX_XRAY_CONFIG", "/etc/sing-box/xray.json"),
			StatsListen:  getenv("SINGBOX_XRAY_API_LISTEN", "127.0.0.1:8084"),
			XrayStatsBin: singboxStatsBin,
		}, logger))
		logger.Info("singbox (xray-family) adapter registered")

		// Engine-choice (EC4): hysteria2 via the sing-box engine. TLS is
		// mandatory; reuses the self-signed cert from bootstrap-singbox.sh (like
		// tuic). Per-user password = HysteriaPassword. Distinct config + stats port.
		adapters = append(adapters, singbox.New(singbox.Config{
			Protocol:     "hysteria",
			BinaryPath:   singboxBin,
			ConfigPath:   getenv("SINGBOX_HY2_CONFIG", "/etc/sing-box/hy2.json"),
			CertPath:     getenv("SINGBOX_CERT", "/etc/sing-box/cert.pem"),
			KeyPath:      getenv("SINGBOX_KEY", "/etc/sing-box/key.pem"),
			StatsListen:  getenv("SINGBOX_HY2_API_LISTEN", "127.0.0.1:8085"),
			XrayStatsBin: singboxStatsBin,
		}, logger))
		logger.Info("singbox (hysteria2) adapter registered")

		// Engine-choice (EC3): shadowsocks (SS2022) via the sing-box engine. No
		// TLS (SS has its own AEAD). Per-user uPSK is derived on the node from
		// xrayUuid (matches the xray SS adapter + the subscription URI). Distinct
		// config + stats port; no cert needed.
		adapters = append(adapters, singbox.New(singbox.Config{
			Protocol:     "shadowsocks",
			BinaryPath:   singboxBin,
			ConfigPath:   getenv("SINGBOX_SS_CONFIG", "/etc/sing-box/ss.json"),
			StatsListen:  getenv("SINGBOX_SS_API_LISTEN", "127.0.0.1:8086"),
			XrayStatsBin: singboxStatsBin,
		}, logger))
		logger.Info("singbox (shadowsocks) adapter registered")

		// ShadowTLS (sing-box): TLS-camouflage wrapper that detours to an inner
		// single-key shadowsocks. No cert/key (it fronts a real handshake to the
		// camouflage site). Distinct config + stats port.
		adapters = append(adapters, singbox.New(singbox.Config{
			Protocol:     "shadowtls",
			BinaryPath:   singboxBin,
			ConfigPath:   getenv("SINGBOX_SHADOWTLS_CONFIG", "/etc/sing-box/shadowtls.json"),
			StatsListen:  getenv("SINGBOX_SHADOWTLS_API_LISTEN", "127.0.0.1:8087"),
			XrayStatsBin: singboxStatsBin,
		}, logger))
		logger.Info("singbox (shadowtls) adapter registered")
	}

	return adapters
}

func buildXrayConfig() (xray.Config, bool) {
	privateKey := os.Getenv("XRAY_REALITY_PRIVATE_KEY")
	if privateKey == "" {
		return xray.Config{}, false
	}
	shortIDs := splitCSV(os.Getenv("XRAY_REALITY_SHORT_IDS"))
	serverNames := splitCSV(getenv("XRAY_REALITY_SERVER_NAMES", defaultXrayRealitySNI))

	return xray.Config{
		BinaryPath: os.Getenv("XRAY_BINARY"),
		ConfigPath: getenv("XRAY_CONFIG", defaultXrayConfigPath),
		Inbound: xray.InboundConfig{
			ListenPort:         getenvInt("XRAY_PORT", defaultXrayPort),
			ApiPort:            getenvInt("XRAY_API_PORT", 8080),
			RealityDest:        getenv("XRAY_REALITY_DEST", defaultXrayRealityDest),
			RealityServerNames: serverNames,
			RealityPrivateKey:  privateKey,
			RealityShortIDs:    shortIDs,
		},
	}, true
}

func splitCSV(s string) []string {
	if s == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if t := strings.TrimSpace(p); t != "" {
			out = append(out, t)
		}
	}
	return out
}

func stopAdapters(adapters []core.CoreAdapter, logger *slog.Logger) {
	stopCtx, cancel := context.WithTimeout(context.Background(), adapterStopShutdownTimeout)
	defer cancel()
	for _, a := range adapters {
		if err := a.Stop(stopCtx); err != nil {
			logger.Error("stop adapter", "name", a.Name(), "err", err)
		}
	}
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func getenvInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

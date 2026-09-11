package core

import (
	"context"
	"encoding/json"
	"time"
)

// CoreAdapter is the central abstraction of Iceslab: every proxy core wraps
// behind this interface, which lets the dispatcher treat them uniformly.
//
// Implementations live in `internal/core/<protocol>/` and are registered
// from main at startup based on which protocols the node is configured for.
//
// Contract notes:
//   - All methods are expected to be goroutine-safe.
//   - `AddUser` and `RemoveUser` MUST be idempotent, the panel may retry
//     a job after a partial failure, so re-applying the same operation is
//     a no-op.
//   - `Start` blocks only long enough to launch the underlying binary; it
//     does NOT wait for the binary to be ready to accept traffic. Use
//     `GetStats` polling or a healthcheck for readiness.
type CoreAdapter interface {
	// Name returns the protocol identifier (matches dto.ProtocolName).
	Name() string

	// Engine returns the proxy-core identifier this adapter renders with
	// ("xray", "hysteria", "singbox", ...). The dispatcher matches an inbound
	// to an adapter by BOTH Name()==protocol AND Engine()==resolved-engine, so
	// one protocol can be served by different cores (engine-choice). Native
	// adapters return their single core; the sing-box adapter returns "singbox".
	Engine() string

	// Start launches the underlying core (subprocess, in-process server, ...).
	// Returning nil means the launch was initiated; readiness is asynchronous.
	Start(ctx context.Context) error

	// Stop gracefully terminates the core. Implementations should respect a
	// shutdown deadline (~5s) and force-kill on timeout.
	Stop(ctx context.Context) error

	// AddUser registers a user with the core. Idempotent.
	AddUser(user User) error

	// RemoveUser unregisters a user by id. Idempotent.
	RemoveUser(userID string) error

	// GetStats returns the latest traffic counters known to the core.
	GetStats() (*Stats, error)

	// Healthy reports whether the adapter is in a state where it can serve
	// traffic. Implementations should return true after Start() has fully
	// initialised local resources (callback servers, subprocesses, etc) and
	// false before Start() / after Stop() / when a subprocess has crashed.
	//
	// Used by the panel's healthcheck fan-out and the node-agent /healthz
	// endpoint to derive overall node status.
	Healthy() bool

	// ApplyInbound takes the inbound port plus the protocol-specific config as
	// raw JSON (the latter is the same shape the panel pushes via
	// /applyInbounds, see dto.InboundDto.Config). Implementations parse what
	// they need, regenerate their config file, and reload/restart the
	// underlying server.
	//
	// Port was added (slice 50, 2026-05-20) because adapters used to read the
	// listen port from install-time config only. Admin couldn't change a
	// protocol's port through the panel UI: a port change in the binding
	// landed in the outer InboundDto.Port but the adapter never saw it, so
	// the rendered config (e.g. /etc/hysteria/config.yaml) kept the install-
	// time port forever. Now port is first-class on every applyInbound call.
	//
	// Contract:
	//   - Idempotent: re-applying the same (port, config) is a no-op (no restart).
	//   - Non-blocking on success: launches reload/restart asynchronously,
	//     returns once the new config is on disk.
	//   - Returns an error if the config JSON is malformed for this protocol
	//     or the regenerate/reload step fails.
	//   - When called with a config that doesn't match the adapter's protocol
	//     (e.g. xray cfg pushed to hysteria adapter), implementations should
	//     return nil, the dispatcher routes by protocol name, but defensive
	//     no-op is the safer contract.
	//
	// Slice 24b: replaces the env-var-only inbound config workflow that
	// admins had to hand-edit on every change. Panel auto-pushes via
	// /applyInbounds, dispatcher fans out to the matching adapter.
	ApplyInbound(port int, cfg json.RawMessage) error
}

// RestartStats is an adapter's running tally of core restarts, surfaced on
// /healthz and stored per node by the panel.
//
// Why this is reported at all (2026-08-04): the memory watchdog restarts a core
// before it eats the box, and a restart drops live connections. Without a
// visible counter that trade is invisible - the core quietly bounces, users
// complain about drops, and the panel shows a green node. The number is the
// feature as much as the restart is.
//
// Counters are cumulative since the ADAPTER started, not since the process
// started: a config push replaces the underlying process, and resetting the
// tally exactly when an operator is investigating would defeat the point. They
// do reset when the agent restarts; the panel tolerates a counter going
// backwards (it means "agent restarted", not "restarts un-happened").
type RestartStats struct {
	// Crash / Memory: restarts by cause. Memory means the watchdog acted
	// before an OOM; Crash means the process died on its own.
	Crash  int
	Memory int
	// LastAt is zero when nothing has restarted yet.
	LastAt     time.Time
	LastReason string
	// SinceAt is when this adapter started counting, i.e. when the agent came
	// up. Without it "3 restarts" is unreadable: it could mean this morning or
	// six months ago. Reported so the panel can say "3 since <date>".
	SinceAt time.Time
	// MemoryLimitBytes is the armed ceiling (0 = watchdog off), RSSBytes the
	// latest sample. Together they let the panel show how close a core runs
	// to the line instead of only counting the times it crossed it.
	MemoryLimitBytes uint64
	RSSBytes         uint64
}

// InboundReconciler is an OPTIONAL interface for adapters that hold SEVERAL
// inbounds at once. `applyInbounds` carries the panel's full set for this node,
// but it is dispatched to adapters one inbound at a time, so an adapter that
// accumulates them never learns that one was deleted.
//
// Without this, removing an inbound in the panel leaves it serving on the node
// forever: still listening, still accepting the users it knew about. Found in
// the field 2026-08-08, right after multi-inbound landed.
type InboundReconciler interface {
	// RetainInbounds drops every inbound whose id is not in `keep`, and
	// restarts the core if anything went away. `keep` is the complete set for
	// this adapter in the push that just landed. An EMPTY set means the node
	// has no inbounds of this kind any more, which is a legitimate state.
	RetainInbounds(keep []string) error
}

// PolicyReceiver is an OPTIONAL interface for adapters that can render the
// node-level routing policy (see dto.NodePolicy).
//
// Optional because the policy is one thing rendered by different engines: xray
// turns it into routing rules, AmneziaWG would turn it into iptables in PostUp,
// and an adapter that cannot express it at all should not pretend to. The raw
// bytes are passed through undecoded, the same way ApplyInbound takes the
// inbound config, so this package stays free of the wire shape.
//
// A nil or empty policy MUST render exactly as before. The panel ships the
// field ahead of generating any rules, and the first thing that proves the
// plumbing is a byte-identical config on the node.
type PolicyReceiver interface {
	ApplyPolicy(policy json.RawMessage) error
}

// DnsReceiver is an OPTIONAL interface for adapters that can be told which
// resolver answers their users' name lookups (see dto.DnsCfg).
//
// A node-level setting, next to the policy and for a harder reason than
// symmetry: every core we render to keeps ONE resolver per process, and the
// process is one per node. It first rode on the inbound, where a process-wide
// setting sat behind a per-profile switch and two profiles on one node could
// disagree about it.
//
// Optional for the same reason as PolicyReceiver: a core that cannot express it
// should not pretend to, and the raw bytes pass through undecoded so this
// package stays free of the wire shape.
//
// Absent (nil / empty) MUST render exactly as before, which is the state every
// node is in today: no `dns` section at all, and the host's own resolver
// answers.
type DnsReceiver interface {
	ApplyDns(dns json.RawMessage) error
}

// CascadeReceiver is an OPTIONAL interface for adapters that can draw this
// node's hop in a cascade (see dto.NodeCascade).
//
// Unlike PolicyReceiver and DnsReceiver, the block is NOT broadcast to every
// adapter: the request names the node's router in `engine`, and only the adapter
// whose Engine() matches is told. Two cores drawing the same chain would fight
// over the link port.
//
// The other side of that: an adapter that implements this is called on EVERY
// applyInbounds, with nil when the push carried nothing for it. That call is not
// noise, it is what tells the adapter this push had no node-level cascade, so
// the transitional copy still riding on the inbound is the one to read.
//
// Nil MUST leave the config exactly as the inbound-level copy would have, which
// is what makes it safe to ship before the panel sends the block.
type CascadeReceiver interface {
	ApplyCascade(fragments json.RawMessage) error
}

// Provisionable is an OPTIONAL interface for adapters that can be REGISTERED
// without being CONFIGURED. The installer registers an adapter for every
// protocol the operator might switch on later, and such an adapter sits idle
// until the panel pushes it an inbound ("waiting for ApplyInbound from panel").
//
// Without this distinction /healthz reports one thing for two different states:
// a core that is configured and has died (a fault worth waking someone for) and
// a core nobody has configured yet (the normal state of a fresh node). Every
// node of the field fleet therefore reported `degraded` permanently, so when a
// core actually crashes the status does not change. A signal that is always on
// carries nothing.
//
// Adapters that don't implement this are treated as configured, which is the
// behaviour that predates the interface.
type Provisionable interface {
	// Provisioned reports whether this core has the configuration it needs to
	// run. It must be the SAME condition Start uses to decide whether to defer,
	// otherwise the two disagree and the status is a guess.
	Provisioned() bool
}

// RestartReporter is an OPTIONAL interface an adapter may implement to report
// the above. /healthz type-asserts each adapter against it, exactly like
// Versioner below; adapters that don't implement it simply report nothing.
type RestartReporter interface {
	// RestartStats must be goroutine-safe and cheap: it is called on every
	// healthcheck poll (every 30s per node).
	RestartStats() RestartStats
}

// Versioner is an OPTIONAL interface an adapter may implement to report the
// version of its underlying core binary (e.g. the output of `xray version`).
// The /healthz handler type-asserts each adapter against it and, when present,
// includes the version in that core's CoreStatus. Adapters that don't implement
// it simply report an empty version. The panel persists this per node so it can
// gate features that need a minimum core version (e.g. cascade exit selection
// via vlessRoute needs xray >= 25.9.5).
type Versioner interface {
	// CoreVersion returns the core binary version string, or "" if unknown
	// (config-only mode, binary missing, or the version query failed). It must
	// be goroutine-safe and cheap to call repeatedly (implementations cache).
	CoreVersion() string
}

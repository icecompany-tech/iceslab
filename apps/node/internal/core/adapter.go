package core

import (
	"context"
	"encoding/json"
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

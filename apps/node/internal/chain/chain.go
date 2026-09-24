// Package chain runs the cascade as its own process.
//
// Phase 4. Until now a cascade was drawn INSIDE the user's core: the same xray
// that terminates subscribers also dialled the next hop, so the chain shared a
// process, a config and a restart with the thing users are connected to. Here
// the two come apart. The user's core hands traffic to a loopback socks port
// and this process owns the hops, the ways out and the protections.
//
// Deliberately NOT a core adapter, and the difference is load bearing:
//
//   - an adapter serves a PROTOCOL to users, is named by a ProtocolName and is
//     enumerated in the healthcheck's `cores`. The chain serves no protocol and
//     has no users; it is one process per node whatever cascades run on it;
//   - an adapter is chosen by the panel per inbound. The chain is a node-level
//     block, like the policy and the resolver;
//   - `contract-mirror.test.ts` reads every adapter's Engine() to keep the wire
//     enumerations honest. A pseudo-adapter here would have to lie to it.
//
// What it does owe the rest of the agent is three answers: is it running (the
// healthcheck), which loopback ports it holds (the panel's port check), and
// whether a chain is in force at all (the cascade fragments must then be
// ignored, or two processes draw the same chain and fight over the link port).
package chain

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"

	"github.com/icecompany-tech/iceslab/apps/node/internal/atomicfile"
	"github.com/icecompany-tech/iceslab/apps/node/internal/core/subprocess"
	"github.com/icecompany-tech/iceslab/apps/node/internal/dto"
)

// Engine is the only name this agent knows how to run a chain with. A block
// naming anything else is REFUSED rather than attempted: the config is the
// engine's own JSON, so guessing would mean handing sing-box syntax to
// something that is not sing-box and reading the crash as ours.
const Engine = "singbox"

// PortOwner is the key the reserved loopback ports are reported under. A key,
// never a phrase: the panel is bilingual and turns it into words.
const PortOwner = "chain-socks"

// RunCmdFunc runs a command and returns its combined output. Injected so the
// config check is testable without the binary, exactly as the xray adapter
// does it.
type RunCmdFunc func(ctx context.Context, name string, args ...string) ([]byte, error)

type Config struct {
	// BinaryPath is the sing-box executable. Empty means this node cannot run a
	// chain: the block is then refused with a reason rather than silently
	// accepted, because accepting it would leave the panel believing a chain is
	// up that nothing is drawing.
	BinaryPath string
	// ConfigPath is where the rendered chain config lands.
	ConfigPath string
	Logger     *slog.Logger
	// Run performs the pre-swap `sing-box check` and reads the version. Left
	// empty it is the real runner: a node must never end up not asking the
	// engine, which is the difference between a bad config stopping at the door
	// and a bad config crash-looping the chain.
	Run RunCmdFunc
	// Lifetime is the context the chain PROCESS lives by: the agent's own, so
	// it ends when the agent does and at no other time. Nil is
	// context.Background().
	//
	// ⚠ Never the request's. Apply is called from the push handler, and the
	// request context is cancelled the moment the response is sent; the
	// subprocess is started with exec.CommandContext, whose cancel is SIGKILL
	// to the whole group. That is E21 (stand, 24.09): "chain applied", then
	// "chain subprocess exited: signal: killed" 0.4 s later, every time, while
	// `sing-box check` was clean and a manual run lived.
	Lifetime context.Context

	// Phase 8, the AWG tunnels under the legs. Each has a working default and
	// is a field only so the tests can stand in for the machine.
	//
	// AwgQuickBin raises and takes down a tunnel (default "awg-quick").
	AwgQuickBin string
	// IPBin deletes a tunnel interface that has no config left (default "ip").
	IPBin string
	// ListLinks names the machine's interfaces (default /sys/class/net).
	ListLinks func() ([]string, error)
	// LinkExists says whether one interface is there (default /sys/class/net).
	LinkExists func(iface string) bool
	// OpenTunnel opens the firewall for a tunnel: its UDP port when
	// listenPort > 0, and what arrives on the interface. Nil opens nothing.
	OpenTunnel func(ctx context.Context, iface string, listenPort int)
}

type Manager struct {
	cfg Config

	mu sync.Mutex
	// proc is the running engine, nil when no chain is in force.
	proc *subprocess.Subprocess
	// socks is the last accepted set of listeners, which is what the reserved
	// ports are reported from. Cleared when the chain is stopped.
	socks []dto.ChainSocks
	// held says whether a chain block has ever been accepted and not since
	// withdrawn. It is what makes the healthcheck able to distinguish "no chain
	// here" from "the chain is down", which the panel needs: reading absence as
	// down would turn the whole fleet red the day the field shipped.
	held bool
	// lastErr is why the chain is not running, in the engine's own words.
	lastErr string
	// version is the engine version, asked once and cached.
	version string
	// ignoreLogged keeps the "fragments ignored" line to ONE per process. It is
	// the first line somebody looks for when a chain misbehaves, and a line
	// repeated on every push is a line nobody can find.
	ignoreLogged bool
}

func New(cfg Config) *Manager {
	if cfg.Logger == nil {
		cfg.Logger = slog.Default()
	}
	if cfg.Run == nil {
		// A node gets the real runner by default. Only a test passes its own,
		// and only a test should be able to skip asking the engine.
		cfg.Run = defaultRun
	}
	if cfg.Lifetime == nil {
		cfg.Lifetime = context.Background()
	}
	if cfg.AwgQuickBin == "" {
		cfg.AwgQuickBin = "awg-quick"
	}
	if cfg.IPBin == "" {
		cfg.IPBin = "ip"
	}
	if cfg.ListLinks == nil {
		cfg.ListLinks = defaultListLinks
	}
	if cfg.LinkExists == nil {
		cfg.LinkExists = defaultLinkExists
	}
	return &Manager{cfg: cfg}
}

func defaultRun(ctx context.Context, name string, args ...string) ([]byte, error) {
	return exec.CommandContext(ctx, name, args...).CombinedOutput()
}

// Active reports whether a chain block is in force, which is the question the
// push path asks before handing cascade fragments to a core. True from the
// moment a block is accepted until one arrives absent.
func (m *Manager) Active() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.held
}

// NoteCascadeIgnored writes the one line the incident review starts from, and
// writes it once per process.
func (m *Manager) NoteCascadeIgnored() {
	m.mu.Lock()
	first := !m.ignoreLogged
	m.ignoreLogged = true
	m.mu.Unlock()
	if first {
		m.cfg.Logger.Info("chain block present, xray cascade fragments ignored")
	}
}

// Status is what the healthcheck reports, or nil when this node holds no chain.
//
// Nil is an ANSWER and not a silence: every node outside a cascade returns it
// forever, and a panel that read it as "down" would degrade the fleet.
func (m *Manager) Status() *dto.ChainStatusDto {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.held {
		return nil
	}
	st := dto.ChainStatusDto{
		Running: m.proc != nil && m.proc.Running(),
		Version: m.version,
		// The ports ride inside the chain's own block: they are the chain's,
		// and saying so in a core's list was a lie about the owner.
		ReservedPorts: m.reservedPortsLocked(),
	}
	if !st.Running {
		st.Error = m.lastErr
		if st.Error == "" && m.proc != nil {
			// The process itself: how it exited and the last thing it wrote
			// to stderr. E21 went out as "left no reason" while the agent's own
			// log said "signal: killed"; the reason existed and was not kept.
			st.Error = m.proc.ExitReason()
		}
		if st.Error == "" {
			// Nothing has run yet, or it exited without a status. Saying so
			// beats an empty field, which reads like "no problem" next to
			// running:false.
			st.Error = "the chain process is not running and left no reason"
		}
	}
	return &st
}

// ReservedPorts are the loopback sockets the chain holds, one per way out.
//
// Reported so the panel can refuse a user binding on a port the chain already
// has. Read from the LAST ACCEPTED block rather than derived from the tag
// formula here: the wire carries the ports, and a second copy of the formula on
// this side is a second thing to keep in step by hand.
func (m *Manager) ReservedPorts() []dto.ReservedPortDto {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.reservedPortsLocked()
}

// reservedPortsLocked is the body of the above, for callers that already hold
// the lock. Status needs it and taking the mutex twice would deadlock.
func (m *Manager) reservedPortsLocked() []dto.ReservedPortDto {
	held := make([]dto.ReservedPortDto, 0, len(m.socks))
	for _, s := range m.socks {
		if s.Port <= 0 {
			continue
		}
		held = append(held, dto.ReservedPortDto{
			Owner: PortOwner,
			Port:  s.Port,
			// Socks is TCP. Sent rather than assumed by the panel, which
			// compares it against a binding's transport.
			Transport: "tcp",
		})
	}
	return held
}

/*
Apply puts one pushed chain block into force, or takes the chain out of service
when the block is absent.

The order is the design, and it is the same one the xray adapter arrived at the
hard way: ASK THE ENGINE FIRST. A config written before it is checked is a
config the running process may be restarted onto, and then the node is dark for
a typo the panel could have refused in a sentence. So a refused config leaves
the previous one exactly where it was and hands the engine's own words back.
*/
func (m *Manager) Apply(ctx context.Context, block *dto.NodeChain) error {
	if block == nil {
		return m.stop("no chain block in this push")
	}
	if block.Engine != Engine {
		// Refused, not attempted. See Engine above.
		return m.fail(fmt.Errorf(
			"chain engine %q is not one this agent can run (it knows %q)", block.Engine, Engine))
	}
	if len(block.Config) == 0 {
		return m.fail(fmt.Errorf("chain block carries no config"))
	}
	// The tunnels are checked with the rest of the block, before anything is
	// touched: a tunnel this agent will not raise is a refusal, not half a chain.
	for _, t := range block.Tunnels {
		if err := validateTunnel(t); err != nil {
			return m.fail(err)
		}
	}
	if m.cfg.BinaryPath == "" {
		// The sentence an operator reads on the node's card, so it says what to
		// DO rather than what is missing. Without the command they get a fact
		// and a trip to the docs, and the node stays out of the cascade in the
		// meantime.
		return m.fail(fmt.Errorf(
			"no %s binary on this node, so the chain cannot be drawn: run "+
				"bootstrap-singbox.sh on it and restart iceslab-node", Engine))
	}
	if err := m.check(ctx, block.Config); err != nil {
		// The running chain is untouched. That is the whole point of checking
		// before the swap, and the reason travels back to the panel, which is
		// the only place an operator will read it.
		m.cfg.Logger.Error("the chain engine refused the new config, keeping the running one",
			"err", err)
		return m.fail(err)
	}

	if err := writeConfig(m.cfg.ConfigPath, block.Config); err != nil {
		return m.fail(err)
	}

	// Accepted: the config the engine approved is on disk and names these
	// listeners. The ports are recorded HERE, before the process is started,
	// and that is deliberate. A chain whose start fails is restarted by the
	// supervisor onto this same config, so the ports are spoken for either way,
	// and the panel refusing a user binding on one of them is right in both
	// states. Recording them only on a successful start would free them for the
	// exact minutes the node is trying to come back.
	m.mu.Lock()
	old := m.proc
	m.socks = append([]dto.ChainSocks(nil), block.Socks...)
	m.held = true
	m.lastErr = ""
	m.mu.Unlock()
	if old != nil {
		_ = old.Stop(context.Background())
	}

	// The tunnels BEFORE the process: its legs are bound to their interfaces
	// (bind_interface), and a leg dialled before its tunnel exists fails rather
	// than leaving by the default route. That is also why a tunnel that will
	// not come up stops the chain here instead of being worked around.
	if err := m.applyTunnels(ctx, block.Tunnels); err != nil {
		return m.fail(fmt.Errorf("raise the leg tunnels: %w", err))
	}

	proc := subprocess.New(subprocess.Config{
		Name:   "chain",
		Binary: m.cfg.BinaryPath,
		Args:   []string{"run", "-c", m.cfg.ConfigPath},
		Logger: m.cfg.Logger,
		// The same restart budget the user cores get. A chain that crash-loops
		// forever is a node that looks alive and carries nothing; five attempts
		// and then the healthcheck says so.
		MaxRestarts:    subprocess.DefaultMaxRestarts,
		RestartBackoff: subprocess.DefaultRestartBackoff,
	})
	// The agent's lifetime, not ctx: ctx is the push request's and dies with
	// the response (see Config.Lifetime). ctx still bounds the check above and
	// the version read below, which are part of answering the request.
	if err := proc.Start(m.cfg.Lifetime); err != nil {
		return m.fail(fmt.Errorf("start the chain process: %w", err))
	}

	m.mu.Lock()
	m.proc = proc
	m.mu.Unlock()
	m.readVersion(ctx)

	m.cfg.Logger.Info("chain applied", "ways-out", len(block.Socks), "config", m.cfg.ConfigPath)
	return nil
}

// stop takes the chain out of service: the process goes down and the ports it
// held are released, so the panel stops refusing bindings on them.
//
// Withdrawing the block is a normal event, not a fault. It is how a rollback to
// a panel that does not send the chain returns a node to drawing the cascade in
// its own core, with nobody logging in to the box.
func (m *Manager) stop(why string) error {
	m.mu.Lock()
	proc := m.proc
	was := m.held
	m.proc = nil
	m.socks = nil
	m.held = false
	m.lastErr = ""
	m.mu.Unlock()

	if proc != nil {
		_ = proc.Stop(context.Background())
	}
	// No chain, no legs, no tunnels under them.
	if err := m.sweepTunnels(context.Background(), nil); err != nil {
		m.cfg.Logger.Warn("taking the leg tunnels down with the chain", "err", err)
	}
	if was {
		m.cfg.Logger.Info("chain withdrawn, the node is back to drawing the cascade in its core",
			"reason", why)
	}
	return nil
}

// fail records why the chain is not running and reports it. The block stays
// HELD: the panel asked for a chain here, it is not running, and that is
// exactly the state the healthcheck has to be able to describe. Forgetting it
// would report "no chain on this node" about a node that is missing one.
func (m *Manager) fail(err error) error {
	m.mu.Lock()
	m.held = true
	m.lastErr = err.Error()
	m.mu.Unlock()
	return err
}

// check asks the engine whether it will load this config, against a candidate
// file in a temp dir so the live one is never touched.
func (m *Manager) check(ctx context.Context, blob json.RawMessage) error {
	if m.cfg.Run == nil {
		return nil
	}
	dir, err := os.MkdirTemp("", "iceslab-chain-check-")
	if err != nil {
		return fmt.Errorf("temp dir for the config check: %w", err)
	}
	defer os.RemoveAll(dir)
	candidate := filepath.Join(dir, "config.json")
	if err := os.WriteFile(candidate, blob, 0o600); err != nil {
		return fmt.Errorf("write candidate config: %w", err)
	}
	out, err := m.cfg.Run(ctx, m.cfg.BinaryPath, "check", "-c", candidate)
	if err != nil {
		// The engine's own words, trimmed: they name the offending part, and
		// this sentence is the whole value of the refusal.
		return fmt.Errorf("the chain engine rejected the config: %w (%s)",
			err, strings.TrimSpace(string(out)))
	}
	return nil
}

// readVersion asks the binary once and caches. Best effort: a version the
// engine will not say is an empty string, not a failure to run a chain.
func (m *Manager) readVersion(ctx context.Context) {
	m.mu.Lock()
	known := m.version != ""
	run := m.cfg.Run
	m.mu.Unlock()
	if known || run == nil {
		return
	}
	out, err := run(ctx, m.cfg.BinaryPath, "version")
	if err != nil {
		return
	}
	// "sing-box version 1.13.14" on the first line, which is the shape every
	// release prints and the same parse the sing-box adapter uses.
	fields := strings.Fields(strings.SplitN(strings.TrimSpace(string(out)), "\n", 2)[0])
	if len(fields) >= 3 && fields[1] == "version" {
		m.mu.Lock()
		m.version = fields[2]
		m.mu.Unlock()
	}
}

// writeConfig lands the config atomically, 0600: it carries the socks password
// and the credentials of every leg out of this node.
func writeConfig(path string, blob []byte) error {
	if path == "" {
		return fmt.Errorf("no chain config path configured")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("mkdir %s: %w", filepath.Dir(path), err)
	}
	return atomicfile.Write(path, blob, 0o600)
}

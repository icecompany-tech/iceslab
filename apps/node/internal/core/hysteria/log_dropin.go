package hysteria

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/icecompany-tech/iceslab/apps/node/internal/atomicfile"
)

/*
A-265: the hysteria systemd runs logs at error too (LogLevelEnv says why).

The unit comes from the installer, and on nodes installed before A-265 it has
no HYSTERIA_LOG_LEVEL, so hysteria logs every client's IP and user id at info;
the installer of 26.10 wrote warn, which still names the client on every
connection that ends in an error. Either is overridden here.
The agent cannot fix the unit file: its own unit runs under ProtectSystem=strict
and /etc/systemd/system is not among its ReadWritePaths (install-iceslab-node.sh),
and reinstalling the agent to widen them wipes its mTLS keys. /run is writable,
and systemd reads drop-ins from /run/systemd/system as well (runtime units).

So on every start of the adapter: if the unit's environment already carries
the level (a new installer sets it in the unit, or the drop-in is still there),
nothing is done. The drop-in's Environment= comes after the unit's, and for
the same variable systemd keeps the later assignment (systemd.exec,
Environment=), which is also what `systemctl show -p Environment` answers
after the reload: one try-restart, then the check finds the level and stops. Otherwise the runtime drop-in is written, systemd reloaded and
the unit try-restarted, which restarts it only if it runs: a hysteria the agent
idled for want of an inbound stays down. /run is empty after a reboot, so a node
whose unit lacks the line restarts hysteria once after each boot.
*/

// RuntimeUnitDir is where systemd reads runtime unit drop-ins.
const RuntimeUnitDir = "/run/systemd/system"

const logDropInName = "iceslab-log.conf"

// CmdOutputFunc runs a command and answers its standard output.
type CmdOutputFunc func(ctx context.Context, name string, args ...string) ([]byte, error)

func defaultCmdOutput(ctx context.Context, name string, args ...string) ([]byte, error) {
	return exec.CommandContext(ctx, name, args...).Output()
}

// unitName is the unit with its suffix: HYSTERIA_SERVICE_UNIT may say
// "hysteria" or "hysteria.service", the drop-in directory needs the latter.
func unitName(u string) string {
	if strings.Contains(u, ".") {
		return u
	}
	return u + ".service"
}

func logDropIn() []byte {
	return []byte("# Written by iceslab-node (A-265): below error hysteria logs the client's IP\n" +
		"# and user id (info: every connect; warn: every broken connection).\n" +
		"# Runtime: gone after a reboot, written again.\n" +
		"[Service]\nEnvironment=" + LogLevelEnv + "\n")
}

// ensureUnitLogLevel gives the systemd unit LogLevelEnv when its
// environment does not carry it. Best-effort: a node it fails on keeps
// serving, and says why in the agent's log.
func (a *Adapter) ensureUnitLogLevel(ctx context.Context) {
	unit := unitName(a.cfg.ServiceUnit)
	out, err := a.cfg.CmdOutput(ctx, "systemctl", "show", "-p", "Environment", "--value", unit)
	if err != nil {
		a.logger.Warn("hysteria: could not read the unit's environment, log level left as it is", "unit", unit, "err", err)
		return
	}
	env := strings.Fields(string(out))
	a.noteUnitACMEDir(env)
	for _, kv := range env {
		if kv == LogLevelEnv {
			// The unit carries the level, but a process started before it
			// got it does not: a try-restart that failed after the drop-in
			// was written left it on the old level, and from then on the
			// check above found the level and stopped (AUDT, A-265).
			if why := a.processLacksLevel(ctx, unit); why != "" {
				if err := a.cfg.RunCmd(ctx, "systemctl", "try-restart", unit); err != nil {
					a.logger.Warn("hysteria: systemctl try-restart for the log level failed", "unit", unit, "why", why, "err", err)
					return
				}
				a.logger.Info(fmt.Sprintf("hysteria: %s restarted to run with %s (%s)", unit, LogLevelEnv, why))
			}
			return
		}
	}
	dir := filepath.Join(a.cfg.RuntimeUnitDir, unit+".d")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		a.logger.Warn("hysteria: could not create the runtime drop-in directory", "dir", dir, "err", err)
		return
	}
	path := filepath.Join(dir, logDropInName)
	if err := atomicfile.Write(path, logDropIn(), 0o644); err != nil {
		a.logger.Warn("hysteria: could not write the log level drop-in", "path", path, "err", err)
		return
	}
	for _, args := range [][]string{{"daemon-reload"}, {"try-restart", unit}} {
		if err := a.cfg.RunCmd(ctx, "systemctl", args...); err != nil {
			a.logger.Warn("hysteria: systemctl "+strings.Join(args, " ")+" after the log level drop-in failed", "err", err)
			return
		}
	}
	a.logger.Info(fmt.Sprintf("hysteria: %s now runs with %s (runtime drop-in %s)", unit, LogLevelEnv, path))
}

// processLacksLevel says why the unit's running process does not run with
// LogLevelEnv, or "" when it does, is not running, or cannot be told.
//
// The process's own environment first (/proc/<MainPID>/environ, what it was
// started with). Where that cannot be read (another mount of /proc, a kernel
// that hides it), the start time against the drop-in: a process started
// before the drop-in was written cannot have the level from it.
func (a *Adapter) processLacksLevel(ctx context.Context, unit string) string {
	out, err := a.cfg.CmdOutput(ctx, "systemctl", "show", "-p", "MainPID", "--value", unit)
	if err != nil {
		return ""
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(out)))
	if err != nil || pid <= 0 {
		return "" // not running: it starts with the unit's environment
	}
	if environ, err := os.ReadFile(filepath.Join(a.cfg.ProcRoot, strconv.Itoa(pid), "environ")); err == nil {
		for _, kv := range strings.Split(string(environ), "\x00") {
			if kv == LogLevelEnv {
				return ""
			}
		}
		return fmt.Sprintf("process %d runs without %s", pid, LogLevelEnv)
	}
	st, err := os.Stat(filepath.Join(a.cfg.RuntimeUnitDir, unit+".d", logDropInName))
	if err != nil {
		return "" // no drop-in of ours: the level is the unit's own
	}
	out, err = a.cfg.CmdOutput(ctx, "systemctl", "show", "-p", "ExecMainStartTimestamp", "--value", "--timestamp=unix", unit)
	if err != nil {
		return ""
	}
	sec, err := strconv.ParseInt(strings.TrimPrefix(strings.TrimSpace(string(out)), "@"), 10, 64)
	if err != nil || sec <= 0 {
		return ""
	}
	if started := time.Unix(sec, 0); started.Before(st.ModTime().Truncate(time.Second)) {
		return fmt.Sprintf("process %d started %s, before the drop-in of %s", pid, started.UTC().Format(time.RFC3339), st.ModTime().UTC().Format(time.RFC3339))
	}
	return ""
}

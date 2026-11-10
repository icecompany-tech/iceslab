package xray

import (
	"os"

	"github.com/icecompany-tech/iceslab/apps/node/internal/core/subprocess"
)

// processConfig is how the agent runs the xray process: the one place its
// command line and environment are set.
func (a *Adapter) processConfig(binPath, cfgPath string, memLimit uint64) subprocess.Config {
	return subprocess.Config{
		Name:           Name,
		Binary:         binPath,
		Args:           []string{"run", "-c", cfgPath},
		Logger:         a.logger,
		MaxRestarts:    subprocess.DefaultMaxRestarts,
		RestartBackoff: subprocess.DefaultRestartBackoff,
		// Memory ceiling + reporting. memLimit is read under a.mu with the rest of
		// the config snapshot; 0 leaves the watchdog disarmed.
		MemoryLimitBytes: memLimit,
		OnRestart:        a.recordRestart,
		Env:              coreEnv(os.Getenv),
	}
}

// coreEnv is what the xray process gets on top of the agent's environment.
//
// GODEBUG=multipathtcp=0: xray 26.3.27 is built with Go 1.26, and Go opens
// listeners as MPTCP by default where the kernel has MPTCP on (Ubuntu does). On an
// MPTCP listener TCP_USER_TIMEOUT is refused with EOPNOTSUPP, so an inbound's
// tcpUserTimeout (Bk-170) silently did nothing on the nodes, while keepalive, which
// MPTCP takes, worked. Read off the core's own sockets on aeza-de-01 (kernel 7.0):
// TCP_USER_TIMEOUT=0 "operation not supported". Xray turns MPTCP off by default
// itself from v26.10.31 (XTLS/Xray-core#7291); until the pin moves there, the agent
// says it. An operator's own GODEBUG settings are kept, this one is added last so it
// wins.
func coreEnv(getenv func(string) string) []string {
	const off = "multipathtcp=0"
	if v := getenv("GODEBUG"); v != "" {
		return []string{"GODEBUG=" + v + "," + off}
	}
	return []string{"GODEBUG=" + off}
}

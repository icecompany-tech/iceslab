package core

import (
	"os"
	"os/exec"
	"strconv"
	"strings"
)

// BinaryPresent reports whether an adapter's core binary is actually on this
// machine.
//
// An empty path is NOT present: that is config-only mode, where the adapter
// writes a config and spawns nothing, and calling it installed would tell the
// panel a core is there to carry the operator's policy when nothing is.
//
// A bare name (no separator) is looked up in PATH, because that is how the
// installers hand some of them over; anything else is stat'ed. Cheap either
// way, which matters: this runs on every healthcheck poll.
func BinaryPresent(path string) bool {
	if path == "" {
		return false
	}
	if !strings.ContainsAny(path, `/\`) {
		_, err := exec.LookPath(path)
		return err == nil
	}
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

// PortOfListenAddr pulls the port out of a "host:port" listen address, or 0
// when there is nothing to pull.
//
// Zero rather than an error on purpose: a malformed address means the adapter
// holds no port anybody can name, and a reserved-port list is allowed to be
// short. It is never allowed to contain an invented number, because the panel
// refuses an operator's port on the strength of it.
func PortOfListenAddr(addr string) int {
	i := strings.LastIndex(addr, ":")
	if i < 0 || i == len(addr)-1 {
		return 0
	}
	p, err := strconv.Atoi(addr[i+1:])
	if err != nil || p <= 0 || p > 65535 {
		return 0
	}
	return p
}

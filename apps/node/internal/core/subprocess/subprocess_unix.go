//go:build unix

package subprocess

import (
	"os/exec"
	"syscall"
)

// Unix process-group helpers (N5). Setpgid makes the spawned child a process
// group leader, so its pgid equals its pid; signalling -pid then reaches the
// whole group (the core plus any helper/grandchild it forks). The node-agent
// only ships on Linux; this is the live implementation.

// setProcessGroup puts the child in its own process group and group-kills on
// ctx cancellation (overriding exec's default leader-only Kill). The Cancel
// closure reads cmd.Process at cancel time, by which point Start has set it.
func setProcessGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error { return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) }
}

func terminateGroup(cmd *exec.Cmd) error {
	return syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM)
}

func killGroup(cmd *exec.Cmd) error {
	return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
}

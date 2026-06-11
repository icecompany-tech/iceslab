//go:build !unix

package subprocess

import "os/exec"

// Non-unix fallback for process-group helpers (N5). The node-agent only runs on
// Linux; these stubs exist purely so the package still builds under dev tooling
// on Windows (no process groups there). Signals fall back to the single
// process rather than the group.

func setProcessGroup(_ *exec.Cmd) {}

func terminateGroup(cmd *exec.Cmd) error {
	return cmd.Process.Kill()
}

func killGroup(cmd *exec.Cmd) error {
	return cmd.Process.Kill()
}

package core

import (
	"os/exec"
	"runtime"
	"strings"
	"sync"
)

var (
	machineArchOnce sync.Once
	machineArch     string
)

// MachineArch names this machine the way the version manifest and the
// bootstrap scripts do (amd64, arm64, armv7), or "" when it is none of them.
// Asked once: a machine does not change arch under a running agent.
func MachineArch() string {
	machineArchOnce.Do(func() {
		machine := ""
		// GOARCH says "arm" for every 32-bit ARM, and the release files differ
		// by revision, so for arm the kernel's answer decides, the same
		// `uname -m` the scripts read.
		if runtime.GOARCH == "arm" {
			if out, err := exec.Command("uname", "-m").Output(); err == nil {
				machine = strings.TrimSpace(string(out))
			}
		}
		machineArch = archName(runtime.GOARCH, machine)
	})
	return machineArch
}

// archName maps a Go arch, and for arm the kernel's machine name, onto the
// manifest's names. Anything it cannot name is "": an arch the panel guesses
// would hand out a download for the wrong machine.
func archName(goarch, machine string) string {
	switch goarch {
	case "amd64":
		return "amd64"
	case "arm64":
		return "arm64"
	case "arm":
		if machine == "armv7l" {
			return "armv7"
		}
	}
	return ""
}

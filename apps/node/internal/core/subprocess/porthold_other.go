//go:build !linux

package subprocess

// Non-Linux fallback: there is no /proc to read, and the line stays as the
// engine wrote it. Production node-agents run on Linux.
func portHolder(_ string, _ int) string {
	return ""
}

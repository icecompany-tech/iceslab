//go:build linux

package xray

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
)

// Linux system call numbers this file needs and package syscall does not name.
const (
	sysPidfdOpen  = 434
	sysPidfdGetfd = 438
	// tcpUserTimeout is TCP_USER_TIMEOUT from linux/tcp.h.
	tcpUserTimeout = 18
)

// coreSocketOptions reads, from the core's own process, the socket options the
// kernel holds on the core's sockets for a local port: the listener and every
// connection accepted on it. It borrows each socket with pidfd_getfd, so what it
// reports is the kernel's value on that very socket, not what the config says.
func coreSocketOptions(port int) string {
	inodes := socketInodes(port)
	if len(inodes) == 0 {
		return fmt.Sprintf("no socket on port %d in /proc/net/tcp", port)
	}
	pid := ownerOf(inodes)
	if pid == 0 {
		return fmt.Sprintf("no process holds the sockets of port %d", port)
	}
	pidfd, _, errno := syscall.Syscall(sysPidfdOpen, uintptr(pid), 0, 0)
	if errno != 0 {
		return fmt.Sprintf("pidfd_open(%d): %v", pid, errno)
	}
	defer syscall.Close(int(pidfd))
	dir := fmt.Sprintf("/proc/%d/fd", pid)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return fmt.Sprintf("%s: %v", dir, err)
	}
	var out []string
	for _, e := range entries {
		link, err := os.Readlink(filepath.Join(dir, e.Name()))
		if err != nil {
			continue
		}
		state, ok := inodes[strings.TrimSuffix(strings.TrimPrefix(link, "socket:["), "]")]
		if !ok || !strings.HasPrefix(link, "socket:[") {
			continue
		}
		target, _ := strconv.Atoi(e.Name())
		fd, _, errno := syscall.Syscall(sysPidfdGetfd, pidfd, uintptr(target), 0)
		if errno != 0 {
			out = append(out, fmt.Sprintf("%s fd %d: pidfd_getfd: %v", state, target, errno))
			continue
		}
		ut, err1 := syscall.GetsockoptInt(int(fd), syscall.IPPROTO_TCP, tcpUserTimeout)
		idle, err2 := syscall.GetsockoptInt(int(fd), syscall.IPPROTO_TCP, syscall.TCP_KEEPIDLE)
		ka, err3 := syscall.GetsockoptInt(int(fd), syscall.SOL_SOCKET, syscall.SO_KEEPALIVE)
		_ = syscall.Close(int(fd))
		out = append(out, fmt.Sprintf("%s fd %d: TCP_USER_TIMEOUT=%d (%v) SO_KEEPALIVE=%d (%v) TCP_KEEPIDLE=%d (%v)",
			state, target, ut, err1, ka, err3, idle, err2))
	}
	if len(out) == 0 {
		return "no fd of the core points at the port's sockets"
	}
	return strings.Join(out, "; ")
}

// ownerOf finds the process holding one of the sockets: the core.
func ownerOf(inodes map[string]string) int {
	procs, _ := os.ReadDir("/proc")
	for _, p := range procs {
		pid, err := strconv.Atoi(p.Name())
		if err != nil || pid == os.Getpid() {
			continue
		}
		fds, _ := os.ReadDir(fmt.Sprintf("/proc/%d/fd", pid))
		for _, fd := range fds {
			link, _ := os.Readlink(fmt.Sprintf("/proc/%d/fd/%s", pid, fd.Name()))
			if _, ok := inodes[strings.TrimSuffix(strings.TrimPrefix(link, "socket:["), "]")]; ok && strings.HasPrefix(link, "socket:[") {
				return pid
			}
		}
	}
	return 0
}

// socketInodes maps the inode of each socket on a local port to its state name.
func socketInodes(port int) map[string]string {
	raw, err := os.ReadFile("/proc/net/tcp")
	if err != nil {
		return nil
	}
	want := fmt.Sprintf(":%04X", port)
	out := map[string]string{}
	for _, line := range strings.Split(string(raw), "\n")[1:] {
		f := strings.Fields(line)
		if len(f) < 10 || !strings.HasSuffix(f[1], want) {
			continue
		}
		state := "accepted"
		if f[3] == "0A" {
			state = "listener"
		}
		out[f[9]] = state
	}
	return out
}

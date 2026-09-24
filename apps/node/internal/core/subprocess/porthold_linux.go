//go:build linux

package subprocess

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

const procRoot = "/proc"

// portHolder names the process holding a local port, as "<cmdline> (pid N)",
// or "" when nothing is found. Read from /proc alone, no ss or lsof: the
// socket's inode comes from /proc/net/{tcp,tcp6} (or udp), and the process is
// the one with an fd pointing at "socket:[inode]".
//
// Only listening TCP sockets count (state 0A); for UDP every bound socket does,
// UDP having no listen state. Seeing another user's fds needs root, which the
// agent runs as; without it the answer is simply "".
func portHolder(network string, port int) string {
	inodes := map[string]bool{}
	for _, file := range []string{network, network + "6"} {
		collectInodes(filepath.Join(procRoot, "net", file), network == "tcp", port, inodes)
	}
	if len(inodes) == 0 {
		return ""
	}
	pids, err := os.ReadDir(procRoot)
	if err != nil {
		return ""
	}
	for _, p := range pids {
		pid, err := strconv.Atoi(p.Name())
		if err != nil {
			continue
		}
		fdDir := filepath.Join(procRoot, p.Name(), "fd")
		fds, err := os.ReadDir(fdDir)
		if err != nil {
			continue
		}
		for _, fd := range fds {
			target, err := os.Readlink(filepath.Join(fdDir, fd.Name()))
			if err != nil || !strings.HasPrefix(target, "socket:[") {
				continue
			}
			if inodes[strings.TrimSuffix(strings.TrimPrefix(target, "socket:["), "]")] {
				return fmt.Sprintf("%s (pid %d)", cmdlineOf(pid), pid)
			}
		}
	}
	return ""
}

// collectInodes reads one /proc/net table and keeps the inodes of sockets
// bound to `port`. Columns: sl local_address rem_address st ... inode, with the
// address as HEXIP:HEXPORT.
func collectInodes(path string, listenOnly bool, port int, into map[string]bool) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	sc.Scan() // header
	for sc.Scan() {
		fields := strings.Fields(sc.Text())
		if len(fields) < 10 {
			continue
		}
		at := strings.LastIndexByte(fields[1], ':')
		if at < 0 {
			continue
		}
		p, err := strconv.ParseUint(fields[1][at+1:], 16, 32)
		if err != nil || int(p) != port {
			continue
		}
		if listenOnly && fields[3] != "0A" {
			continue
		}
		if fields[9] != "0" {
			into[fields[9]] = true
		}
	}
}

// cmdlineOf is the command line of a process, NULs turned to spaces and cut
// short: it goes into one status line, not a report.
func cmdlineOf(pid int) string {
	data, err := os.ReadFile(filepath.Join(procRoot, strconv.Itoa(pid), "cmdline"))
	if err != nil || len(data) == 0 {
		return "?"
	}
	s := strings.TrimSpace(strings.ReplaceAll(string(data), "\x00", " "))
	if len(s) > 160 {
		s = s[:160] + "..."
	}
	return s
}

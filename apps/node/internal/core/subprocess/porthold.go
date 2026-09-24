package subprocess

import (
	"net"
	"regexp"
	"strconv"
)

// busyListen matches the net package's own wording for a port somebody else
// holds, which is what every engine we run prints, being Go:
//
//	listen tcp 127.0.0.1:26001: bind: address already in use
//	listen udp4 0.0.0.0:24000: bind: address already in use
//
// The address is the one the engine asked for; only its port is used, because
// the holder may sit on the wildcard while the engine asked for loopback.
var busyListen = regexp.MustCompile(`listen (tcp|udp)[46]? (\S+): bind: address already in use`)

// withPortHolder appends who holds the port to a stderr line that says the
// port was taken, and returns the line unchanged otherwise, or when nobody
// can be found (the holder may have gone, or the agent may not see its fds).
//
// E22 is why: on the stand the chain died of busy ports that turned out to be
// the owner's own hand-started sing-box, and finding that took an ssh session
// and `ss -lptn`. The agent can read the same answer out of /proc itself.
func withPortHolder(line string) string {
	m := busyListen.FindStringSubmatch(line)
	if m == nil {
		return line
	}
	_, portStr, err := net.SplitHostPort(m[2])
	if err != nil {
		return line
	}
	port, err := strconv.Atoi(portStr)
	if err != nil || port <= 0 || port > 65535 {
		return line
	}
	if holder := portHolder(m[1], port); holder != "" {
		return line + " (held by " + holder + ")"
	}
	return line
}

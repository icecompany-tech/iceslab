package xray

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// statsQueryTimeout caps the runtime of `xray api statsquery`. Generous —
// the call is local IPC, but the binary may be momentarily blocked during
// a config reload.
const statsQueryTimeout = 5 * time.Second

// xrayStatsResponse mirrors the JSON returned by:
//
//	xray api statsquery -server 127.0.0.1:<port> -pattern user
//
// Each entry's `name` is `user>>><email>>>traffic>>>{uplink,downlink}`,
// where we set `email` = userId in renderConfig (see config.go).
//
// Wire shape (xray-core /infra/conf/cmd):
//
//	{"stat":[{"name":"user>>>...>>>uplink","value":"123"},...]}
//
// `value` is JSON string-of-number — xray uses int64 internally and JSON's
// 53-bit float would lose precision past ~9 PB.
type xrayStatsResponse struct {
	Stat []xrayStatEntry `json:"stat"`
}

// `value` arrives from `xray api statsquery` either as a bare JSON number
// (mainline xray-core) or as a JSON string (a couple of xray-core forks
// that quote int64 values to dodge JS-side 53-bit precision loss). We
// accept either by reading the value as json.RawMessage and parsing in a
// helper; previously we used json.Number which only accepts bare numbers
// and silently broke the fork case AND any malformed entry would fail the
// whole batch instead of being skippable.
type xrayStatEntry struct {
	Name  string          `json:"name"`
	Value json.RawMessage `json:"value"`
}

// statEntryInt64 returns (n, ok) — ok=false on malformed value. Accepts:
//   - bare number              `123`
//   - quoted number string     `"123"`
//   - quoted garbage           `"not-a-number"`  → ok=false
func statEntryInt64(raw json.RawMessage) (int64, bool) {
	s := strings.TrimSpace(string(raw))
	if len(s) == 0 {
		return 0, false
	}
	if s[0] == '"' && s[len(s)-1] == '"' {
		s = s[1 : len(s)-1]
	}
	n, err := parseInt64String(s)
	if err != nil {
		return 0, false
	}
	return n, true
}

// queryUserStats invokes `xray api statsquery` (WITHOUT -reset) and returns
// per-user CUMULATIVE byte counters since the xray process started. The read
// is non-destructive: the panel stores a per-(node,user) snapshot and computes
// the deltas itself, so a lost response or a failed panel-side commit never
// drops bytes (the next poll re-derives the delta from the un-advanced
// snapshot). A destructive `-reset` read made those bytes unrecoverable. #5.
//
// Returns a map keyed by userId (email) → (uplinkBytes, downlinkBytes).
// Missing entries imply zero. Errors propagate; callers decide whether to
// degrade or surface.
func queryUserStats(
	ctx context.Context,
	run RunCmdFunc,
	binary string,
	apiPort int,
) (map[string]userByteCounters, error) {
	if binary == "" {
		return nil, fmt.Errorf("xray binary path is empty")
	}
	ctx, cancel := context.WithTimeout(ctx, statsQueryTimeout)
	defer cancel()

	out, err := run(ctx, binary,
		"api", "statsquery",
		"-server", fmt.Sprintf("127.0.0.1:%d", apiPort),
		"-pattern", "user",
	)
	if err != nil {
		return nil, fmt.Errorf("xray api statsquery: %w (%s)", err, strings.TrimSpace(string(out)))
	}

	var resp xrayStatsResponse
	if err := json.Unmarshal(out, &resp); err != nil {
		return nil, fmt.Errorf("parse statsquery output: %w (raw: %s)", err, strings.TrimSpace(string(out)))
	}

	result := make(map[string]userByteCounters, len(resp.Stat)/2)
	for _, e := range resp.Stat {
		userID, dir, ok := parseStatName(e.Name)
		if !ok {
			continue // unknown shape — skip rather than fail the whole batch
		}
		bytes, ok := statEntryInt64(e.Value)
		if !ok {
			continue
		}
		entry := result[userID]
		switch dir {
		case "uplink":
			entry.UplinkBytes += bytes
		case "downlink":
			entry.DownlinkBytes += bytes
		}
		result[userID] = entry
	}
	return result, nil
}

// parseStatName extracts (userId, "uplink"|"downlink") from a stat key like
// `user>>><userId>>>traffic>>>uplink`. Returns ok=false on any other shape.
func parseStatName(name string) (userID, direction string, ok bool) {
	const sep = ">>>"
	parts := strings.Split(name, sep)
	if len(parts) != 4 || parts[0] != "user" || parts[2] != "traffic" {
		return "", "", false
	}
	if parts[3] != "uplink" && parts[3] != "downlink" {
		return "", "", false
	}
	return parts[1], parts[3], true
}

// parseInt64String parses xray's stringified int64 stat values. xray emits
// them as JSON strings deliberately to dodge the 53-bit float precision
// limit at the protocol boundary.
func parseInt64String(s string) (int64, error) {
	var n int64
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c < '0' || c > '9' {
			return 0, fmt.Errorf("invalid stat value %q", s)
		}
		n = n*10 + int64(c-'0')
	}
	return n, nil
}

type userByteCounters struct {
	UplinkBytes   int64
	DownlinkBytes int64
}

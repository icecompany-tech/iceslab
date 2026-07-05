package singbox

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

const statsQueryTimeout = 5 * time.Second

// RunCmdFunc runs an external command and returns its combined output. The
// default shells out via os/exec; tests inject a fake.
type RunCmdFunc func(ctx context.Context, name string, args ...string) ([]byte, error)

func defaultRunCmd(ctx context.Context, name string, args ...string) ([]byte, error) {
	return exec.CommandContext(ctx, name, args...).CombinedOutput()
}

type userByteCounters struct {
	UplinkBytes   int64
	DownlinkBytes int64
}

// sbStatsResponse mirrors the JSON from `xray api statsquery`:
//
//	{"stat":[{"name":"user>>><userId>>>traffic>>>uplink","value":"123"}, ...]}
//
// sing-box's v2ray_api implements the same StatsService, so the xray CLI can
// query it. `value` is a stringified int64 (or bare number on some forks).
type sbStatsResponse struct {
	Stat []sbStatEntry `json:"stat"`
}

type sbStatEntry struct {
	Name  string          `json:"name"`
	Value json.RawMessage `json:"value"`
}

// queryUserStats reads per-user CUMULATIVE byte counters from a sing-box
// v2ray_api endpoint, using the xray binary as a generic v2ray-stats gRPC
// client. Non-destructive (no -reset): the panel deltas against its own
// snapshot, so a lost response never drops bytes (#5, same model as xray).
//
// Returns a map keyed by userId -> (uplink, downlink). sing-box has no stats
// CLI of its own; the node-agent stays zero-dependency by shelling out rather
// than embedding a gRPC client.
func queryUserStats(ctx context.Context, run RunCmdFunc, binary, statsListen string) (map[string]userByteCounters, error) {
	if binary == "" {
		return nil, fmt.Errorf("stats client binary path is empty")
	}
	ctx, cancel := context.WithTimeout(ctx, statsQueryTimeout)
	defer cancel()

	out, err := run(ctx, binary, "api", "statsquery", "-server", statsListen, "-pattern", "user")
	if err != nil {
		return nil, fmt.Errorf("statsquery: %w (%s)", err, strings.TrimSpace(string(out)))
	}

	var resp sbStatsResponse
	if err := json.Unmarshal(out, &resp); err != nil {
		return nil, fmt.Errorf("parse statsquery output: %w (raw: %s)", err, strings.TrimSpace(string(out)))
	}

	result := make(map[string]userByteCounters, len(resp.Stat)/2)
	for _, e := range resp.Stat {
		userID, dir, ok := parseStatName(e.Name)
		if !ok {
			continue // unknown shape — skip rather than fail the batch
		}
		n, ok := statEntryInt64(e.Value)
		if !ok {
			continue
		}
		c := result[userID]
		switch dir {
		case "uplink":
			c.UplinkBytes += n
		case "downlink":
			c.DownlinkBytes += n
		}
		result[userID] = c
	}
	return result, nil
}

// parseStatName extracts (userId, "uplink"|"downlink") from a stat key like
// `user>>><userId>>>traffic>>>uplink`. ok=false on any other shape.
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

// statEntryInt64 accepts a bare number, a quoted number string, or rejects
// garbage (ok=false). xray quotes int64 to dodge JSON 53-bit float loss.
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

func parseInt64String(s string) (int64, error) {
	if len(s) == 0 {
		return 0, fmt.Errorf("empty stat value")
	}
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

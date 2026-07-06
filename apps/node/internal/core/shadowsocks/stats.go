package shadowsocks

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// statsQueryTimeout caps the runtime of `xray api statsquery`. Same value
// as the xray adapter for consistency.
const statsQueryTimeout = 5 * time.Second

type xrayStatsResponse struct {
	Stat []xrayStatEntry `json:"stat"`
}

// `value` arrives as a bare JSON number (or stringified number, depending
// on xray-core fork). json.Number absorbs both, string-typed Value would
// fail strict-mode unmarshal on int input, killing the whole batch.
type xrayStatEntry struct {
	Name  string      `json:"name"`
	Value json.Number `json:"value"`
}

type userByteCounters struct {
	UplinkBytes   int64
	DownlinkBytes int64
}

// queryUserStats invokes `xray api statsquery -reset` and returns per-user
// counters. Mirror of the xray adapter's stats path, duplicated rather
// than imported so the SS adapter has no compile-time dependency on the
// xray adapter's internals.
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
		"-reset",
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
			continue
		}
		bytes, perr := e.Value.Int64()
		if perr != nil {
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

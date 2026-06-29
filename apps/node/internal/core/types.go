// Package core hosts the CoreAdapter abstraction that every protocol-specific
// adapter (Hysteria, Xray, AmneziaWG, NaiveProxy) implements.
package core

// User is the normalized form of dto.AddUserRequest. The dispatcher copies
// only the protocol-specific credentials each adapter cares about — the rest
// are zero-valued and ignored.
type User struct {
	UserID   string
	ShortID  string
	Username string

	HysteriaPassword   string
	XrayUUID           string
	NaivePassword      string
	AmneziaWGPublicKey string
	AmneziaWGAllowedIP string
	TuicUUID           string
	TuicPassword       string
}

// UserStats are per-user traffic counters reported by a single core.
type UserStats struct {
	UserID   string
	BytesIn  int64
	BytesOut int64
}

// Stats is what an adapter returns from GetStats. The aggregator in
// `internal/server` merges Stats from all running adapters into the
// dto.GetStatsResponse the panel sees.
type Stats struct {
	Users         []UserStats
	TotalBytesIn  int64
	TotalBytesOut int64
	// Cumulative reports whether Users[] counters are cumulative-since-core-start
	// (so the panel computes per-poll deltas against a stored snapshot) rather
	// than already-deltas-since-last-poll. Xray reports cumulative via a
	// non-destructive read; panels that don't see this flag use the legacy
	// delta path. #5.
	Cumulative bool
}

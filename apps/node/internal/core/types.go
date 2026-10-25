// Package core hosts the CoreAdapter abstraction that every protocol-specific
// adapter (Hysteria, Xray, AmneziaWG, NaiveProxy) implements.
package core

// User is the normalized form of dto.AddUserRequest. The dispatcher copies
// only the protocol-specific credentials each adapter cares about, the rest
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
	// AmneziaWGAllowedIP3: the address on the 3.1 interface (t07-6).
	AmneziaWGAllowedIP3 string
	TuicUUID            string
	TuicPassword        string
	AnytlsPassword      string
	ShadowtlsPassword   string
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
	// NoData: the core was asked and did not answer this poll. Users and the
	// totals are then absent, not zero (A-163, 22.10): zeros from a missed
	// poll read as a cumulative counter dropping to 0, the panel re-baselined
	// the user's snapshot, and the next good poll billed the whole counter at
	// once. A core that is not running and so was not asked is not NoData.
	NoData bool
	// Lingering (A-218): users this core no longer holds whose connections
	// are still open, by the email the core knows them by. Nil when the core
	// was not asked or did not answer: "not known", never "nobody"; an empty
	// non-nil slice is "asked, nobody".
	Lingering []LingeringUser
}

// LingeringUser is one such user and how many connections they still hold.
type LingeringUser struct {
	Email    string
	Sessions int64
}

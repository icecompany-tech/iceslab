// Package dto contains JSON wire-format structs for the panel↔node API.
// Field names match the TypeScript DTOs in `packages/shared/src/transport.ts`.
package dto

import "encoding/json"

// ProtocolName mirrors the union in shared/transport.ts.
type ProtocolName string

const (
	ProtocolHysteria  ProtocolName = "hysteria"
	ProtocolXray      ProtocolName = "xray"
	ProtocolAmneziaWG ProtocolName = "amneziawg"
	ProtocolNaive     ProtocolName = "naive"
)

type ProtocolCredentials struct {
	HysteriaPassword   string `json:"hysteriaPassword,omitempty"`
	XrayUUID           string `json:"xrayUuid,omitempty"`
	NaivePassword      string `json:"naivePassword,omitempty"`
	AmneziaWGPublicKey string `json:"amneziawgPublicKey,omitempty"`
	// AmneziaWGAllowedIP is the IP the panel allocated for this user inside
	// the inbound's subnet (e.g. "10.0.0.42"). The adapter writes it into
	// the peer block as `<ip>/32`. Only present when the user has access to
	// an amneziawg inbound.
	AmneziaWGAllowedIP string `json:"amneziawgAllowedIp,omitempty"`
}

// ───── POST /addUser ─────

type AddUserRequest struct {
	UserID      string              `json:"userId"`
	ShortID     string              `json:"shortId"`
	Username    string              `json:"username"`
	Credentials ProtocolCredentials `json:"credentials"`
}

type AddUserResponse struct {
	OK bool `json:"ok"`
}

// ───── POST /applyInbounds ─────
//
// Panel pushes the FULL set of enabled inbounds bound to this node. Slice 24:
// replaces the env-var workflow (XRAY_REALITY_*, /etc/hysteria/config.yaml
// hand-edits) caught as friction during the 2026-05-06 VPS test.
//
// The Config field is intentionally raw JSON: each adapter decodes only the
// shape that matches its protocol. Keeps the dto layer protocol-agnostic and
// avoids forcing every node-agent build to know every protocol's schema.

type InboundDto struct {
	ID       string          `json:"id"`
	Name     string          `json:"name"`
	Protocol ProtocolName    `json:"protocol"`
	Port     int             `json:"port"`
	Config   json.RawMessage `json:"config"`
}

type ApplyInboundsRequest struct {
	Inbounds []InboundDto `json:"inbounds"`
}

type ApplyInboundsResponse struct {
	OK      bool `json:"ok"`
	Applied int  `json:"applied"`
	Skipped int  `json:"skipped"`
}

// ───── POST /removeUser ─────

type RemoveUserRequest struct {
	UserID string `json:"userId"`
}

type RemoveUserResponse struct {
	OK bool `json:"ok"`
}

// ───── GET /stats ─────

type UserStats struct {
	UserID   string `json:"userId"`
	BytesIn  int64  `json:"bytesIn"`
	BytesOut int64  `json:"bytesOut"`
}

type GetStatsResponse struct {
	Users         []UserStats `json:"users"`
	Uptime        int64       `json:"uptime"`
	TotalBytesIn  int64       `json:"totalBytesIn"`
	TotalBytesOut int64       `json:"totalBytesOut"`
	// Cumulative=true means Users[] counters are cumulative-since-core-start and
	// the panel must compute deltas against its stored snapshot. Absent/false
	// keeps the legacy "already-deltas" interpretation for older agents. #5.
	Cumulative bool `json:"cumulative,omitempty"`
}

// ───── GET /healthz ─────

type CoreStatus struct {
	Name    ProtocolName `json:"name"`
	Running bool         `json:"running"`
}

type HealthcheckResponse struct {
	Status string       `json:"status"`
	Cores  []CoreStatus `json:"cores"`
}

// ───── GET /metrics ─────
//
// Host-level CPU / memory / disk for the VPS the node-agent runs on. Polled
// by the panel every 15s and cached in Redis with TTL 60s, so the dashboard
// can show per-node load without paying mTLS round-trip on every page open.

type CPUMetricsDto struct {
	UsagePercent float64 `json:"usagePercent"`
	LoadAvg1     float64 `json:"loadAvg1"`
	LoadAvg5     float64 `json:"loadAvg5"`
	LoadAvg15    float64 `json:"loadAvg15"`
	Cores        int     `json:"cores"`
}

type MemoryMetricsDto struct {
	TotalBytes     uint64  `json:"totalBytes"`
	AvailableBytes uint64  `json:"availableBytes"`
	UsedBytes      uint64  `json:"usedBytes"`
	UsedPercent    float64 `json:"usedPercent"`
}

type DiskMetricsDto struct {
	Path        string  `json:"path"`
	TotalBytes  uint64  `json:"totalBytes"`
	UsedBytes   uint64  `json:"usedBytes"`
	UsedPercent float64 `json:"usedPercent"`
}

type HostMetricsResponse struct {
	CPU           CPUMetricsDto    `json:"cpu"`
	Memory        MemoryMetricsDto `json:"memory"`
	Disk          DiskMetricsDto   `json:"disk"`
	UptimeSeconds int64            `json:"uptimeSeconds"`
	CollectedAt   string           `json:"collectedAt"`
}

// ───── Common error shape ─────

type ErrorResponse struct {
	Error   string `json:"error"`
	Message string `json:"message"`
}

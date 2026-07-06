// Package metrics collects host system metrics (CPU / memory / disk) on Linux
// without external dependencies. Reads /proc/stat and /proc/meminfo directly,
// uses syscall.Statfs for the filesystem.
//
// Production target is Linux VPS. The Windows build supplies a stub via
// metrics_windows.go that returns zero values, keeps `go build ./...` green
// on dev laptops without dragging in OS-specific dependencies.
package metrics

import (
	"sync"
	"time"
)

// HostMetrics is the full snapshot returned by the node-agent on /metrics.
// All bytes are in raw bytes; CPU% is 0..100.
type HostMetrics struct {
	CPU    CPUMetrics    `json:"cpu"`
	Memory MemoryMetrics `json:"memory"`
	Disk   DiskMetrics   `json:"disk"`
	// UptimeSeconds is how long the node-agent process has been running.
	UptimeSeconds int64 `json:"uptimeSeconds"`
	// CollectedAt is the wall-clock instant the snapshot was assembled.
	CollectedAt time.Time `json:"collectedAt"`
}

type CPUMetrics struct {
	// UsagePercent across all cores between two /proc/stat snapshots taken by
	// the previous call to Collect(). 0 on the first call.
	UsagePercent float64 `json:"usagePercent"`
	// LoadAvg1/5/15 from /proc/loadavg.
	LoadAvg1  float64 `json:"loadAvg1"`
	LoadAvg5  float64 `json:"loadAvg5"`
	LoadAvg15 float64 `json:"loadAvg15"`
	Cores     int     `json:"cores"`
}

type MemoryMetrics struct {
	TotalBytes     uint64  `json:"totalBytes"`
	AvailableBytes uint64  `json:"availableBytes"`
	UsedBytes      uint64  `json:"usedBytes"`
	UsedPercent    float64 `json:"usedPercent"`
}

type DiskMetrics struct {
	Path        string  `json:"path"`
	TotalBytes  uint64  `json:"totalBytes"`
	UsedBytes   uint64  `json:"usedBytes"`
	UsedPercent float64 `json:"usedPercent"`
}

// Collector keeps a CPU snapshot between calls so the second call onward can
// report a non-zero usage percent. Safe for concurrent Collect() calls.
type Collector struct {
	startedAt time.Time
	diskPath  string

	mu       sync.Mutex
	lastCPU  *cpuTimes
	lastSeen time.Time
}

type cpuTimes struct {
	idle  uint64
	total uint64
}

// New creates a Collector. `diskPath` is the filesystem to report (typically
// "/", gives the rootfs of the node).
func New(diskPath string) *Collector {
	if diskPath == "" {
		diskPath = "/"
	}
	return &Collector{
		startedAt: time.Now(),
		diskPath:  diskPath,
	}
}

// Collect builds a snapshot. Per-section errors are non-fatal: we still
// return a partial snapshot so the panel UI can render whatever's available.
// Only when *every* section fails do we propagate an error.
func (c *Collector) Collect() (HostMetrics, error) {
	now := time.Now()

	cpu, errCPU := c.collectCPU()
	mem, errMem := readMemInfo()
	disk, errDisk := statDisk(c.diskPath)

	m := HostMetrics{
		CPU:           cpu,
		Memory:        mem,
		Disk:          disk,
		UptimeSeconds: int64(now.Sub(c.startedAt).Seconds()),
		CollectedAt:   now,
	}

	if errCPU != nil && errMem != nil && errDisk != nil {
		return m, errCPU
	}
	return m, nil
}

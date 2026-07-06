//go:build linux || darwin

package metrics

import (
	"bufio"
	"fmt"
	"os"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
)

func (c *Collector) collectCPU() (CPUMetrics, error) {
	cores := runtime.NumCPU()
	la1, la5, la15, _ := readLoadAvg()

	cm := CPUMetrics{Cores: cores, LoadAvg1: la1, LoadAvg5: la5, LoadAvg15: la15}

	cur, err := readProcStat()
	if err != nil {
		return cm, err
	}

	c.mu.Lock()
	prev := c.lastCPU
	c.lastCPU = &cur
	c.lastSeen = time.Now()
	c.mu.Unlock()

	if prev == nil {
		return cm, nil
	}
	idleDelta := cur.idle - prev.idle
	totalDelta := cur.total - prev.total
	if totalDelta == 0 {
		return cm, nil
	}
	pct := (1.0 - float64(idleDelta)/float64(totalDelta)) * 100.0
	if pct < 0 {
		pct = 0
	}
	if pct > 100 {
		pct = 100
	}
	cm.UsagePercent = pct
	return cm, nil
}

func readProcStat() (cpuTimes, error) {
	f, err := os.Open("/proc/stat")
	if err != nil {
		return cpuTimes{}, err
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	if !scanner.Scan() {
		return cpuTimes{}, fmt.Errorf("/proc/stat: empty")
	}
	line := scanner.Text()
	if !strings.HasPrefix(line, "cpu ") {
		return cpuTimes{}, fmt.Errorf("/proc/stat: unexpected first line %q", line)
	}
	fields := strings.Fields(line)[1:]
	var total, idle uint64
	for i, f := range fields {
		v, err := strconv.ParseUint(f, 10, 64)
		if err != nil {
			continue
		}
		total += v
		// Field index 3 is `idle`, 4 is `iowait` (treated as idle on most
		// modern systems, see Linux kernel docs).
		if i == 3 || i == 4 {
			idle += v
		}
	}
	return cpuTimes{idle: idle, total: total}, nil
}

func readLoadAvg() (l1, l5, l15 float64, err error) {
	data, err := os.ReadFile("/proc/loadavg")
	if err != nil {
		return 0, 0, 0, err
	}
	fields := strings.Fields(string(data))
	if len(fields) < 3 {
		return 0, 0, 0, fmt.Errorf("/proc/loadavg: unexpected shape %q", string(data))
	}
	l1, _ = strconv.ParseFloat(fields[0], 64)
	l5, _ = strconv.ParseFloat(fields[1], 64)
	l15, _ = strconv.ParseFloat(fields[2], 64)
	return l1, l5, l15, nil
}

func readMemInfo() (MemoryMetrics, error) {
	f, err := os.Open("/proc/meminfo")
	if err != nil {
		return MemoryMetrics{}, err
	}
	defer f.Close()

	values := map[string]uint64{}
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		colon := strings.IndexByte(line, ':')
		if colon < 0 {
			continue
		}
		key := line[:colon]
		rest := strings.TrimSpace(line[colon+1:])
		fields := strings.Fields(rest)
		if len(fields) == 0 {
			continue
		}
		v, err := strconv.ParseUint(fields[0], 10, 64)
		if err != nil {
			continue
		}
		// Default unit in /proc/meminfo is kB.
		values[key] = v * 1024
	}

	total := values["MemTotal"]
	avail := values["MemAvailable"]
	if avail == 0 {
		// Fallback for older kernels where MemAvailable is missing.
		avail = values["MemFree"] + values["Buffers"] + values["Cached"]
	}
	used := total
	if avail < total {
		used = total - avail
	}
	pct := 0.0
	if total > 0 {
		pct = float64(used) / float64(total) * 100.0
	}
	return MemoryMetrics{
		TotalBytes:     total,
		AvailableBytes: avail,
		UsedBytes:      used,
		UsedPercent:    pct,
	}, nil
}

func statDisk(path string) (DiskMetrics, error) {
	var st syscall.Statfs_t
	if err := syscall.Statfs(path, &st); err != nil {
		return DiskMetrics{Path: path}, err
	}
	bsize := uint64(st.Bsize)
	total := bsize * uint64(st.Blocks)
	free := bsize * uint64(st.Bavail)
	used := uint64(0)
	if total > free {
		used = total - free
	}
	pct := 0.0
	if total > 0 {
		pct = float64(used) / float64(total) * 100.0
	}
	return DiskMetrics{
		Path:        path,
		TotalBytes:  total,
		UsedBytes:   used,
		UsedPercent: pct,
	}, nil
}

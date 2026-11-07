// Command snapshot-probe answers one question ahead of the subscription role:
// how much memory and how many bytes on the wire does a snapshot of N users take.
// It reads users as CSV (scripts/loadstand/snapshot-users.sql writes them), holds
// them in a compact record with a lookup by token hash, and prints the live heap
// and the size of the same records as gzipped NDJSON. The record is a stand-in
// for a format not settled yet, so the numbers are an order of magnitude.
package main

import (
	"compress/gzip"
	"crypto/sha256"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"runtime"
	"strconv"
	"strings"
	"time"
)

type record struct {
	id        [16]byte
	xrayUUID  [16]byte
	tokenHash [32]byte
	expireAt  int64
	limit     int64
	hysteria  string
	naive     string
	awgPublic string
	shortID   string
	username  string
	status    uint8
	squad     uint16
}

// wireRecord is the same data as the snapshot stream would carry it.
type wireRecord struct {
	ID        string `json:"id"`
	XrayUUID  string `json:"xrayUuid"`
	TokenHash string `json:"tokenHash"`
	ExpireAt  int64  `json:"expireAt"`
	Limit     int64  `json:"limit"`
	Hysteria  string `json:"hysteria"`
	Naive     string `json:"naive"`
	AwgPublic string `json:"awgPublic"`
	ShortID   string `json:"shortId"`
	Username  string `json:"username"`
	Status    uint8  `json:"status"`
	Squad     uint16 `json:"squad"`
}

func main() {
	if err := run(os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(in io.Reader, out io.Writer) error {
	started := time.Now()
	records, err := readRecords(in)
	if err != nil {
		return err
	}
	byToken := make(map[[32]byte]int32, len(records))
	for i := range records {
		byToken[records[i].tokenHash] = int32(i)
	}
	loaded := time.Since(started)

	runtime.GC()
	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)

	raw, gz, err := wireSize(records)
	if err != nil {
		return err
	}
	runtime.KeepAlive(byToken)
	fmt.Fprintf(out, "users=%d heap_mb=%.1f wire_mb=%.1f wire_gzip_mb=%.1f load_ms=%d\n",
		len(records), float64(mem.HeapAlloc)/1e6, float64(raw)/1e6, float64(gz)/1e6, loaded.Milliseconds())
	return nil
}

// readRecords reads the columns in the order of snapshot-users.sql. Strings are
// cloned so a record does not pin the reader's whole line.
func readRecords(in io.Reader) ([]record, error) {
	r := csv.NewReader(in)
	r.FieldsPerRecord = 12
	r.ReuseRecord = true
	var records []record
	statuses := map[string]uint8{}
	for {
		row, err := r.Read()
		if errors.Is(err, io.EOF) {
			return records, nil
		}
		if err != nil {
			return nil, err
		}
		id, err := parseUUID(row[0])
		if err != nil {
			return nil, err
		}
		xray, err := parseUUID(row[1])
		if err != nil {
			return nil, err
		}
		expire, _ := strconv.ParseInt(row[3], 10, 64)
		limit, _ := strconv.ParseInt(row[4], 10, 64)
		squad, _ := strconv.ParseUint(row[11], 10, 16)
		status, known := statuses[row[10]]
		if !known {
			status = uint8(len(statuses))
			statuses[strings.Clone(row[10])] = status
		}
		records = append(records, record{
			id:        id,
			xrayUUID:  xray,
			tokenHash: sha256.Sum256([]byte(row[2])),
			expireAt:  expire,
			limit:     limit,
			hysteria:  strings.Clone(row[5]),
			naive:     strings.Clone(row[6]),
			awgPublic: strings.Clone(row[7]),
			shortID:   strings.Clone(row[8]),
			username:  strings.Clone(row[9]),
			status:    status,
			squad:     uint16(squad),
		})
	}
}

func parseUUID(s string) ([16]byte, error) {
	var out [16]byte
	clean := strings.ReplaceAll(s, "-", "")
	if len(clean) != 32 {
		return out, fmt.Errorf("not a uuid: %q", s)
	}
	_, err := hex.Decode(out[:], []byte(clean))
	return out, err
}

func wireSize(records []record) (raw, gz int64, err error) {
	var zipped countingWriter
	zw := gzip.NewWriter(&zipped)
	plain := countingWriter{next: zw}
	enc := json.NewEncoder(&plain)
	for i := range records {
		rec := &records[i]
		if err := enc.Encode(wireRecord{
			ID:        hex.EncodeToString(rec.id[:]),
			XrayUUID:  hex.EncodeToString(rec.xrayUUID[:]),
			TokenHash: hex.EncodeToString(rec.tokenHash[:]),
			ExpireAt:  rec.expireAt,
			Limit:     rec.limit,
			Hysteria:  rec.hysteria,
			Naive:     rec.naive,
			AwgPublic: rec.awgPublic,
			ShortID:   rec.shortID,
			Username:  rec.username,
			Status:    rec.status,
			Squad:     rec.squad,
		}); err != nil {
			return 0, 0, err
		}
	}
	if err := zw.Close(); err != nil {
		return 0, 0, err
	}
	return plain.n, zipped.n, nil
}

type countingWriter struct {
	next io.Writer
	n    int64
}

func (w *countingWriter) Write(p []byte) (int, error) {
	w.n += int64(len(p))
	if w.next == nil {
		return len(p), nil
	}
	return w.next.Write(p)
}

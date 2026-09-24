// Package geo keeps the geo directory: the list files the panel lays out for
// xray (`.dat`) and for the chain (rule-set JSON), and nothing else. Contract:
// docs/plan/geo-contract.md sections 1 to 3.
package geo

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/icecompany-tech/iceslab/apps/node/internal/dto"
)

// DefaultDir is where the files live. Inside /etc/iceslab-node, which the
// agent's unit already may write.
const DefaultDir = "/etc/iceslab-node/geo"

// MaxFileBytes is the ceiling of one file, the panel's GEO_FILE_MAX_BYTES.
const MaxFileBytes = 64 << 20

// assetName is GEO_ASSET_NAME in packages/shared/src/geo.ts, character for
// character; contract-mirror.test.ts holds the two equal. Nothing with a
// slash, a leading dot or `..` can match, so a name is always a file directly
// in the directory, and the built-in names stay the ones xray looks up.
var assetName = regexp.MustCompile(`^(geosite\.dat|geoip\.dat|iceslab-[a-z0-9-]{1,32}\.dat|iceslab-[a-z0-9-]{1,32}\.[a-z0-9@!_-]{1,64}\.json)$`)

// ValidName says whether name is one the panel may lay out here.
func ValidName(name string) bool { return assetName.MatchString(name) }

const prevSuffix = ".prev"

// ErrTooLarge: the body ran past MaxFileBytes.
var ErrTooLarge = errors.New("file exceeds the ceiling")

// ShaMismatchError: the body is not the file the panel meant.
type ShaMismatchError struct{ Expected, Got string }

func (e *ShaMismatchError) Error() string {
	return fmt.Sprintf("sha256 of the body is %s, expected %s", e.Got, e.Expected)
}

// IsNoSpace says the disk is full.
func IsNoSpace(err error) bool { return errors.Is(err, syscall.ENOSPC) }

type hashed struct {
	size int64
	mod  time.Time
	sha  string
}

// Store is the directory plus a cache of sha256 by size and mtime, so a
// healthcheck every 30 seconds does not read megabytes each time (ARCH 24.09,
// the same idea as core.VersionProbe).
type Store struct {
	Dir string

	mu    sync.Mutex
	cache map[string]hashed
}

func NewStore(dir string) *Store {
	return &Store{Dir: dir, cache: map[string]hashed{}}
}

// List returns the files under a valid name, sorted, with their sha256. A
// missing directory is an empty list: nothing was laid out yet.
func (s *Store) List() ([]dto.GeoFileDto, error) {
	entries, err := os.ReadDir(s.Dir)
	if err != nil {
		if os.IsNotExist(err) {
			return []dto.GeoFileDto{}, nil
		}
		return nil, err
	}
	out := []dto.GeoFileDto{}
	for _, e := range entries {
		if !e.Type().IsRegular() || !ValidName(e.Name()) {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		sha, err := s.shaOf(e.Name(), info)
		if err != nil {
			return nil, err
		}
		out = append(out, dto.GeoFileDto{Name: e.Name(), Sha256: sha, Size: info.Size()})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

func (s *Store) shaOf(name string, info os.FileInfo) (string, error) {
	s.mu.Lock()
	c, ok := s.cache[name]
	s.mu.Unlock()
	if ok && c.size == info.Size() && c.mod.Equal(info.ModTime()) {
		return c.sha, nil
	}
	f, err := os.Open(filepath.Join(s.Dir, name))
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	sha := hex.EncodeToString(h.Sum(nil))
	s.mu.Lock()
	s.cache[name] = hashed{size: info.Size(), mod: info.ModTime(), sha: sha}
	s.mu.Unlock()
	return sha, nil
}

// Missing names the files of want this directory does not hold with the
// sha256 the push expects. Empty means the push may be applied.
func (s *Store) Missing(want []dto.NodeGeoFile) ([]string, error) {
	have, err := s.List()
	if err != nil {
		return nil, err
	}
	sha := make(map[string]string, len(have))
	for _, f := range have {
		sha[f.Name] = f.Sha256
	}
	missing := []string{}
	for _, f := range want {
		if sha[f.Name] != strings.ToLower(f.Sha256) {
			missing = append(missing, f.Name)
		}
	}
	return missing, nil
}

/*
Put writes one file from body, refusing it unless its sha256 is wantSha.

The body goes to a temporary file in the same directory, hashed on the way;
only a match replaces anything, by a rename, so no reader ever sees half a
file. A `.dat` that is replaced is kept as `<name>.prev`, the hand rollback of
geo-contract.md section 2.

The rename is also right for a rule-set the chain's sing-box is reading: it
watches the file (route/rule/rule_set_local.go:64-69 in 1.13.14, fswatch on
the path, reloadFile on every event), and on Linux a rename over the file
reloads it every time, back and forth, while a broken replacement is logged
("reload rule-set <tag>: ...") and the previous set stays in force. Measured
24.09 with the pinned linux-amd64 build, rename(2) through `mv -f`, a mixed
inbound and a rule on 127.0.0.1: 200, 502, 200, 200 after garbage, 502.
*/
func (s *Store) Put(name string, body io.Reader, wantSha string) (dto.GeoFileDto, error) {
	if !ValidName(name) {
		return dto.GeoFileDto{}, fmt.Errorf("%q is not a geo file name", name)
	}
	if err := os.MkdirAll(s.Dir, 0o755); err != nil {
		return dto.GeoFileDto{}, err
	}
	tmp, err := os.CreateTemp(s.Dir, ".put-*")
	if err != nil {
		return dto.GeoFileDto{}, err
	}
	tmpName := tmp.Name()
	keep := false
	defer func() {
		if !keep {
			_ = os.Remove(tmpName)
		}
	}()

	h := sha256.New()
	n, err := io.Copy(io.MultiWriter(tmp, h), io.LimitReader(body, MaxFileBytes+1))
	if err == nil && n > MaxFileBytes {
		err = ErrTooLarge
	}
	if err == nil {
		err = tmp.Sync()
	}
	if cerr := tmp.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		return dto.GeoFileDto{}, err
	}
	got := hex.EncodeToString(h.Sum(nil))
	if want := strings.ToLower(wantSha); got != want {
		return dto.GeoFileDto{}, &ShaMismatchError{Expected: want, Got: got}
	}
	if err := os.Chmod(tmpName, 0o644); err != nil {
		return dto.GeoFileDto{}, err
	}

	final := filepath.Join(s.Dir, name)
	if strings.HasSuffix(name, ".dat") {
		if _, err := os.Stat(final); err == nil {
			if err := os.Rename(final, final+prevSuffix); err != nil {
				return dto.GeoFileDto{}, err
			}
		}
	}
	if err := os.Rename(tmpName, final); err != nil {
		return dto.GeoFileDto{}, err
	}
	keep = true
	if err := syncDir(s.Dir); err != nil {
		return dto.GeoFileDto{}, err
	}
	s.mu.Lock()
	delete(s.cache, name)
	s.mu.Unlock()
	return dto.GeoFileDto{Name: name, Sha256: got, Size: n}, nil
}

func syncDir(dir string) error {
	d, err := os.Open(dir)
	if err != nil {
		return err
	}
	defer d.Close()
	return d.Sync()
}

// Retain removes every geo file the applied push did not name, and every
// `.prev` whose file is no longer named. What it leaves is exactly the push
// plus one step back for each named `.dat`. Temporary files of an
// interrupted Put go too, once they are an hour old: a younger one may be a
// Put still running.
//
// The built-in `geosite.dat` and `geoip.dat` are no exception: a node whose
// rules stop naming them loses them, and xray there looks in its install
// directory again (common/platform/others.go:19-24). Nothing reads them then.
func (s *Store) Retain(named []string) error {
	keep := make(map[string]bool, len(named))
	for _, n := range named {
		keep[n] = true
	}
	entries, err := os.ReadDir(s.Dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	var errs []error
	for _, e := range entries {
		name := e.Name()
		base := strings.TrimSuffix(name, prevSuffix)
		if strings.HasPrefix(name, ".put-") {
			if info, err := e.Info(); err != nil || time.Since(info.ModTime()) < time.Hour {
				continue
			}
		} else if ours := ValidName(name) || (base != name && ValidName(base)); !ours || keep[name] || (base != name && keep[base]) {
			continue
		}
		if err := os.Remove(filepath.Join(s.Dir, name)); err != nil && !os.IsNotExist(err) {
			errs = append(errs, err)
		}
		s.mu.Lock()
		delete(s.cache, name)
		s.mu.Unlock()
	}
	return errors.Join(errs...)
}

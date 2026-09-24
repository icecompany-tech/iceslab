package geo

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"sort"
	"testing"

	"github.com/icecompany-tech/iceslab/apps/node/internal/dto"
)

// The geo directory. Runs on Linux: Put syncs the directory, which Windows
// refuses (CLAUDE.local.md, the atomicfile note).

func sum(b []byte) string {
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}

func names(t *testing.T, dir string) []string {
	t.Helper()
	es, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	out := []string{}
	for _, e := range es {
		out = append(out, e.Name())
	}
	sort.Strings(out)
	return out
}

func TestOnlyTheNamesThePanelLaysOut(t *testing.T) {
	for name, ok := range map[string]bool{
		"geosite.dat":                         true,
		"geoip.dat":                           true,
		"iceslab-mylist.dat":                  true,
		"iceslab-mylist.category-ads.json":    true,
		"iceslab-mylist.geolocation-!cn.json": true,
		"iceslab-mylist.google@ads.json":      true,
		"../geosite.dat":                      false,
		"geosite.dat.prev":                    false,
		"iceslab-MyList.dat":                  false,
		"mylist.dat":                          false,
		".put-123":                            false,
		"iceslab-a.b/c.json":                  false,
		"iceslab-a.dat/../../x":               false,
	} {
		if ValidName(name) != ok {
			t.Errorf("ValidName(%q) = %v, want %v", name, !ok, ok)
		}
	}
}

func TestPutTakesOnlyTheFileThePanelMeant(t *testing.T) {
	s := NewStore(t.TempDir())
	body := []byte("the list")

	if _, err := s.Put("iceslab-mylist.dat", bytes.NewReader(body), sum([]byte("another list"))); err == nil {
		t.Fatal("a body with another sha256 was taken")
	} else {
		var m *ShaMismatchError
		if !errors.As(err, &m) || m.Got != sum(body) {
			t.Fatalf("want a ShaMismatchError naming the body's sha, got %v", err)
		}
	}
	if got := names(t, s.Dir); len(got) != 0 {
		t.Fatalf("a refused body left files behind: %v", got)
	}

	f, err := s.Put("iceslab-mylist.dat", bytes.NewReader(body), sum(body))
	if err != nil {
		t.Fatal(err)
	}
	if f != (dto.GeoFileDto{Name: "iceslab-mylist.dat", Sha256: sum(body), Size: int64(len(body))}) {
		t.Errorf("Put answered %+v", f)
	}
	list, err := s.List()
	if err != nil || len(list) != 1 || list[0].Sha256 != sum(body) {
		t.Fatalf("List after Put: %+v %v", list, err)
	}

	if _, err := s.Put("../escape.dat", bytes.NewReader(body), sum(body)); err == nil {
		t.Fatal("a name outside the directory was taken")
	}
}

func TestPutRefusesABodyPastTheCeiling(t *testing.T) {
	s := NewStore(t.TempDir())
	_, err := s.Put("geoip.dat", io.LimitReader(zeros{}, MaxFileBytes+1), sum(nil))
	if !errors.Is(err, ErrTooLarge) {
		t.Fatalf("want ErrTooLarge, got %v", err)
	}
	if got := names(t, s.Dir); len(got) != 0 {
		t.Fatalf("the refused body is still there: %v", got)
	}
}

type zeros struct{}

func (zeros) Read(p []byte) (int, error) {
	clear(p)
	return len(p), nil
}

func TestAReplacedDatKeepsOneStepBack(t *testing.T) {
	s := NewStore(t.TempDir())
	v1, v2 := []byte("version one"), []byte("version two")
	if _, err := s.Put("geosite.dat", bytes.NewReader(v1), sum(v1)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Put("geosite.dat", bytes.NewReader(v2), sum(v2)); err != nil {
		t.Fatal(err)
	}
	prev, err := os.ReadFile(filepath.Join(s.Dir, "geosite.dat.prev"))
	if err != nil || !bytes.Equal(prev, v1) {
		t.Fatalf("geosite.dat.prev = %q, %v; want the first version", prev, err)
	}
	// And the cache did not answer with the old sha for the new content.
	list, _ := s.List()
	if len(list) != 1 || list[0].Sha256 != sum(v2) {
		t.Fatalf("List after a replace: %+v", list)
	}
}

func TestTheShaIsReadAgainWhenTheFileChangesBehindTheStore(t *testing.T) {
	s := NewStore(t.TempDir())
	v1 := []byte("first")
	if _, err := s.Put("geoip.dat", bytes.NewReader(v1), sum(v1)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.List(); err != nil {
		t.Fatal(err)
	}
	v2 := []byte("second, and longer")
	if err := os.WriteFile(filepath.Join(s.Dir, "geoip.dat"), v2, 0o644); err != nil {
		t.Fatal(err)
	}
	list, _ := s.List()
	if list[0].Sha256 != sum(v2) {
		t.Fatal("the cache answered for a file that changed size")
	}
}

func TestMissingNamesWhatIsAbsentOrDifferent(t *testing.T) {
	s := NewStore(t.TempDir())
	b := []byte("here")
	if _, err := s.Put("geosite.dat", bytes.NewReader(b), sum(b)); err != nil {
		t.Fatal(err)
	}
	missing, err := s.Missing([]dto.NodeGeoFile{
		{Name: "geosite.dat", Sha256: sum(b)},
		{Name: "geoip.dat", Sha256: sum(b)},
		{Name: "iceslab-x.dat", Sha256: sum([]byte("x"))},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(missing) != 2 || missing[0] != "geoip.dat" || missing[1] != "iceslab-x.dat" {
		t.Fatalf("Missing = %v", missing)
	}
	// Same name, another sha: not the file the push stands on.
	missing, _ = s.Missing([]dto.NodeGeoFile{{Name: "geosite.dat", Sha256: sum([]byte("other"))}})
	if len(missing) != 1 {
		t.Fatalf("a changed file was not missing: %v", missing)
	}
}

func TestRetainLeavesThePushAndOneStepBack(t *testing.T) {
	s := NewStore(t.TempDir())
	put := func(name, body string) {
		t.Helper()
		if _, err := s.Put(name, bytes.NewReader([]byte(body)), sum([]byte(body))); err != nil {
			t.Fatal(err)
		}
	}
	put("geosite.dat", "a")
	put("geosite.dat", "b") // leaves geosite.dat.prev
	put("geoip.dat", "c")
	put("iceslab-old.dat", "d")
	put("iceslab-old.dat", "e") // leaves iceslab-old.dat.prev
	put("iceslab-mine.ads.json", "f")
	// Not ours: never touched.
	if err := os.WriteFile(filepath.Join(s.Dir, "README"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	if err := s.Retain([]string{"geosite.dat", "iceslab-mine.ads.json"}); err != nil {
		t.Fatal(err)
	}
	want := []string{"README", "geosite.dat", "geosite.dat.prev", "iceslab-mine.ads.json"}
	if got := names(t, s.Dir); !equal(got, want) {
		t.Fatalf("after Retain: %v, want %v", got, want)
	}

	// The built-ins go like any other file once nothing names them.
	if err := s.Retain(nil); err != nil {
		t.Fatal(err)
	}
	if got := names(t, s.Dir); !equal(got, []string{"README"}) {
		t.Fatalf("after Retain(nil): %v", got)
	}
}

func equal(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

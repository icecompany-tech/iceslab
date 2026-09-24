package server

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/icecompany-tech/iceslab/apps/node/internal/core"
	"github.com/icecompany-tech/iceslab/apps/node/internal/dto"
	"github.com/icecompany-tech/iceslab/apps/node/internal/geo"
	"github.com/icecompany-tech/iceslab/apps/node/internal/payload"
)

/*
Phase 9.2: the geo directory over the wire. The panel lays files out with PUT
/assets/<name>, a push names them in `geo`, and nothing of a push stands until
every named file is here with its sha256. Linux only: the store syncs its
directory, which Windows refuses.
*/

// geoCore is a fake xray that notes geo fingerprints and flushes.
type geoCore struct {
	fakeAdapter
	notes   []string
	flushes int
}

func (c *geoCore) NoteGeo(fp string)                { c.notes = append(c.notes, fp) }
func (c *geoCore) FlushGeo(_ context.Context) error { c.flushes++; return nil }

var _ core.GeoReceiver = (*geoCore)(nil)

func hexSum(b []byte) string {
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}

func newGeoServer(t *testing.T, store string, adapters ...core.CoreAdapter) (*Server, *geo.Store) {
	t.Helper()
	g := geo.NewStore(t.TempDir())
	s, err := New(Config{
		Logger:            slog.New(slog.NewTextHandler(io.Discard, nil)),
		Payload:           &payload.Payload{},
		Adapters:          adapters,
		InboundsStorePath: store,
		Geo:               g,
	})
	if err != nil {
		t.Fatal(err)
	}
	return s, g
}

func do(s *Server, method, path string, body []byte, header map[string]string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, bytes.NewReader(body))
	for k, v := range header {
		req.Header.Set(k, v)
	}
	rr := httptest.NewRecorder()
	s.routes().ServeHTTP(rr, req)
	return rr
}

func putAsset(t *testing.T, s *Server, name string, body []byte) {
	t.Helper()
	if rr := do(s, http.MethodPut, "/assets/"+name, body, map[string]string{"X-Content-Sha256": hexSum(body)}); rr.Code != http.StatusOK {
		t.Fatalf("PUT %s: %d %s", name, rr.Code, rr.Body)
	}
}

func TestAssetsTakeOnlyTheFileThePanelMeant(t *testing.T) {
	s, _ := newGeoServer(t, "")
	body := []byte("a geo list")

	cases := []struct {
		path, sha string
		code      int
		errCode   string
	}{
		{"/assets/iceslab-Upper.dat", hexSum(body), 400, "ASSET_NAME_INVALID"},
		{"/assets/notours.dat", hexSum(body), 400, "ASSET_NAME_INVALID"},
		{"/assets/geosite.dat", "", 400, "ASSET_SHA_REQUIRED"},
		{"/assets/geosite.dat", hexSum([]byte("other")), 422, "ASSET_SHA_MISMATCH"},
	}
	for _, c := range cases {
		rr := do(s, http.MethodPut, c.path, body, map[string]string{"X-Content-Sha256": c.sha})
		var e map[string]string
		_ = json.NewDecoder(rr.Body).Decode(&e)
		if rr.Code != c.code || e["error"] != c.errCode {
			t.Errorf("PUT %s: %d %v, want %d %s", c.path, rr.Code, e, c.code, c.errCode)
		}
	}

	putAsset(t, s, "geosite.dat", body)
	rr := do(s, http.MethodGet, "/assets", nil, nil)
	var list dto.GeoAssetsResponse
	if err := json.NewDecoder(rr.Body).Decode(&list); err != nil {
		t.Fatal(err)
	}
	if len(list.Files) != 1 || list.Files[0] != (dto.GeoFileDto{Name: "geosite.dat", Sha256: hexSum(body), Size: int64(len(body))}) {
		t.Fatalf("GET /assets: %+v", list)
	}
}

func TestAnAgentWithoutAGeoDirectorySaysSo(t *testing.T) {
	s := newServerWith(t)
	if rr := do(s, http.MethodGet, "/assets", nil, nil); rr.Code != http.StatusNotFound {
		t.Errorf("GET /assets: %d, want 404 (the panel reads it as an agent older than geo)", rr.Code)
	}
	if healthOf(t, s).Geo != nil {
		t.Error("an agent with no geo directory reported one")
	}
}

func geoPush(files ...dto.NodeGeoFile) []byte {
	b, _ := json.Marshal(dto.ApplyInboundsRequest{
		Inbounds: []dto.InboundDto{inboundFor("xray", "xray")},
		Geo:      &dto.NodeGeo{Version: "v1", Files: files},
	})
	return b
}

func TestAPushNamingAFileThatIsNotHereIsRefusedWholeAndNotWrittenDown(t *testing.T) {
	store := filepath.Join(t.TempDir(), "inbounds.json")
	xray := &geoCore{fakeAdapter: fakeAdapter{name: "xray", engine: "xray"}}
	s, _ := newGeoServer(t, store, xray)
	here := []byte("the list")
	putAsset(t, s, "geosite.dat", here)

	rr := do(s, http.MethodPost, "/applyInbounds", geoPush(
		dto.NodeGeoFile{Name: "geosite.dat", Sha256: hexSum(here), Reader: "xray"},
		dto.NodeGeoFile{Name: "iceslab-mine.dat", Sha256: hexSum([]byte("x")), Reader: "xray"},
	), nil)
	var refusal dto.GeoMissingResponse
	_ = json.NewDecoder(rr.Body).Decode(&refusal)
	if rr.Code != http.StatusConflict || refusal.Error != "GEO_MISSING" || len(refusal.Files) != 1 || refusal.Files[0] != "iceslab-mine.dat" {
		t.Fatalf("got %d %+v, want 409 GEO_MISSING [iceslab-mine.dat]", rr.Code, refusal)
	}
	if len(xray.applied) != 0 || len(xray.notes) != 0 {
		t.Fatal("a refused push reached the core")
	}
	if _, err := os.Stat(store); !os.IsNotExist(err) {
		t.Fatal("a refused push was written down as the node's last push")
	}
}

func TestAnAppliedPushNotesTheFilesFlushesAndClearsTheRest(t *testing.T) {
	xray := &geoCore{fakeAdapter: fakeAdapter{name: "xray", engine: "xray"}}
	s, g := newGeoServer(t, "", xray)
	site, mine, chainRS := []byte("site"), []byte("mine"), []byte(`{"version":2,"rules":[]}`)
	putAsset(t, s, "geosite.dat", site)
	putAsset(t, s, "iceslab-mine.dat", mine)
	putAsset(t, s, "iceslab-mine.ads.json", chainRS)
	putAsset(t, s, "iceslab-gone.dat", []byte("gone"))

	rr := do(s, http.MethodPost, "/applyInbounds", geoPush(
		dto.NodeGeoFile{Name: "iceslab-mine.dat", Sha256: hexSum(mine), Reader: "xray"},
		dto.NodeGeoFile{Name: "geosite.dat", Sha256: hexSum(site), Reader: "xray"},
		dto.NodeGeoFile{Name: "iceslab-mine.ads.json", Sha256: hexSum(chainRS), Reader: "chain"},
	), nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("push: %d %s", rr.Code, rr.Body)
	}
	// Only what xray reads, by name, in a stable order.
	want := "geosite.dat=" + hexSum(site) + ",iceslab-mine.dat=" + hexSum(mine)
	if len(xray.notes) != 1 || xray.notes[0] != want || xray.flushes != 1 {
		t.Fatalf("notes %v flushes %d, want [%s] and 1", xray.notes, xray.flushes, want)
	}
	list, _ := g.List()
	if len(list) != 3 {
		t.Fatalf("the file the push does not name is still there: %+v", list)
	}

	h := healthOf(t, s)
	if h.Geo == nil || h.Geo.Version == nil || *h.Geo.Version != "v1" || len(h.Geo.Files) != 3 {
		t.Fatalf("healthz geo: %+v", h.Geo)
	}
}

func TestAPushWithoutGeoLeavesTheDirectoryAlone(t *testing.T) {
	xray := &geoCore{fakeAdapter: fakeAdapter{name: "xray", engine: "xray"}}
	s, g := newGeoServer(t, "", xray)
	putAsset(t, s, "geosite.dat", []byte("site"))
	s.applyPush(context.Background(), dto.ApplyInboundsRequest{Inbounds: []dto.InboundDto{inboundFor("xray", "xray")}})
	if list, _ := g.List(); len(list) != 1 {
		t.Fatal("a push from a panel older than geo cleared the directory")
	}
	if len(xray.notes) != 0 || xray.flushes != 0 {
		t.Fatal("a push without geo touched the core's geo")
	}
	if v := healthOf(t, s).Geo; v == nil || v.Version != nil {
		t.Fatalf("before any geo push the version is null and the block is there: %+v", v)
	}
}

func TestAPushRefusedInPartClearsNothing(t *testing.T) {
	xray := &geoCore{fakeAdapter: fakeAdapter{name: "xray", engine: "xray", failOnApply: "core rejected the config"}}
	s, g := newGeoServer(t, "", xray)
	site := []byte("site")
	putAsset(t, s, "geosite.dat", site)
	putAsset(t, s, "iceslab-other.dat", []byte("other"))
	_, failed, _ := s.applyPush(context.Background(), dto.ApplyInboundsRequest{
		Inbounds: []dto.InboundDto{inboundFor("xray", "xray")},
		Geo:      &dto.NodeGeo{Version: "v2", Files: []dto.NodeGeoFile{{Name: "geosite.dat", Sha256: hexSum(site), Reader: "xray"}}},
	})
	if failed == 0 {
		t.Fatal("the fixture push did not fail")
	}
	if list, _ := g.List(); len(list) != 2 {
		t.Fatal("a refused push removed files")
	}
	if v := healthOf(t, s).Geo; v.Version != nil {
		t.Fatalf("a refused push moved the reported version: %v", *v.Version)
	}
	// The core that runs is still told to flush: files it reads may have
	// changed under it whatever the rest of the push did.
	if xray.flushes != 1 {
		t.Fatalf("flushes %d, want 1", xray.flushes)
	}
}

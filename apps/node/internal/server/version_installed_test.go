package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/icecompany-tech/iceslab/apps/node/internal/dto"
)

// versionedAdapter is a core that says whether it is installed and what
// version it answers with.
type versionedAdapter struct {
	fakeAdapter
	installed bool
	version   string
	tools     string
}

func (v *versionedAdapter) Installed() bool      { return v.installed }
func (v *versionedAdapter) CoreVersion() string  { return v.version }
func (v *versionedAdapter) ToolsVersion() string { return v.tools }

// E35, ru-02 25.09: amneziawg reported installed:false with version 1.0.0, the
// DKMS module of an old hand install. A core that is not on the machine has no
// version; one that is keeps reporting it.
func TestAVersionIsReportedOnlyForAnInstalledCore(t *testing.T) {
	srv := newServerWith(t,
		&versionedAdapter{fakeAdapter: fakeAdapter{name: "amneziawg", engine: "amneziawg"}, installed: false, version: "1.0.0", tools: "1.0.20210914"},
		&versionedAdapter{fakeAdapter: fakeAdapter{name: "xray", engine: "xray"}, installed: true, version: "26.3.27"},
	)
	rr := httptest.NewRecorder()
	srv.routes().ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	var resp dto.HealthcheckResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatal(err)
	}
	by := map[string]dto.CoreStatus{}
	for _, c := range resp.Cores {
		by[string(c.Name)] = c
	}
	if awg := by["amneziawg"]; awg.Version != "" || awg.ToolsVersion != "" || awg.Installed == nil || *awg.Installed {
		t.Errorf("not installed, yet: %+v", awg)
	}
	if x := by["xray"]; x.Version != "26.3.27" {
		t.Errorf("an installed core lost its version: %+v", x)
	}
}

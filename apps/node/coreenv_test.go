package main

import (
	"bytes"
	"encoding/base64"
	"strings"
	"testing"
)

// The subcommand's contract with the installer: lines on stdout, warnings on
// stderr, exit 1 only for a payload it cannot read at all.
func TestCoreEnvCommand(t *testing.T) {
	payload := base64.RawURLEncoding.EncodeToString([]byte(
		`{"coreVersions":{"amneziawg-tools":{"version":"1.0.20260618-2","tag":"v1.0.20260618-2",` +
			`"commit":"61e741780e8465a67a7d7fb6cffe14a8a15d624a"},"nginx":{"version":"1","tag":"v1",` +
			`"commit":"61e741780e8465a67a7d7fb6cffe14a8a15d624a"}}}`))
	var out, errOut bytes.Buffer
	if code := runCoreEnv(strings.NewReader(payload+"\n"), &out, &errOut); code != 0 {
		t.Fatalf("exit %d, stderr %s", code, errOut.String())
	}
	want := "AWG_TOOLS_TAG=v1.0.20260618-2\nAWG_TOOLS_SHA=61e741780e8465a67a7d7fb6cffe14a8a15d624a\n"
	if out.String() != want {
		t.Errorf("stdout = %q, want %q", out.String(), want)
	}
	if !strings.Contains(errOut.String(), "nginx: not a component") {
		t.Errorf("stderr = %q", errOut.String())
	}

	out.Reset()
	errOut.Reset()
	if code := runCoreEnv(strings.NewReader("%%%"), &out, &errOut); code != 1 || out.Len() != 0 {
		t.Errorf("unreadable payload: exit %d, stdout %q", code, out.String())
	}
}

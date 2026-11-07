package main

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

// goBuildTarget matches a go build command through its line continuations and
// captures what it builds, the last word of the command.
var goBuildTarget = regexp.MustCompile(`(?m)\bgo build\b(?:[^\n\\]*\\\n)*[^\n]*\s(\S+)\s*$`)

// What keeps this tool out of what operators run: every build that ships names
// the module's root package, and a main package cannot be imported into it. A
// build changed to ./... or ./cmd/... would put it in reach, so this fails first.
func TestShippedBuildsTakeTheRootPackageOnly(t *testing.T) {
	for _, path := range []string{
		"../../../../.github/workflows/release.yml",
		"../../Dockerfile",
		"../../../../scripts/install-iceslab-node.sh",
	} {
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		builds := goBuildTarget.FindAllStringSubmatch(withoutComments(string(raw)), -1)
		if len(builds) == 0 {
			t.Fatalf("%s: no go build found, this guard reads nothing", path)
		}
		for _, build := range builds {
			if build[1] != "." {
				t.Errorf("%s: builds %q, want the root package %q:\n%s", path, build[1], ".", build[0])
			}
		}
	}
}

func withoutComments(text string) string {
	var kept []string
	for _, line := range strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n") {
		if !strings.HasPrefix(strings.TrimSpace(line), "#") {
			kept = append(kept, line)
		}
	}
	return strings.Join(kept, "\n")
}

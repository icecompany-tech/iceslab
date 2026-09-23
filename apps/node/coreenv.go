package main

import (
	"fmt"
	"io"
	"strings"

	"github.com/icecompany-tech/iceslab/apps/node/internal/core"
	"github.com/icecompany-tech/iceslab/apps/node/internal/payload"
)

// runCoreEnv reads a bootstrap payload on stdin and prints the core versions
// the panel chose for this node as KEY=VALUE lines, one pair per component, for
// this machine's arch. The installer takes them as defaults for the bootstrap
// scripts; an explicit env on the machine still wins, and that choice is the
// installer's, not this command's.
//
// Warnings go to stderr and are not failures: a component this agent does not
// know leaves its script on its own pin. Exit 1 only when the payload itself
// cannot be read.
func runCoreEnv(stdin io.Reader, stdout, stderr io.Writer) int {
	raw, err := io.ReadAll(stdin)
	if err != nil {
		fmt.Fprintf(stderr, "core-env: read payload: %v\n", err)
		return 1
	}
	versions, err := payload.DecodeCoreVersions(strings.TrimSpace(string(raw)))
	if err != nil {
		fmt.Fprintf(stderr, "core-env: %v\n", err)
		return 1
	}
	lines, warnings := payload.CoreEnv(versions, core.MachineArch())
	for _, w := range warnings {
		fmt.Fprintf(stderr, "core-env: %s\n", w)
	}
	for _, l := range lines {
		fmt.Fprintln(stdout, l)
	}
	return 0
}

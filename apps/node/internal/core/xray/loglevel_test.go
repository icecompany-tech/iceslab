package xray

import (
	"encoding/json"
	"testing"
)

// What the core writes to disk about every connection, which is a disk-space
// question rather than a taste in verbosity.
//
// At `info` xray logs a line PER CONNECTION. journald mirrors it into syslog,
// and the journald limits our installer sets do not cap syslog at all, so an
// operator's exit node filled its disk with 3 GB of lines nobody had read
// (reported on PR #43, 2026-08-17).
//
// Asserted on the VALUE and not only through the goldens: a golden says the
// render has not changed, which is the opposite of what is wanted the day
// somebody "temporarily" turns the logging back up to chase a bug. This test
// makes that a deliberate edit with a reason next to it.
func TestCoreLogsAtWarning(t *testing.T) {
	blob, err := renderConfig(validInbound(), policyUsers())
	if err != nil {
		t.Fatalf("renderConfig: %v", err)
	}
	var doc struct {
		Log struct {
			Loglevel string `json:"loglevel"`
		} `json:"log"`
	}
	if err := json.Unmarshal(blob, &doc); err != nil {
		t.Fatalf("unmarshal config: %v", err)
	}
	if doc.Log.Loglevel != "warning" {
		t.Fatalf("xray logs at %q; at anything below warning it writes a line per connection, "+
			"journald mirrors it into syslog, and the node fills its own disk", doc.Log.Loglevel)
	}
}

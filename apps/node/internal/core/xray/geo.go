package xray

import "strings"

// geoEntries turns the panel's spelling of an operator's geo set into the file
// xray opens. A rule says `ext:<set>:<tag>` (or `ext-domain:`/`ext-ip:`), the
// panel lays the set out as `iceslab-<set>.dat` (geo-contract.md section 0:
// whoever renders the core's JSON translates). `geosite:` and `geoip:` stay as
// they are: the built-in files carry the names xray looks up.
//
// An entry already naming a `.dat` is left alone, so a config written by hand
// against a file of its own keeps working. Everything else passes through.
func geoEntries(in []string) []string {
	out := make([]string, len(in))
	for i, e := range in {
		out[i] = geoEntry(e)
	}
	return out
}

func geoEntry(e string) string {
	for _, prefix := range []string{"ext:", "ext-domain:", "ext-ip:"} {
		if !strings.HasPrefix(e, prefix) {
			continue
		}
		set, tag, ok := strings.Cut(e[len(prefix):], ":")
		if !ok || set == "" || strings.HasSuffix(set, ".dat") {
			return e
		}
		return prefix + "iceslab-" + set + ".dat:" + tag
	}
	return e
}

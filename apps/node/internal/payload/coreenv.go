package payload

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"
)

// CoreRelease is one release of one core component as the bootstrap payload
// carries it. Mirrors CoreRelease in packages/shared/src/core-versions.ts
// (BootstrapCoreVersions is a map of these by component).
type CoreRelease struct {
	Version string               `json:"version"`
	Tag     string               `json:"tag"`
	Assets  map[string]CoreAsset `json:"assets,omitempty"`
	Commit  string               `json:"commit,omitempty"`
}

// CoreAsset is one release file and the sha256 upstream published for it.
type CoreAsset struct {
	File   string `json:"file"`
	Sha256 string `json:"sha256"`
}

// componentEnv names, per manifest component, the variable prefix its
// bootstrap script reads. The same table as CORE_ENV_PREFIX in
// packages/shared/src/core-versions.ts; core-pins.test.ts in the backend holds
// the two equal. caddy-naive has no pin and no script variable, so it is absent
// here.
var componentEnv = map[string]string{
	"xray":             "XRAY",
	"singbox":          "SINGBOX",
	"hysteria":         "HYSTERIA",
	"amneziawg-module": "AWG_MODULE",
	"amneziawg-tools":  "AWG_TOOLS",
	"mtg":              "MTG",
	"mita":             "MIERU",
}

// What a value may look like before it is handed to a shell. The installer
// reads these lines back as variables, so nothing that is not plainly a
// version, a tag, a sha256 or a commit gets that far, whatever the payload
// said.
var (
	versionShape = regexp.MustCompile(`^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$`)
	tagShape     = regexp.MustCompile(`^[0-9A-Za-z][0-9A-Za-z./+-]{0,127}$`)
	sha256Shape  = regexp.MustCompile(`^[0-9a-f]{64}$`)
	commitShape  = regexp.MustCompile(`^[0-9a-f]{40}$`)
)

// DecodeCoreVersions reads only the coreVersions block of a payload. Unlike
// Decode it asks for nothing else: the installer calls it before the agent's
// identity matters, and a payload from a panel older than the block simply has
// none.
func DecodeCoreVersions(b64url string) (map[string]CoreRelease, error) {
	b64url = strings.TrimSpace(b64url)
	raw, err := base64.RawURLEncoding.DecodeString(b64url)
	if err != nil {
		raw, err = base64.URLEncoding.DecodeString(b64url)
		if err != nil {
			return nil, fmt.Errorf("base64 decode: %w", err)
		}
	}
	var p struct {
		CoreVersions map[string]CoreRelease `json:"coreVersions"`
	}
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, fmt.Errorf("json unmarshal: %w", err)
	}
	return p.CoreVersions, nil
}

// CoreEnv turns the payload's releases into the variables the bootstrap scripts
// read, for this machine's arch: <P>_VERSION and <P>_SHA256 for a release
// binary, <P>_TAG and <P>_SHA for one built from a commit (AmneziaWG).
//
// Always in pairs, because a script takes no version without its checksum.
// Anything it cannot turn into a safe pair (a component this agent does not
// know, a release with no file for this arch, a value of the wrong shape) is a
// warning and no line: the script then installs its own pin, which is the
// right failure for a node whose checkout is older than the panel.
func CoreEnv(versions map[string]CoreRelease, arch string) (lines, warnings []string) {
	components := make([]string, 0, len(versions))
	for c := range versions {
		components = append(components, c)
	}
	sort.Strings(components)

	for _, c := range components {
		r := versions[c]
		prefix, known := componentEnv[c]
		if !known {
			warnings = append(warnings, fmt.Sprintf("%s: not a component this agent knows; its script keeps its own pin", c))
			continue
		}
		switch {
		case r.Commit != "":
			if !tagShape.MatchString(r.Tag) || !commitShape.MatchString(r.Commit) {
				warnings = append(warnings, fmt.Sprintf("%s: tag or commit is not in a form a script may take", c))
				continue
			}
			lines = append(lines, prefix+"_TAG="+r.Tag, prefix+"_SHA="+r.Commit)
		case len(r.Assets) > 0:
			if arch == "" {
				warnings = append(warnings, fmt.Sprintf("%s: this machine's arch has no name in the manifest, so no file can be picked", c))
				continue
			}
			asset, ok := r.Assets[arch]
			if !ok {
				warnings = append(warnings, fmt.Sprintf("%s %s: upstream ships nothing for %s", c, r.Version, arch))
				continue
			}
			if !versionShape.MatchString(r.Version) || !sha256Shape.MatchString(asset.Sha256) {
				warnings = append(warnings, fmt.Sprintf("%s: version or sha256 is not in a form a script may take", c))
				continue
			}
			lines = append(lines, prefix+"_VERSION="+r.Version, prefix+"_SHA256="+asset.Sha256)
		default:
			warnings = append(warnings, fmt.Sprintf("%s: the release names neither files nor a commit", c))
		}
	}
	return lines, warnings
}

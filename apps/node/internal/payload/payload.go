// Package payload decodes the base64url JSON blob the panel issues on
// `POST /api/nodes`. The shape mirrors the panel's NodePayload (see
// `apps/panel-backend/src/modules/keygen/keygen.service.ts`).
package payload

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
)

// Payload is the agent's identity material, issued once at node creation
// and stored on the node-agent host.
//
// Slice 38 fields (PanelURL/NodeID/HeartbeatToken) drive the heartbeat
// self-destruct loop. They're optional in the JSON so older payloads
// (issued before the panel rolled out the column) still decode; agents
// missing these fields simply skip heartbeats.
type Payload struct {
	NodeCertPem    string `json:"nodeCertPem"`
	NodeKeyPem     string `json:"nodeKeyPem"`
	CACertPem      string `json:"caCertPem"`
	PanelURL       string `json:"panelUrl,omitempty"`
	NodeID         string `json:"nodeId,omitempty"`
	HeartbeatToken string `json:"heartbeatToken,omitempty"`
	// Slice S6: SHA-256 fingerprint (lowercase hex, no colons) of the
	// panel-client cert. When present, the agent pins this in its TLS
	// VerifyPeerCertificate hook and rejects any other leaf even if it's
	// CA-signed. Pre-S6 payloads omit the field; agent falls back to
	// CA-only verification.
	PanelClientFingerprint string `json:"panelClientFingerprint,omitempty"`
}

// Decode parses a base64url-encoded JSON Payload. The panel uses
// Node's `Buffer.toString('base64url')` which omits padding, so we
// accept both raw URL-safe and standard URL-safe encodings.
func Decode(b64url string) (*Payload, error) {
	raw, err := base64.RawURLEncoding.DecodeString(b64url)
	if err != nil {
		// Fall back to padded URL-safe in case the source padded the blob.
		raw, err = base64.URLEncoding.DecodeString(b64url)
		if err != nil {
			return nil, fmt.Errorf("base64 decode: %w", err)
		}
	}

	var p Payload
	if err := json.Unmarshal(raw, &p); err != nil {
		return nil, fmt.Errorf("json unmarshal: %w", err)
	}
	if p.NodeCertPem == "" || p.NodeKeyPem == "" || p.CACertPem == "" {
		return nil, errors.New("payload missing required fields")
	}
	return &p, nil
}

// Encode is the inverse of Decode. Useful for tests and tooling.
func Encode(p *Payload) (string, error) {
	raw, err := json.Marshal(p)
	if err != nil {
		return "", fmt.Errorf("json marshal: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

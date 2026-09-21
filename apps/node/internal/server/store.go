package server

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/icecompany-tech/iceslab/apps/node/internal/atomicfile"
	"github.com/icecompany-tech/iceslab/apps/node/internal/dto"
)

// The last push, kept on disk so a node-agent restart does not need the panel.
//
// It used to hold the inbound ARRAY alone, and only the firewall ever read it
// back. Everything else, the cores included, started from nothing: on 2026-09-22
// four agents were restarted, the old process stopped xray cleanly, the new one
// logged "no REALITY key yet, waiting for ApplyInbound from panel" and sat
// there. Two of the four were cascade entries whose push the panel could not
// build (a direction pointed at a deleted node), so nothing ever came, and they
// served nobody for over an hour with `pgrep xray` empty.
//
// So the WHOLE request is stored now, not just the inbounds. Storing only the
// inbounds would have restored the listeners and silently dropped the node's
// routing policy and its resolver, which is the same class of quiet wrong the
// restore exists to end.
//
// ⚠ The old shape is still read: a file written by an agent before this change
// is a bare JSON array. Refusing it would mean a node that restarts during the
// rollout restores nothing, which is exactly the situation being fixed.
func readPushStore(path string) (dto.ApplyInboundsRequest, error) {
	var out dto.ApplyInboundsRequest
	body, err := os.ReadFile(path)
	if err != nil {
		return out, err
	}
	trimmed := bytes.TrimSpace(body)
	if len(trimmed) == 0 {
		return out, fmt.Errorf("empty store")
	}
	if trimmed[0] == '[' {
		// Legacy: the array of inbounds, with no node-level blocks. They stay
		// zero, which is what the node did before those blocks existed.
		var inbounds []dto.InboundDto
		if err := json.Unmarshal(trimmed, &inbounds); err != nil {
			return out, fmt.Errorf("parse legacy inbound array: %w", err)
		}
		out.Inbounds = inbounds
		return out, nil
	}
	if err := json.Unmarshal(trimmed, &out); err != nil {
		return out, fmt.Errorf("parse push store: %w", err)
	}
	return out, nil
}

// writePushStore persists the whole push atomically (fsync(file)+fsync(dir)).
//
// Mode 0600 because the configs embed REALITY private keys, WireGuard server
// keys and the cascade's link credentials.
func writePushStore(path string, req dto.ApplyInboundsRequest) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("mkdir %s: %w", dir, err)
	}
	body, err := json.MarshalIndent(req, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal: %w", err)
	}
	return atomicfile.Write(path, body, 0o600)
}

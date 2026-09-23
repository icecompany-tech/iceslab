package core

import (
	"context"
	"encoding/json"
)

// Absent stands in for a core whose binary is not on this machine, so that the
// node still REPORTS it: `installed: false` in /healthz instead of no row at
// all.
//
// Before this, main.go registered an adapter only when its binary or its env
// variable was there, so a node without sing-box did not say "sing-box: not
// installed", it said nothing about sing-box. Nothing and "not installed" read
// the same on the node card, and the panel could not tell a machine that lacks
// the engine from an agent that never mentions it. hysteria was the one engine
// already registered unconditionally and reporting its own `installed`; this
// puts the other six on the same footing.
//
// What it does, all of it deliberately:
//   - Start and Stop do nothing: there is no process to run;
//   - Healthy is false and Provisioned is false, so the node is NOT degraded by
//     it (only a configured core that is down degrades a node);
//   - Installed is false: the one fact it exists to carry;
//   - ReservedPorts answers `[]`: a binary that is absent holds no port, and
//     that is an answer, not a silence. Staying silent would make the panel's
//     port check "partial" on every node for every absent engine;
//   - AddUser, RemoveUser and GetStats are empty successes: a user has nothing
//     to live in here, and failing them would fail every user push on a node
//     that simply lacks an engine;
//   - ApplyInbound is never reached: the dispatcher skips an Absent when it
//     matches an inbound (IsAbsent), so an inbound for it lands on the same
//     "no adapter for protocol, config persisted but not applied live" path as
//     before this existed. It still refuses, for anyone who calls it directly.
type Absent struct {
	name   string
	engine string
}

// NewAbsent returns the stand-in for engine `engine`, reported under protocol
// `name` (the protocol that engine serves natively).
func NewAbsent(name, engine string) *Absent { return &Absent{name: name, engine: engine} }

func (a *Absent) Name() string                  { return a.name }
func (a *Absent) Engine() string                { return a.engine }
func (a *Absent) Start(context.Context) error   { return nil }
func (a *Absent) Stop(context.Context) error    { return nil }
func (a *Absent) AddUser(User) error            { return nil }
func (a *Absent) RemoveUser(string) error       { return nil }
func (a *Absent) GetStats() (*Stats, error)     { return &Stats{}, nil }
func (a *Absent) Healthy() bool                 { return false }
func (a *Absent) Provisioned() bool             { return false }
func (a *Absent) Installed() bool               { return false }
func (a *Absent) ReservedPorts() []ReservedPort { return nil }
func (a *Absent) ApplyInbound(int, json.RawMessage) error {
	return &NotInstalledError{Engine: a.engine}
}

// NotInstalledError is what an Absent answers to an inbound.
type NotInstalledError struct{ Engine string }

func (e *NotInstalledError) Error() string {
	return e.Engine + " is not installed on this node"
}

// IsAbsent reports whether an adapter is a stand-in for a missing core. The
// dispatcher asks it before matching an inbound, so a stand-in never takes one.
func IsAbsent(a CoreAdapter) bool {
	_, ok := a.(*Absent)
	return ok
}

package main

import (
	"context"
	"encoding/json"
	"hash/fnv"
	"sync"

	"github.com/icecompany-tech/iceslab/apps/node/internal/core"
)

// standInCore answers the panel the way an xray core does and runs nothing: it
// holds the users it was given and invents their traffic. Everything in front
// of it is the real agent, so the cost measured is the cost of the wire and the
// panel, and a core's own cost (restarts, dropped connections, memory) is not
// measured here at all.
type standInCore struct {
	node    string
	version string
	// onlineShare is the share of this node's users carrying traffic here. A
	// user held by several nodes is on one of them at a time, so a fleet divides
	// the people online by how many nodes hold each.
	onlineShare float64
	// bytesPerPoll is what an online user adds on each /stats, 90% down.
	bytesPerPoll int64
	events       *eventLog

	mu       sync.Mutex
	users    map[string]bool
	counters map[string]*core.UserStats
}

var (
	_ core.CoreAdapter       = (*standInCore)(nil)
	_ core.ScopedUserAdder   = (*standInCore)(nil)
	_ core.InboundReconciler = (*standInCore)(nil)
	_ core.Versioner         = (*standInCore)(nil)
	_ core.Installable       = (*standInCore)(nil)
)

func newStandInCore(node, version string, onlineShare float64, bytesPerPoll int64, events *eventLog) *standInCore {
	return &standInCore{
		node:         node,
		version:      version,
		onlineShare:  onlineShare,
		bytesPerPoll: bytesPerPoll,
		events:       events,
		users:        make(map[string]bool),
		counters:     make(map[string]*core.UserStats),
	}
}

func (c *standInCore) Name() string                { return "xray" }
func (c *standInCore) Engine() string              { return "xray" }
func (c *standInCore) Start(context.Context) error { return nil }
func (c *standInCore) Stop(context.Context) error  { return nil }
func (c *standInCore) Healthy() bool               { return true }
func (c *standInCore) CoreVersion() string         { return c.version }
func (c *standInCore) Installed() bool             { return true }

func (c *standInCore) ApplyInbound(int, json.RawMessage) error {
	c.events.write(c.node, "apply", "", 0)
	return nil
}

func (c *standInCore) RetainInbounds([]string) error { return nil }

func (c *standInCore) AddUser(user core.User) error {
	c.mu.Lock()
	c.users[user.UserID] = true
	c.mu.Unlock()
	c.events.write(c.node, "add", user.UserID, 0)
	return nil
}

func (c *standInCore) AddUserOn(user core.User, _ []string) error {
	return c.AddUser(user)
}

func (c *standInCore) RemoveUser(userID string) error {
	c.mu.Lock()
	delete(c.users, userID)
	delete(c.counters, userID)
	c.mu.Unlock()
	c.events.write(c.node, "remove", userID, 0)
	return nil
}

// GetStats reports the same users on every poll: online is a fixed share picked
// by the id and the node, so a counter grows as one person's would, a repeat of
// the run sees the same set, and two nodes holding a user do not both report it.
// Counters are cumulative, as xray's non-destructive read is, which puts the
// panel on its snapshot path.
func (c *standInCore) GetStats() (*core.Stats, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	stats := &core.Stats{Cumulative: true, Users: make([]core.UserStats, 0, len(c.counters))}
	for id := range c.users {
		if !c.isOnline(id) {
			continue
		}
		counter, ok := c.counters[id]
		if !ok {
			counter = &core.UserStats{UserID: id}
			c.counters[id] = counter
		}
		counter.BytesIn += c.bytesPerPoll / 10
		counter.BytesOut += c.bytesPerPoll - c.bytesPerPoll/10
		stats.Users = append(stats.Users, *counter)
	}
	c.events.write(c.node, "stats", "", len(stats.Users))
	return stats, nil
}

func (c *standInCore) isOnline(id string) bool {
	h := fnv.New32a()
	_, _ = h.Write([]byte(c.node))
	_, _ = h.Write([]byte(id))
	return float64(h.Sum32()%10000) < c.onlineShare*10000
}

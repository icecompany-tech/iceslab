package main

import (
	"fmt"
	"testing"

	"github.com/icecompany-tech/iceslab/apps/node/internal/core"
)

func TestOnlineShareIsTheOneAskedForAndStaysTheSameUsers(t *testing.T) {
	c := newStandInCore("n", "1", 0.18, 100, nil)
	for i := range 10000 {
		if err := c.AddUser(core.User{UserID: fmt.Sprintf("u-%d", i)}); err != nil {
			t.Fatal(err)
		}
	}
	first, err := c.GetStats()
	if err != nil {
		t.Fatal(err)
	}
	if n := len(first.Users); n < 1600 || n > 2000 {
		t.Fatalf("online %d of 10000, want about 1800", n)
	}
	second, err := c.GetStats()
	if err != nil {
		t.Fatal(err)
	}
	if len(second.Users) != len(first.Users) {
		t.Fatalf("online moved between polls: %d then %d", len(first.Users), len(second.Users))
	}
}

func TestCountersAreCumulativeAndGoWithTheUser(t *testing.T) {
	c := newStandInCore("n", "1", 1, 100, nil)
	if err := c.AddUser(core.User{UserID: "u"}); err != nil {
		t.Fatal(err)
	}
	if _, err := c.GetStats(); err != nil {
		t.Fatal(err)
	}
	stats, err := c.GetStats()
	if err != nil {
		t.Fatal(err)
	}
	if !stats.Cumulative {
		t.Fatal("not marked cumulative, the panel would bill each poll as a delta")
	}
	if got := stats.Users[0]; got.BytesIn != 20 || got.BytesOut != 180 {
		t.Fatalf("after two polls: in %d out %d, want 20 and 180", got.BytesIn, got.BytesOut)
	}
	if err := c.RemoveUser("u"); err != nil {
		t.Fatal(err)
	}
	if stats, _ = c.GetStats(); len(stats.Users) != 0 {
		t.Fatalf("removed user still reported: %+v", stats.Users)
	}
}

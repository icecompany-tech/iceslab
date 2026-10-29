package xray

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"reflect"
	"strings"
	"testing"

	"github.com/icecompany-tech/iceslab/apps/node/internal/core"
)

// A-218: who is still connected after being taken off, from xray's online
// map, with the CLI replaced. The live proof is lingering_live_test.go.

type onlineCLI struct {
	all     string
	counts  map[string]string
	allErr  error
	askedOf []string
}

func (o *onlineCLI) run(_ context.Context, _ string, args ...string) ([]byte, error) {
	switch args[1] {
	case "statsgetallonlineusers":
		return []byte(o.all), o.allErr
	case "statsonline":
		email := args[len(args)-1]
		o.askedOf = append(o.askedOf, email)
		return []byte(o.counts[email]), nil
	}
	return nil, errors.New("unexpected " + strings.Join(args, " "))
}

func quietAdapter() *Adapter {
	return New(Config{}, slog.New(slog.NewTextHandler(io.Discard, nil)))
}

func TestLingeringNamesOnlyTheOnesNoLongerHeld(t *testing.T) {
	cli := &onlineCLI{
		all: `{"users":["user>>>held-id>>>online","user>>>gone-id>>>online","user>>>held-login>>>online","user>>>gone-login>>>online","junk"]}`,
		counts: map[string]string{
			"gone-id":    `{"stat":{"name":"user>>>gone-id>>>online","value":"2"}}`,
			"gone-login": `{"stat":{"name":"user>>>gone-login>>>online","value":1}}`,
		},
	}
	users := []core.UserStats{{UserID: "held-id"}, {UserID: "socks-user"}}
	got := quietAdapter().lingering(context.Background(), cli.run, "xray", 8080, users, map[string]string{"socks-user": "held-login"})
	want := []core.LingeringUser{{Email: "gone-id", Sessions: 2}, {Email: "gone-login", Sessions: 1}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v", got)
	}
	// A held user is not asked about: one exec per lingering user only.
	if !reflect.DeepEqual(cli.askedOf, []string{"gone-id", "gone-login"}) {
		t.Fatalf("asked %v", cli.askedOf)
	}
}

func TestLingeringIsEmptyNotNilWhenNobody(t *testing.T) {
	cli := &onlineCLI{all: `{"users":["user>>>held-id>>>online"]}`}
	got := quietAdapter().lingering(context.Background(), cli.run, "xray", 8080, []core.UserStats{{UserID: "held-id"}}, nil)
	if got == nil || len(got) != 0 {
		t.Fatalf("asked, nobody: want [], got %#v", got)
	}
	// protojson leaves an empty list out entirely.
	cli = &onlineCLI{all: `{}`}
	if got := quietAdapter().lingering(context.Background(), cli.run, "xray", 8080, nil, nil); got == nil || len(got) != 0 {
		t.Fatalf("empty answer: want [], got %#v", got)
	}
}

func TestLingeringIsNilWhenXrayDidNotAnswer(t *testing.T) {
	cli := &onlineCLI{allErr: errors.New("exit status 1")}
	if got := quietAdapter().lingering(context.Background(), cli.run, "xray", 8080, nil, nil); got != nil {
		t.Fatalf("not known: want nil, got %#v", got)
	}
}

func TestAConnectionClosedBetweenTheTwoCallsIsNotLingering(t *testing.T) {
	cli := &onlineCLI{
		all:    `{"users":["user>>>gone-id>>>online"]}`,
		counts: map[string]string{"gone-id": `{"stat":{"name":"user>>>gone-id>>>online"}}`},
	}
	got := quietAdapter().lingering(context.Background(), cli.run, "xray", 8080, nil, nil)
	if got == nil || len(got) != 0 {
		t.Fatalf("got %#v", got)
	}
}

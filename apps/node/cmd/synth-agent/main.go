// Command synth-agent is the fleet of a load test: one process, one real agent
// server per node, each on its own port with the certificate the panel issued
// for that node. The panel cannot tell it from a fleet of VPS: mTLS with the
// panel's pin, the request limits and the JSON of the contract are the agent's
// own code, and only the core behind them is a stand-in (standInCore).
//
// It is a test tool and never ships: the release, the image and the installer
// all build the module's root package (see release_build_test.go).
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/icecompany-tech/iceslab/apps/node/internal/core"
	"github.com/icecompany-tech/iceslab/apps/node/internal/payload"
	"github.com/icecompany-tech/iceslab/apps/node/internal/server"
)

// nodeSpec is one node of the fleet file: scripts/loadstand/setup.mjs writes it
// from what the panel answered when the node was created.
type nodeSpec struct {
	Name    string `json:"name"`
	Port    int    `json:"port"`
	Payload string `json:"payload"`
}

func main() {
	nodesPath := flag.String("nodes", "", "fleet file, a JSON array of {name, port, payload}")
	host := flag.String("host", "0.0.0.0", "address to listen on")
	eventsPath := flag.String("events", "", "file to record request times in, empty records nothing")
	onlineShare := flag.Float64("online", 0.18, "share of users online, over the fleet")
	reach := flag.Int("reach", 1, "how many nodes hold each user; a user online is on one of them")
	bytesPerPoll := flag.Int64("bytes-per-poll", 1<<20, "bytes an online user adds on each /stats")
	version := flag.String("core-version", "26.3.27", "core version the nodes report")
	flag.Parse()

	logger := slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelWarn}))
	if *reach < 1 {
		logger.Error("-reach must be at least 1")
		os.Exit(2)
	}
	if err := run(*nodesPath, *host, *eventsPath, *onlineShare/float64(*reach), *bytesPerPoll, *version, logger); err != nil {
		logger.Error("synth-agent stopped", "err", err)
		os.Exit(1)
	}
}

func run(nodesPath, host, eventsPath string, onlineShare float64, bytesPerPoll int64, version string, logger *slog.Logger) error {
	nodes, err := readFleet(nodesPath)
	if err != nil {
		return err
	}
	events, err := openEventLog(eventsPath)
	if err != nil {
		return err
	}
	defer func() {
		if err := events.close(); err != nil {
			logger.Error("close event log", "err", err)
		}
	}()

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		tick := time.NewTicker(time.Second)
		defer tick.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-tick.C:
				if err := events.flush(); err != nil {
					logger.Error("flush event log", "err", err)
				}
			}
		}
	}()

	failed := make(chan error, len(nodes))
	for _, node := range nodes {
		pld, err := payload.Decode(node.Payload)
		if err != nil {
			return fmt.Errorf("node %s: %w", node.Name, err)
		}
		srv, err := server.New(server.Config{
			Host:         host,
			Port:         strconv.Itoa(node.Port),
			Payload:      pld,
			Logger:       logger.With("node", node.Name),
			Adapters:     []core.CoreAdapter{newStandInCore(node.Name, version, onlineShare, bytesPerPoll, events)},
			AgentVersion: version,
		})
		if err != nil {
			return fmt.Errorf("node %s: %w", node.Name, err)
		}
		go func(name string) {
			if err := srv.Run(ctx); err != nil {
				failed <- fmt.Errorf("node %s: %w", name, err)
			}
		}(node.Name)
	}
	logger.Warn("fleet up", "nodes", len(nodes))

	select {
	case <-ctx.Done():
		return nil
	case err := <-failed:
		return err
	}
}

func readFleet(path string) ([]nodeSpec, error) {
	if path == "" {
		return nil, errors.New("-nodes is required")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var nodes []nodeSpec
	if err := json.Unmarshal(raw, &nodes); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	if len(nodes) == 0 {
		return nil, fmt.Errorf("%s: no nodes", path)
	}
	return nodes, nil
}

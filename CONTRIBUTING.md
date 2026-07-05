# Contributing

Iceslab is in alpha. Bug reports and small PRs are welcome. Before sinking time into a large change, open an issue first to check it lines up with where the project is heading.

## Development setup

Requirements: Node 22+, pnpm 10+, Go 1.22+, Docker. Tested on Ubuntu (WSL2 on Windows works).

```bash
pnpm install
docker compose up -d postgres redis postgres-test
pnpm --filter @iceslab/panel-backend exec prisma migrate dev
pnpm --filter @iceslab/panel-backend dev     # backend on :3000
pnpm --filter @iceslab/panel-frontend dev    # SPA on :5173
```

## Demo data (screenshots / live demo)

To fill a LOCAL database with a clean, screenshot-ready dataset (8 online
nodes, ~10 users, 4 profiles, 2 squads, a cascade, and 48h of traffic history,
all on `*.example.com` addresses in UTC):

```bash
DEMO=1 pnpm --filter @iceslab/panel-backend seed:demo
```

The script refuses to run unless `DEMO=1` and the database looks local/demo, so
it can't clobber a production DB. It wipes only the demo content tables (nodes,
users, profiles, groups, cascades, history), never the admin login or brand
settings. Run the panel itself with `DEMO=1` too: that gates off the node
health/metrics/stats pollers so the fake nodes stay online and their telemetry
doesn't expire while you shoot. Re-run the seed any time to reset cleanly.

## Branches

- `main` is the trunk: what installer scripts pull and the daily working branch.
  Tagged releases (`v0.1.0`, `v0.1.1`, ...) are cut straight from it.
- Fork, branch off `main`, and open your PR back into `main`.

## Before opening a PR

Run the checks the CI will run:

```bash
pnpm --filter @iceslab/panel-backend exec tsc --noEmit
pnpm --filter @iceslab/panel-frontend exec tsc -b --noEmit
pnpm --filter @iceslab/panel-backend test
cd apps/node && go build ./... && go test ./...
```

If you touched the wire format between panel and node (`packages/shared/src/transport.ts`), mirror the change in `apps/node/internal/dto/dto.go` with matching `json:` tags. The two sides have no version negotiation; mismatched fields surface as `INVALID_BODY` 400s.

## Commit messages

Lowercase prefix + short description. Examples:

```
fix(awg): default subnet to 10.66.66.0/24 to avoid host-gateway collision
feat(panel): add Mieru protocol support
docs: document Hysteria port-hopping caveats
chore(deps): bump prisma to 7.8
```

Write your own commit messages and PR descriptions, in your own words. Using an
AI assistant to help with the code is fine, but keep its fingerprints out of the
history: no `Co-Authored-By: <assistant>` trailers, no "Generated with ..."
footers, and no machine-generated boilerplate in the PR body. State the problem,
the root cause, and what you changed, concisely. A PR that carries assistant
attribution gets sent back for a clean rewrite before it lands, so starting
clean saves everyone a round trip.

## Reporting bugs

Use https://github.com/icecompany-tech/iceslab/issues/new. Include:

- Iceslab version (tag or commit SHA)
- VPS distro and version
- Protocol involved
- Relevant logs (`journalctl -u iceslab-node`, panel-backend stdout)
- What you tried, what happened, what you expected

For security issues see [SECURITY.md](./SECURITY.md) - don't file public issues for those.

## License

By contributing you agree your changes are licensed under AGPL-3.0-or-later, same as the rest of the project.

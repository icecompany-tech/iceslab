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

## Branches

- `main` is the release branch: what the installer scripts pull, and where the
  tags (`v0.1.0`, `v0.1.1`, ...) are cut from. Keep it deployable.
- `develop` is where work lands first and gets tested. It publishes rolling
  images to GHCR under the `develop` tag, which is what test servers pull.
- Fork, branch off `develop`, and open your PR back into `develop`. A fix for a
  released bug can target `main` directly; say so in the PR.

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

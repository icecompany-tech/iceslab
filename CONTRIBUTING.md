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

- `main` - what installer scripts pull. Tagged releases (`v0.1.0`, `v0.1.1`, ...).
- `develop` - daily working branch. Most PRs land here.
- Tagged releases happen via PR `develop` → `main` plus a new tag.

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

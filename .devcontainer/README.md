# Dev container

One Linux image with the whole panel toolchain pinned (Node 22, pnpm 10.33.2,
Prisma, Go 1.22). The point: `pnpm`, `prisma generate`, `tsc` and the tests
behave the same here, in CI and for every contributor. No Windows/WSL boundary,
no POSIX-vs-CMD shim mismatch, no stale generated Prisma client.

## Open it

VS Code with the **Dev Containers** extension:

1. Open the repo folder.
2. Command palette -> **Dev Containers: Reopen in Container**.
3. First build pulls the image and runs `post-create.sh` (pnpm install + prisma
   generate). After that every terminal in VS Code is inside the container.

The container reuses the existing dev stack (`../docker-compose.yml`):
`postgres`, `postgres-test`, `redis`. The `app` container reaches them by
service name on the shared network, so nothing maps to host ports.

## Everyday commands (run inside the container)

```bash
pnpm --filter @iceslab/panel-backend typecheck      # tsc --noEmit (backend)
pnpm --filter @iceslab/panel-frontend typecheck     # tsc --noEmit (frontend)
pnpm typecheck                                       # both, from repo root

# regenerate the Prisma client after editing schema.prisma
( cd apps/panel-backend && pnpm exec prisma generate )

# run the panel (backend :3000 reads the repo-root .env)
pnpm --filter @iceslab/panel-backend dev
pnpm --filter @iceslab/panel-frontend dev            # Vite :5173
```

## Env model (important)

Two separate sources, kept apart on purpose:

- **Dev server** reads the repo-root `.env` (via `--env-file`). `post-create.sh`
  writes a container-pointed `.env` only if one is missing.
- **Tests** read `.env.test`, with `process.env` winning per key
  (`apps/panel-backend/vitest.config.ts`).

That is why the `app` service sets **no** `DATABASE_URL` / `REDIS_URL` /
`NODE_ENV` env vars: vitest would copy them over `.env.test` and the suite
would run against the dev database (its `cleanDatabase()` would wipe it).

### Running tests in-container

`.env.test` points at host ports (`localhost:5433` / `localhost:16379`) for the
host workflow. Inside the container the services are on their own names, so set
them inline for the test run (this does not touch any file, and CI is
unaffected because CI already overrides via `env:`):

```bash
DATABASE_URL=postgres://iceslab:iceslab_dev@postgres-test:5432/iceslab_test \
REDIS_URL=redis://redis:6379 \
pnpm --filter @iceslab/panel-backend test
```

## Node-agent (Go)

```bash
cd apps/node && go build ./... && go vet ./... && go test ./...
```

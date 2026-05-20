# Iceslab Admin Frontend

React 19 + Vite 8 SPA for the Iceslab admin UI.

## Stack

- React 19 + TypeScript
- Vite 8 — dev server and build, served by nginx in prod
- Mantine 8 — UI kit (AppShell, Table, Form, Modal, Notifications, MultiSelect, SegmentedControl)
- TanStack Query 5 — server state with cache invalidation on mutation
- Zustand 5 + persist middleware — auth token kept in localStorage
- React Router DOM 7 — routes + ProtectedRoute gate
- Axios — HTTP client with JWT interceptor and 401-clear-session interceptor

## Pages

| Route | Page | Notes |
|---|---|---|
| `/login` | LoginPage | Renders "Create first admin" when no admin exists yet |
| `/users` | UsersPage | CRUD, traffic limits + reset strategies, `enabledProtocols` MultiSelect, soft-delete confirm modal |
| `/nodes` | NodesPage | CRUD + one-time mTLS payload modal at create (admin must save it — panel never re-emits) |
| `/profiles` | ProfilesPage | Per-protocol form (Hysteria / Xray / AmneziaWG / Naive / SS / MTProto / Mieru) — Xray network selector (raw/xhttp/ws/grpc) + Generate-keypair button |
| `/squads` | SquadsPage | ACL groups — which profile is visible to which user group |
| `/subscription/metadata` | SubscriptionMetadataPage | Profile-Title / Update-Interval / Support-URL / Announce template headers emitted on `/sub/:token` |
| `/subscription/routing` | SrrPage | Subscription Response Rules CRUD + Test-against-UA panel (legacy `/srr` redirects here) |
| `/settings` | SettingsPage | Brand name, API tokens, regions |

## Develop

The backend must be running at `http://localhost:3000` (`pnpm --filter @iceslab/panel-backend dev` from the repo root).

```bash
pnpm --filter @iceslab/panel-frontend dev
# → http://localhost:5173
```

Same-origin in dev via CORS (the SPA hits `http://localhost:3000/api/...` directly; the backend whitelists the SPA origin).

## Type-check

```bash
pnpm --filter @iceslab/panel-frontend exec tsc --noEmit
```

The IDE TS-server occasionally lags on `/mnt/c` paths and shows phantom "Cannot find module" diagnostics; trust the CLI `tsc` over IDE squiggles.

## Production build

```bash
pnpm --filter @iceslab/panel-frontend build
# emits dist/ which the nginx Dockerfile picks up
```

The Dockerfile builds Vite and serves via `nginx:alpine` with a reverse-proxy config that forwards `/api`, `/sub`, `/health`, `/admin/` to the backend service in `docker-compose.prod.yml`. Single-origin in prod, no CORS.

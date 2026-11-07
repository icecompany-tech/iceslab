# Load stand

Measures a released panel at 30 000 and 200 000 users without changing it: every
number comes from outside the panel (Postgres, Redis, container stats, and the
time requests reach the synthetic fleet). Only for a throwaway database; the SQL
refuses any database not named `iceslab_b2`.

| File | What it does |
|---|---|
| `docker-compose.b2.yml` | Overlay on `docker-compose.prod.yml`: `pg_stat_statements`, the fleet, k6, the probe |
| `gen-env.sh` | Writes `.work/b2.env` with fresh secrets |
| `stand-init.sql` | The extension, in a schema of its own |
| `setup.mjs` | Admin, profile, nodes, hosts and squads through the panel's API; writes the fleet file |
| `seed.sql` | Users, devices and history of one cell |
| `tokens.sql` | The token and device list k6 asks with |
| `k6/sub.js`, `k6/sales.js`, `k6/screens.js` | Subscription load, user creation, admin screens |
| `probe.sh`, `collect.sql` | Samples around a scenario and what Postgres says after it |
| `expire-wave.sql`, `expired-history.sql` | Prepare the expiry and daily-cleanup scenarios |
| `analyze.mjs`, `summary.mjs` | Read the fleet's event log and k6's summaries |
| `snapshot-users.sql` + `apps/node/cmd/snapshot-probe` | Size of a subscription snapshot |

The fleet is `apps/node/cmd/synth-agent`: real agent servers with a stand-in core.

## A run

```sh
c="docker compose -p iceslab-b2 --env-file scripts/loadstand/.work/b2.env \
  -f docker-compose.prod.yml -f scripts/loadstand/docker-compose.b2.yml"
bash scripts/loadstand/gen-env.sh https://stand.example.com
$c up -d --build
psql_in() { docker exec -i iceslab-prod-postgres psql -X -U iceslab -d iceslab_b2 "$@"; }
psql_in < scripts/loadstand/stand-init.sql

set -a; . scripts/loadstand/.work/b2.env; set +a
PANEL_URL=http://127.0.0.1:2680 node scripts/loadstand/setup.mjs 20 <fleet-ip> 3
psql_in -v users=30000 -v active=22200 -v history_rows=102384000 -v history_days=90 \
  -v usage_days=180 < scripts/loadstand/seed.sql
psql_in -q < scripts/loadstand/tokens.sql > scripts/loadstand/.work/tokens.csv

B2_REACH=3 $c --profile synth up -d --build synth   # on one machine; or on the load VPS

$c --profile probe run -d --rm --name b2-probe probe start p30-bg
$c --profile k6 run --rm -e MODE=steady -e RATE=13 -e DURATION=60m \
  -e OUT=/work/raw/p30-bg/sub.json k6 run --quiet /scripts/sub.js
$c --profile probe run --rm probe stop p30-bg

node scripts/loadstand/summary.mjs scripts/loadstand/.work/raw/p30-bg/sub.json
node scripts/loadstand/analyze.mjs scripts/loadstand/.work/events.ndjson scripts/loadstand/.work/raw/p30-bg
```

A push to the whole fleet is `node scripts/loadstand/push.mjs` between a probe's start
and stop. `B2_BACKEND_MEM` and `B2_NODE_OPTIONS` raise the backend's ceilings, which at
148 000 active users and 50 nodes it needs: at the default 512m heap the first push
kills it.

`RATE_LIMIT_SUB_*` are raised in the env file, otherwise one source address hits
them within seconds. What a client population needs is a separate question.

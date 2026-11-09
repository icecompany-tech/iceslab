#!/bin/sh
# The numbers around one scenario, from inside the compose project so a run needs
# nothing on the host but docker:
#
#   compose run -d --rm --name b2-probe probe start <label>   reset and sample every 5 s
#   ...the scenario...
#   compose run --rm probe stop <label>                       stop sampling, ask Postgres
#
# Results go to .work/raw/<label>/.
set -eu

action=$1
label=$2
out="/work/raw/$label"
mkdir -p "$out"

postgres=iceslab-prod-postgres
redis=iceslab-prod-redis
psql_in() { docker exec -i "$postgres" psql -X -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"; }

sample() {
  now=$(date +%s)
  docker stats --no-stream --format "$now	{{.Name}}	{{.CPUPerc}}	{{.MemUsage}}" \
    iceslab-prod-postgres iceslab-prod-redis iceslab-prod-backend iceslab-prod-frontend \
    >>"$out/containers.tsv" 2>/dev/null || true
  {
    printf '%s\t' "$now"
    docker exec "$redis" redis-cli --raw info memory 2>/dev/null | tr -d '\r' | awk -F: '/^used_memory:/{printf "%s\t", $2}'
    for queue in node-users inbound-sync cron-tasks; do
      printf '%s\t' "$queue"
      docker exec "$redis" redis-cli --raw llen "bull:$queue:wait" 2>/dev/null | tr -d '\r\n' || true
      printf '\t'
    done
    echo
  } >>"$out/redis.tsv"
  {
    printf '%s\t' "$now"
    psql_in -At -F '	' -c "select extract(epoch from now() - max(online_at))::int, (select count(*) from pg_stat_activity where wait_event_type = 'Lock') from user_traffic" 2>/dev/null || echo
  } >>"$out/freshness.tsv"
}

case "$action" in
  start)
    # The samples are appended to: a repeat of a label must not read as one run.
    rm -f "$out"/*
    psql_in -c "select b2.pg_stat_statements_reset()" >/dev/null
    psql_in -At -c "select pg_current_wal_lsn()" >"$out/wal-before.txt"
    date +%s >"$out/started.txt"
    while :; do
      sample
      sleep 5
    done
    ;;
  stop)
    docker rm -f b2-probe >/dev/null 2>&1 || true
    date +%s >"$out/stopped.txt"
    # The backend's own log of the window: the next run's `down -v` takes the
    # container and its log with it, and with them the words of every failure.
    docker logs --since "$(cat "$out/started.txt")" --until "$(cat "$out/stopped.txt")" \
      iceslab-prod-backend >"$out/backend.log" 2>&1 || true
    before=$(cat "$out/wal-before.txt")
    psql_in -At -c "select pg_size_pretty(pg_current_wal_lsn() - '$before'::pg_lsn)" >"$out/wal-written.txt"
    psql_in -f - <"$(dirname "$0")/collect.sql" >"$out/postgres.txt"
    echo "$label: wal $(cat "$out/wal-written.txt"), results in $out"
    ;;
  *)
    echo "usage: probe.sh start|stop <label>" >&2
    exit 2
    ;;
esac

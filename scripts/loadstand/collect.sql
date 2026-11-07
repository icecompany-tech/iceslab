-- What Postgres says after a scenario. Lists of different lengths in IN are
-- separate statements until Postgres 18, so the digit runs of $n are folded.
\pset format unaligned
\pset fieldsep '\t'
\pset footer off

\echo === totals
select now() as at, pg_current_wal_lsn() as wal_lsn, pg_size_pretty(pg_database_size(current_database())) as db_size;

\echo === top by total time
select round(sum(total_exec_time)::numeric, 0) as total_ms, sum(calls) as calls,
       round((sum(total_exec_time) / nullif(sum(calls), 0))::numeric, 2) as mean_ms,
       sum(rows) as rows, pg_size_pretty(sum(wal_bytes)) as wal,
       left(regexp_replace(regexp_replace(query, '\$[0-9]+(, *\$[0-9]+)*', '$n', 'g'), '\s+', ' ', 'g'), 160) as query
from b2.pg_stat_statements
group by 6 order by 1 desc limit 20;

\echo === top by wal
select pg_size_pretty(sum(wal_bytes)) as wal, sum(calls) as calls, sum(rows) as rows,
       left(regexp_replace(regexp_replace(query, '\$[0-9]+(, *\$[0-9]+)*', '$n', 'g'), '\s+', ' ', 'g'), 160) as query
from b2.pg_stat_statements
group by 4 order by sum(wal_bytes) desc limit 10;

\echo === top by calls
select sum(calls) as calls, round(sum(total_exec_time)::numeric, 0) as total_ms,
       left(regexp_replace(regexp_replace(query, '\$[0-9]+(, *\$[0-9]+)*', '$n', 'g'), '\s+', ' ', 'g'), 160) as query
from b2.pg_stat_statements
group by 3 order by 1 desc limit 10;

\echo === tables
select relname, pg_size_pretty(pg_total_relation_size(relid)) as total, pg_size_pretty(pg_relation_size(relid)) as heap,
       n_live_tup, n_dead_tup, n_tup_ins, n_tup_upd, n_tup_del, n_tup_hot_upd, autovacuum_count, last_autovacuum
from pg_stat_user_tables
order by pg_total_relation_size(relid) desc limit 15;

\echo === cache hit
select round(100.0 * blks_hit / nullif(blks_hit + blks_read, 0), 2) as hit_pct, xact_commit, xact_rollback, deadlocks, temp_bytes
from pg_stat_database where datname = current_database();

\echo === connections
select state, count(*) from pg_stat_activity where datname = current_database() group by 1 order by 2 desc;

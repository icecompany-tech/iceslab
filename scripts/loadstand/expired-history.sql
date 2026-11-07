-- One day of subscription history past the 90 days, for the daily cleanup to
-- delete in one statement, as it does after a day of real traffic.
--   psql -v rows=7600000 -v active=148000 -f expired-history.sql
\set ON_ERROR_STOP on

select current_database() = 'iceslab_b2' as is_stand \gset
\if :is_stand
\else
  \echo refusing: this runs only on a database named iceslab_b2
  \quit
\endif

-- As in seed.sql: no foreign key trigger event in memory per row.
set session_replication_role = replica;

insert into subscription_request_history (user_id, request_ip, user_agent, requested_at)
select
  md5('b2-user-' || ((i * 7919) % :active + 1))::uuid,
  '10.0.0.1',
  'Happ/3.8.1',
  now() - interval '91 days' + (i::float8 / :rows) * interval '1 day'
from generate_series(1::bigint, :rows) as i;

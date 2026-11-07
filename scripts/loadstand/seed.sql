-- Fills a stand database with the users of one cell, after setup.mjs made the
-- squads. Straight into the tables, not through the API: 200 000 creations
-- through the API would measure the seed.
--
--   psql -v users=30000 -v active=6804 -v history_rows=648000 -v history_days=90 \
--        -v usage_days=180 -f seed.sql
--
-- Devices follow the operator's measured 14 521 for 6 804 active users, 2.13
-- each. Everything is derived from the row number, so two seeds of one cell
-- hold the same tokens and users.

\set ON_ERROR_STOP on

select current_database() = 'iceslab_b2' as is_stand \gset
\if :is_stand
\else
  \echo refusing: this seed runs only on a database named iceslab_b2
  \quit
\endif

select count(*) = 0 as is_empty from users \gset
\if :is_empty
\else
  \echo refusing: users is not empty, a seed is for a fresh stand
  \quit
\endif

\timing on

create temporary table b2_squads as
  select row_number() over (order by name) - 1 as idx, id
  from groups where name like 'b2-squad-%';

select count(*) as squad_count from b2_squads \gset

select :squad_count > 0 as has_squads \gset
\if :has_squads
\else
  \echo refusing: no b2-squad-* squads, run setup.mjs first
  \quit
\endif

-- Without foreign key triggers. Each inserted row queues a trigger event in memory
-- until the statement ends, and a hundred million of them took Postgres past the
-- production memory ceiling of 512m (OOM-killed, 06.11). The rows are correct by
-- construction.
set session_replication_role = replica;

begin;

insert into users (
  id, short_id, username, status, expire_at, traffic_limit_bytes, traffic_limit_strategy,
  subscription_token, hysteria_password, amneziawg_private_key, amneziawg_public_key,
  naive_password, xray_uuid, enabled_protocols, created_at, updated_at
)
select
  md5('b2-user-' || n)::uuid,
  substr(md5('b2-short-' || n), 1, 12),
  'b2u' || n,
  case
    when n <= :active then 'active'
    when n % 5 = 0 then 'disabled'
    when n % 5 = 1 then 'limited'
    else 'expired'
  end,
  case
    when n > :active and n % 5 > 1 then now() - ((n % 60) + 1) * interval '1 day'
    else now() + ((n % 360) + 3) * interval '1 day'
  end,
  case when n % 4 = 0 then null else 1000 * 1024 * 1024 * 1024::bigint end,
  (array['no_reset', 'day', 'week', 'month'])[(n % 4) + 1],
  md5('b2-token-a-' || n) || substr(md5('b2-token-b-' || n), 1, 16),
  md5('b2-hy-' || n),
  encode(sha256(('b2-awg-priv-' || n)::bytea), 'base64'),
  encode(sha256(('b2-awg-pub-' || n)::bytea), 'base64'),
  md5('b2-naive-' || n),
  md5('b2-xray-' || n)::uuid,
  '["xray"]'::jsonb,
  now() - ((n % 400) + 2) * interval '1 day',
  -- Older than a day: a non-active user touched in the last 24 hours is what
  -- the reconcile cron re-sends to every node, and these did not just change.
  now() - ((n % 400) + 2) * interval '1 day'
from generate_series(1, :users) as n;

insert into user_traffic (user_id, used_traffic_bytes, lifetime_traffic_bytes, online_at, first_connected_at)
select
  md5('b2-user-' || n)::uuid,
  (n % 500) * 1024 * 1024 * 1024::bigint,
  (n % 900) * 1024 * 1024 * 1024::bigint,
  now() - ((n % 14) + 1) * interval '1 day',
  now() - ((n % 400) + 1) * interval '1 day'
from generate_series(1, :users) as n;

insert into group_members (group_id, user_id)
select s.id, md5('b2-user-' || n)::uuid
from generate_series(1, :users) as n
join b2_squads s on s.idx = n % :squad_count;

insert into hwid_user_devices (user_id, hwid, first_seen_at, last_seen_at)
select
  md5('b2-user-' || n)::uuid,
  'b2d' || n || '-' || k,
  now() - ((n % 300) + 1) * interval '1 day',
  now() - (n % 7) * interval '1 day'
from generate_series(1, :active) as n
cross join lateral generate_series(1, case when n % 100 < 13 then 3 else 2 end) as k;

commit;

-- History goes in without its index, then the index is built: on a hundred
-- million rows that is the difference between minutes and hours.
drop index if exists subscription_request_history_user_id_requested_at_idx;

insert into subscription_request_history (user_id, request_ip, user_agent, requested_at)
select
  md5('b2-user-' || ((i * 7919) % :active + 1))::uuid,
  '10.' || (i % 250) || '.' || ((i / 250) % 250) || '.' || ((i / 62500) % 250),
  (array['Happ/3.8.1', 'v2rayNG/1.10.2', 'Hiddify/2.5.7', 'sing-box/1.13.14'])[(i % 4)::int + 1],
  now() - (i::float8 / :history_rows) * :history_days * interval '1 day'
from generate_series(1::bigint, :history_rows) as i;

create index subscription_request_history_user_id_requested_at_idx
  on subscription_request_history (user_id, requested_at desc);

-- One user in two carries traffic on a given day, on the first node of its squad
-- ring and on the second one time in five: 1.2 rows per online user a day. The
-- ring is worked out once: asked per row, sixteen million rows took 50 minutes.
create temporary table b2_ring as
  select s.idx, pb.node_id, row_number() over (partition by s.idx order by pb.node_id) as pos
  from b2_squads s
  join group_hosts gh on gh.group_id = s.id
  join hosts h on h.id = gh.host_id
  join profile_node_bindings pb on pb.id = h.binding_id;
create index on b2_ring (idx, pos);
analyze b2_ring;

insert into node_user_usage_history (node_id, user_id, date, bytes_in, bytes_out)
select r.node_id, md5('b2-user-' || n)::uuid, (now() - d * interval '1 day')::date, 1048576, 10485760
from generate_series(1, :usage_days) as d
cross join lateral generate_series(1 + (d % 2), :active, 2) as n
join b2_ring r on r.idx = n % :squad_count and r.pos <= case when n % 5 = 0 then 2 else 1 end;

-- A parallel vacuum wants more of /dev/shm than the 64 MB a container gets.
set max_parallel_maintenance_workers = 0;
vacuum (analyze) users;
vacuum (analyze) user_traffic;
vacuum (analyze) group_members;
vacuum (analyze) hwid_user_devices;
vacuum (analyze) subscription_request_history;
vacuum (analyze) node_user_usage_history;

select
  (select count(*) from users) as users,
  (select count(*) from users where status = 'active') as active,
  (select count(*) from hwid_user_devices) as devices,
  (select count(*) from subscription_request_history) as history,
  (select count(*) from node_user_usage_history) as usage;

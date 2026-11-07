-- Input of apps/node/cmd/snapshot-probe, one row per active user in the order
-- its readRecords expects.
copy (
  select
    u.id,
    u.xray_uuid,
    u.subscription_token,
    coalesce(extract(epoch from u.expire_at)::bigint, 0),
    coalesce(u.traffic_limit_bytes, 0),
    u.hysteria_password,
    u.naive_password,
    u.amneziawg_public_key,
    u.short_id,
    u.username,
    u.status,
    dense_rank() over (order by gm.group_id)
  from users u
  join group_members gm on gm.user_id = u.id
  where u.deleted_at is null
) to stdout with csv;

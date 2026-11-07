-- The list k6 asks with: one row per device of an active user, token and device.
copy (
  select u.subscription_token, d.hwid
  from hwid_user_devices d
  join users u on u.id = d.user_id
  where u.status = 'active'
  order by d.hwid
) to stdout with csv;

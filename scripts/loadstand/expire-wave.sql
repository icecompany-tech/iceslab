-- A wave of expiries for the cron to find: N active users whose time is up.
--   psql -v wave=1000 -f expire-wave.sql
\set ON_ERROR_STOP on

select current_database() = 'iceslab_b2' as is_stand \gset
\if :is_stand
\else
  \echo refusing: this runs only on a database named iceslab_b2
  \quit
\endif

update users set expire_at = now() - interval '1 minute'
where id in (
  select id from users where status = 'active' and username like 'b2u%' order by id limit :wave
);

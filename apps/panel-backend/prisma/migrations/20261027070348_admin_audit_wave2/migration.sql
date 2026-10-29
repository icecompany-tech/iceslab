-- The admin audit log, wave 2 (decisions 27.10).
--
-- source_network: the network a sign-in came from (auth.login only), IPv4 /24
-- or IPv6 /48 through redactIp, the same mask the panel already sends to
-- Telegram for sign-ins; never the address. It is request.ip masked, so behind
-- a proxy the panel does not trust (TRUST_PROXY_HOPS) it is the proxy's
-- network: all sign-ins from one /24 is how that shows. A column of its own,
-- not detail, so the detail guard against "ip" keys stays without exceptions.
--
-- admin_audit_events_detail_idx: users.bulk is one row with the ids of the
-- users it was done to; a user's history finds those rows by
-- detail @> '{"userIds":["<id>"]}', which this index answers.
--
-- WRITTEN BY HAND: `migrate dev --create-only` exits on "Drift detected"
-- before drafting (CLAUDE.local.md). `migrate status` clean before and after
-- on the branch's database.
--
-- Rollback:
--   DROP INDEX "admin_audit_events_detail_idx";
--   ALTER TABLE "admin_audit_events" DROP COLUMN "source_network";
--   DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261027070348_admin_audit_wave2';
--
-- The test that holds this file: src/modules/audit/audit-wave2-migration.test.ts
-- (forward, back, forward).

ALTER TABLE "admin_audit_events" ADD COLUMN "source_network" VARCHAR(64);
CREATE INDEX "admin_audit_events_detail_idx" ON "admin_audit_events" USING GIN ("detail" jsonb_path_ops);

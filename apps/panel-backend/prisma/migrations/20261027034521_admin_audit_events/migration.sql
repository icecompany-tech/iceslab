-- The admin audit log (after v0.3.0-rc.1, decisions 26.10): who did what to
-- which object, when, and how it ended. Labels are the names at the time of
-- the action; the target has no foreign key (an erased object, A-268, keeps
-- its rows); the actor's admin is SET NULL when the admin is deleted. No
-- tokens, keys, passwords, bodies or IP addresses (A-267). Kept 365 days by
-- the retention cron.
--
-- WRITTEN BY HAND: `migrate dev --create-only` exits on "Drift detected"
-- before drafting. `migrate status` clean before and after.
--
-- Named 20261027034521 at the merge into develop (it was 20261025233956 on
-- its branch, which would have sorted before 20261026100207, already on
-- develop and on the shared databases). Applied nowhere shared under the old
-- name.
--
-- Rollback:
--   DROP TABLE "admin_audit_events";
--   DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261027034521_admin_audit_events';
--
-- The test that holds this file: src/modules/audit/audit-migration.test.ts
-- (forward, back, forward).

CREATE TABLE "admin_audit_events" (
    "id" BIGSERIAL NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_kind" VARCHAR(16) NOT NULL,
    "actor_id" UUID,
    "actor_label" VARCHAR(64) NOT NULL,
    "action" VARCHAR(64) NOT NULL,
    "target_kind" VARCHAR(32) NOT NULL,
    "target_id" UUID,
    "target_label" VARCHAR(128) NOT NULL,
    "outcome" VARCHAR(16) NOT NULL,
    "refusal" VARCHAR(64),
    "detail" JSONB,
    CONSTRAINT "admin_audit_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "admin_audit_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "admin_audit_events_at_id_idx" ON "admin_audit_events"("at" DESC, "id" DESC);
CREATE INDEX "admin_audit_events_target_kind_target_id_at_idx" ON "admin_audit_events"("target_kind", "target_id", "at" DESC);
CREATE INDEX "admin_audit_events_action_at_idx" ON "admin_audit_events"("action", "at" DESC);

-- Phase 9.3, the owner's decision of 24.09: a cascade's ENTRY POLICY, the
-- route policy for the users of its entry who cannot pick one (hysteria, and
-- AmneziaWG once its entry lands). xray users keep choosing by their UUID.
--
-- One nullable column, a foreign key to route_policies with ON DELETE
-- RESTRICT (a policy standing as an entry policy is not deleted under the
-- cascade; the API refuses first and names the cascade), and an index for
-- that refusal. NULL is the plain profile, what every cascade had before this,
-- so there is nothing to backfill.
--
-- WRITTEN BY HAND: `migrate dev --create-only` exits on "Drift detected" before
-- drafting anything (see CLAUDE.local.md). `migrate status` was clean on both
-- databases before this was written. The name is the UTC stamp, after
-- 20260924170154_node_geo.
--
-- ROLLBACK (run by hand on the test database, then the forward migration run
-- again):
--   ALTER TABLE "cascades" DROP CONSTRAINT "cascades_entry_policy_id_fkey";
--   DROP INDEX "cascades_entry_policy_id_idx";
--   ALTER TABLE "cascades" DROP COLUMN "entry_policy_id";

ALTER TABLE "cascades" ADD COLUMN "entry_policy_id" UUID;

CREATE INDEX "cascades_entry_policy_id_idx" ON "cascades"("entry_policy_id");

ALTER TABLE "cascades"
    ADD CONSTRAINT "cascades_entry_policy_id_fkey"
    FOREIGN KEY ("entry_policy_id") REFERENCES "route_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- t07-1: the AmneziaWG generation a profile hands out.
--
-- One nullable column. NULL reads as 1, which is what every AmneziaWG profile
-- made before phase 7 hands out, so there is no backfill; other protocols keep
-- it NULL. The CHECK holds the two values the panel knows (1 = 1.x, 3 = 3.1):
-- the schema refuses anything else at the edge, this refuses it underneath.
--
-- WRITTEN BY HAND: `migrate dev --create-only` exits on "Drift detected" before
-- drafting anything (see CLAUDE.local.md). `migrate status` was clean on both
-- databases before this was written. The name is the UTC stamp, after
-- 20260925061402_node_hysteria_tls.
--
-- ROLLBACK (run by hand on the test database, then the forward migration run
-- again):
--   ALTER TABLE "profiles" DROP COLUMN "awg_protocol";

ALTER TABLE "profiles" ADD COLUMN "awg_protocol" SMALLINT;
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_awg_protocol_check" CHECK ("awg_protocol" IN (1, 3));

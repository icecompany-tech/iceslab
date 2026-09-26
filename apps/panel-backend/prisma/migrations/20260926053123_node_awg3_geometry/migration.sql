-- t07-6: the obfuscation of a node's AmneziaWG 3.1 interface.
--
-- One nullable column. Minted by the panel on the first push of a 3.1 profile
-- to the node (nodes/awg3-geometry.ts) and never quietly replaced: every 3.1
-- key handed out for the node carries it. No backfill: no node has a 3.1
-- interface before this.
--
-- WRITTEN BY HAND: `migrate dev --create-only` exits on "Drift detected" before
-- drafting anything (see CLAUDE.local.md). `migrate status` was clean on both
-- databases before this was written. The name is the UTC stamp, after
-- 20260926043147_profile_awg_protocol.
--
-- ROLLBACK (run by hand on the test database, then the forward migration run
-- again):
--   ALTER TABLE "nodes" DROP COLUMN "awg3_geometry";

ALTER TABLE "nodes" ADD COLUMN "awg3_geometry" JSONB;

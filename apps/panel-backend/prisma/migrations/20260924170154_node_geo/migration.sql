-- Phase 9.2: the geo directory as the node's agent reports it.
--
-- One nullable column beside chain_status, written by the status poll from the
-- healthcheck's `geo` ({ version, files, observedAt }, NodeGeoFact in
-- packages/shared/src/geo.ts). NULL is an honest state and the one every node
-- starts in: its agent has not said, because it is older than the field or has
-- not been polled since. No backfill.
--
-- WRITTEN BY HAND: `migrate dev --create-only` exits on "Drift detected" before
-- drafting anything (see CLAUDE.local.md). `migrate status` was clean on both
-- databases before this was written.
--
-- ROLLBACK (run by hand on the test database, then the forward migration run
-- again):
--   ALTER TABLE "nodes" DROP COLUMN "geo";

ALTER TABLE "nodes" ADD COLUMN "geo" JSONB;

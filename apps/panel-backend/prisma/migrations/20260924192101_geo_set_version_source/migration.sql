-- Phase 9.4: what a geo set version knows about where it came from.
--
--   source_sha256   sha256 of the file as it CAME, which a sidecar or the
--                   operator vouches for. Equal to sha256 for a .dat; for a
--                   rule-set JSON or a MaxMind database sha256 is the .dat it
--                   was converted into. Backfilled from sha256: every version
--                   before this came as a .dat.
--   etag,
--   last_modified   the validators of the response it came in, for the next
--                   conditional request. NULL where the server sent none, and
--                   on every version that did not come from a URL.
--
-- WRITTEN BY HAND: `migrate dev --create-only` exits on "Drift detected" before
-- drafting anything (see CLAUDE.local.md). `migrate status` was clean on both
-- databases before this was written. The name is the UTC stamp, after
-- 20260924181936_cascade_entry_policy.
--
-- ROLLBACK (run by hand on the test database, then the forward migration run
-- again):
--   ALTER TABLE "geo_set_versions" DROP COLUMN "source_sha256";
--   ALTER TABLE "geo_set_versions" DROP COLUMN "etag";
--   ALTER TABLE "geo_set_versions" DROP COLUMN "last_modified";

ALTER TABLE "geo_set_versions" ADD COLUMN "source_sha256" CHAR(64);
UPDATE "geo_set_versions" SET "source_sha256" = "sha256";
ALTER TABLE "geo_set_versions" ALTER COLUMN "source_sha256" SET NOT NULL;

ALTER TABLE "geo_set_versions" ADD COLUMN "etag" VARCHAR(512);
ALTER TABLE "geo_set_versions" ADD COLUMN "last_modified" VARCHAR(64);

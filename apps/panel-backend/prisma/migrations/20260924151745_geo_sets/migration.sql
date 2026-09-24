-- Phase 9.1: geo sets. Contract: docs/plan/geo-contract.md; model comments in
-- prisma/models/geo.prisma.
--
-- Four tables:
--   geo_sets          one per list a rule can name (two built-in, the rest the
--                     operator's), with the status of its LAST attempt;
--   geo_set_versions  every verified content of a set that a node still
--                     stands on, plus the set's current;
--   geo_blobs         the bytes, once per sha256, in the database because the
--                     backend writes nothing to disk and has no volume;
--   node_geo_pins     which version of which set each node was given.
--
-- geo_sets.current_version_id and geo_set_versions.geo_set_id point at each
-- other, so the tables are created first and the keys added after.
--
-- node_geo_pins.version_id is NO ACTION, not RESTRICT: checked at the end of
-- the statement, so deleting a whole set (which cascades to its pins and its
-- versions together) goes through, while deleting a pinned version alone is
-- still refused.
--
-- Nothing to backfill: no set exists before this. The two built-in rows are
-- created by the panel on start (geo-sets.store.ts), not seeded here, so a
-- truncating test suite gets them back the same way production does.
--
-- WRITTEN BY HAND: `migrate dev --create-only` exits on "Drift detected" before
-- drafting anything (see CLAUDE.local.md). `migrate status` was clean on both
-- databases before this was written.
--
-- ROLLBACK (run by hand on the test database, then the forward migration run
-- again):
--   DROP TABLE "node_geo_pins";
--   ALTER TABLE "geo_sets" DROP CONSTRAINT "geo_sets_current_version_id_fkey";
--   DROP TABLE "geo_set_versions";
--   DROP TABLE "geo_blobs";
--   DROP TABLE "geo_sets";

CREATE TABLE "geo_sets" (
    "id" UUID NOT NULL,
    "name" VARCHAR(32) NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "source_type" VARCHAR(16) NOT NULL,
    "source_tag" VARCHAR(64),
    "url" TEXT,
    "sha256_source" VARCHAR(16),
    "sha256_manual" CHAR(64),
    "refresh_hours" INTEGER,
    "filename" VARCHAR(255),
    "format" VARCHAR(16) NOT NULL DEFAULT 'dat',
    "status" VARCHAR(16) NOT NULL DEFAULT 'checking',
    "checked_at" TIMESTAMPTZ(6),
    "error" TEXT,
    "current_version_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "geo_sets_pkey" PRIMARY KEY ("id"),
    -- The name goes into `ext:<name>:<tag>` and from there into a path on the
    -- node, which xray joins without looking (router.go:391, others.go:18).
    CONSTRAINT "geo_sets_name_check" CHECK ("name" ~ '^[a-z0-9-]{1,32}$'),
    CONSTRAINT "geo_sets_kind_check" CHECK ("kind" IN ('geosite', 'geoip')),
    CONSTRAINT "geo_sets_source_type_check" CHECK ("source_type" IN ('builtin', 'url', 'upload')),
    CONSTRAINT "geo_sets_sha256_source_check" CHECK ("sha256_source" IS NULL OR "sha256_source" IN ('sidecar', 'manual')),
    CONSTRAINT "geo_sets_format_check" CHECK ("format" IN ('dat', 'rule-set-json', 'mmdb')),
    CONSTRAINT "geo_sets_status_check" CHECK ("status" IN ('checking', 'verified', 'broken'))
);

CREATE UNIQUE INDEX "geo_sets_name_key" ON "geo_sets"("name");
CREATE UNIQUE INDEX "geo_sets_current_version_id_key" ON "geo_sets"("current_version_id");

CREATE TABLE "geo_blobs" (
    "sha256" CHAR(64) NOT NULL,
    "data" BYTEA NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "geo_blobs_pkey" PRIMARY KEY ("sha256")
);

CREATE TABLE "geo_set_versions" (
    "id" UUID NOT NULL,
    "geo_set_id" UUID NOT NULL,
    "version" VARCHAR(64) NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "fetched_at" TIMESTAMPTZ(6) NOT NULL,
    "tags" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "geo_set_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "geo_set_versions_geo_set_id_sha256_key" ON "geo_set_versions"("geo_set_id", "sha256");
CREATE INDEX "geo_set_versions_sha256_idx" ON "geo_set_versions"("sha256");

CREATE TABLE "node_geo_pins" (
    "node_id" UUID NOT NULL,
    "geo_set_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "node_geo_pins_pkey" PRIMARY KEY ("node_id", "geo_set_id")
);

CREATE INDEX "node_geo_pins_geo_set_id_idx" ON "node_geo_pins"("geo_set_id");
CREATE INDEX "node_geo_pins_version_id_idx" ON "node_geo_pins"("version_id");

ALTER TABLE "geo_sets"
    ADD CONSTRAINT "geo_sets_current_version_id_fkey"
    FOREIGN KEY ("current_version_id") REFERENCES "geo_set_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "geo_set_versions"
    ADD CONSTRAINT "geo_set_versions_geo_set_id_fkey"
    FOREIGN KEY ("geo_set_id") REFERENCES "geo_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "geo_set_versions"
    ADD CONSTRAINT "geo_set_versions_sha256_fkey"
    FOREIGN KEY ("sha256") REFERENCES "geo_blobs"("sha256") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "node_geo_pins"
    ADD CONSTRAINT "node_geo_pins_node_id_fkey"
    FOREIGN KEY ("node_id") REFERENCES "nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "node_geo_pins"
    ADD CONSTRAINT "node_geo_pins_geo_set_id_fkey"
    FOREIGN KEY ("geo_set_id") REFERENCES "geo_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "node_geo_pins"
    ADD CONSTRAINT "node_geo_pins_version_id_fkey"
    FOREIGN KEY ("version_id") REFERENCES "geo_set_versions"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

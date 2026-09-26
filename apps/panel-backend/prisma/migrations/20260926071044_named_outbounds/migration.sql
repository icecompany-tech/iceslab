-- Phase 10 (Э3.2): named foreign outbounds, and the direction that stands on one.
--
-- named_outbounds: vless | socks | freedom | blackhole, a unique name, an
-- optional country for the subscription, and the per-type config (checked by
-- the API on every write, named-outbounds.schemas.ts).
--
-- cascade_directions.outbound_id: a direction goes out through a foreign server
-- IN PLACE of a pool of nodes. Nullable, no backfill: every existing direction
-- has a pool. RESTRICT, so an outbound a direction stands on is never deleted
-- under it; the API refuses first (NAMED_OUTBOUND_IN_USE) and names them.
--
-- WRITTEN BY HAND: `migrate dev --create-only` exits on "Drift detected" before
-- drafting anything (see CLAUDE.local.md). `migrate status` was clean on both
-- databases before this was written. The name is the UTC stamp, after
-- 20260926053123_node_awg3_geometry.
--
-- ROLLBACK (run by hand on the test database, then the forward migration run
-- again):
--   ALTER TABLE "cascade_directions" DROP CONSTRAINT "cascade_directions_outbound_id_fkey";
--   DROP INDEX "cascade_directions_outbound_id_idx";
--   ALTER TABLE "cascade_directions" DROP COLUMN "outbound_id";
--   DROP TABLE "named_outbounds";

CREATE TABLE "named_outbounds" (
    -- No database default on the id: Prisma mints it (@default(uuid())), and a
    -- default here would be one more line of the drift CLAUDE.local.md tracks.
    "id" UUID NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "type" VARCHAR(16) NOT NULL,
    "country_code" CHAR(2),
    "config" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "named_outbounds_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "named_outbounds_type_check" CHECK ("type" IN ('vless', 'socks', 'freedom', 'blackhole'))
);

CREATE UNIQUE INDEX "named_outbounds_name_key" ON "named_outbounds"("name");

ALTER TABLE "cascade_directions" ADD COLUMN "outbound_id" UUID;

CREATE INDEX "cascade_directions_outbound_id_idx" ON "cascade_directions"("outbound_id");

ALTER TABLE "cascade_directions" ADD CONSTRAINT "cascade_directions_outbound_id_fkey"
    FOREIGN KEY ("outbound_id") REFERENCES "named_outbounds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

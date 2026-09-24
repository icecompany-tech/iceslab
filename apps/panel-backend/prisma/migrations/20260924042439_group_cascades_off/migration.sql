-- A squad can switch a cascade OFF: the third state of the exit allow-list.
--
-- group_cascade_exits already says "no rows = every exit" and "rows = these
-- exits". "Not this cascade at all" had no way to be stored, because the exit
-- is part of that table's key; the API dropped an empty exitNodeIds before it
-- reached the database. A row here is that state (GroupCascadeOff in
-- squads.prisma), written from an exitAcl entry with exitNodeIds: [].
--
-- Nothing to backfill: an empty list was never stored, so no squad had the
-- state before this, and every existing squad reads exactly as it did.
--
-- WRITTEN BY HAND: `migrate dev --create-only` exits on "Drift detected" before
-- drafting anything (see CLAUDE.local.md). `migrate status` was clean on both
-- databases before this was written.
--
-- ROLLBACK (run by hand on the test database, then the forward migration run
-- again):
--   DROP TABLE "group_cascades_off";

CREATE TABLE "group_cascades_off" (
    "group_id" UUID NOT NULL,
    "cascade_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_cascades_off_pkey" PRIMARY KEY ("group_id", "cascade_id")
);

CREATE INDEX "group_cascades_off_cascade_id_idx" ON "group_cascades_off"("cascade_id");

ALTER TABLE "group_cascades_off"
    ADD CONSTRAINT "group_cascades_off_group_id_fkey"
    FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "group_cascades_off"
    ADD CONSTRAINT "group_cascades_off_cascade_id_fkey"
    FOREIGN KEY ("cascade_id") REFERENCES "cascades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The last leg of the path gets its own cell, its own knobs and its own port.
--
-- Until now a cascade had ONE cell for every leg: the entry chose, and the leg
-- into each direction inherited it. Phase 5 lets a direction be reached over a
-- different one, which is what makes "the Dutch exit over hy2, the Swedish one
-- over tuic" expressible at all.
--
-- Three columns, all nullable, no backfill and none needed:
--   link_protocol  NULL = "the entry's cell", which is what every existing
--                  direction has always done. A CELL, never a protocol name;
--                  the dictionary was split in 20260922061809.
--   link_params    NULL = the defaults. jsonb rather than a column per knob,
--                  because the knobs differ per cell and a column would be NULL
--                  for three cells out of four.
--   link_port      NULL until the cascade is next saved, and then
--                  24000 + the last step's number, WRITTEN BY THE SERVER. A
--                  client that could set it could point a leg at a port the
--                  node uses for something else.
--
-- Hand-written, like every migration here since 2026-09-22: `migrate dev
-- --create-only` stops on "Drift detected" before generating anything.
-- Nothing was discarded from a draft because there was no draft.
--
-- Rollback, and this one IS faithful: the three columns are new and nothing
-- reads them yet, so dropping them restores the previous behaviour exactly.
--   ALTER TABLE "cascade_directions"
--     DROP COLUMN "link_protocol", DROP COLUMN "link_params", DROP COLUMN "link_port";
-- Proven on a copy before applying: added, dropped, added again, column list
-- compared with the untouched test database.
ALTER TABLE "cascade_directions"
  ADD COLUMN "link_protocol" TEXT,
  ADD COLUMN "link_params" JSONB,
  ADD COLUMN "link_port" INTEGER;

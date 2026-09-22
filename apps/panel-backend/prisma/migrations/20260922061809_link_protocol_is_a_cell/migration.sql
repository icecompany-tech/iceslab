-- `link_protocol` becomes strictly a dictionary of CELLS.
--
-- The column has carried two vocabularies since the cascade was written. A cell
-- is what one hop says to the next (vless, shadowsocks, and from phase 5 hy2
-- and tuic); a protocol is what a node serves users with (xray, hysteria,
-- amneziawg, ...). They are stored in one column, and the only reason nothing
-- has gone wrong yet is that the two sets barely met.
--
-- Phase 5 makes them meet. `tuic` is about to become a legal CELL, and it is
-- already a legal PROTOCOL, so a stored "tuic" would stop being decidable: the
-- validator reading it as a protocol would accept a leg as if it were an entry.
-- Hence this migration, before the cells land.
--
-- WHAT IT REWRITES, and why each one:
--   xray        -> vless      the engine name meaning the vless cell. This is
--                             what the field actually stores today and what the
--                             code has always built for it.
--   hysteria, amneziawg, naive, mtproto, mieru, anytls, shadowtls, tuic
--               -> NULL       protocol names that were NEVER realised as a
--                             cell. A row holding one of them describes a leg
--                             that has never existed: `linkCellFor` answers
--                             null for them and the save path refuses them, so
--                             any such row predates that validator. NULL means
--                             "the entry's own cell", which is what those
--                             cascades have actually been running.
--                             ⚠ `tuic` is in this list on purpose. Under the
--                             new dictionary the same string would suddenly
--                             mean a working tuic leg, which is precisely the
--                             ambiguity this migration exists to remove.
--   vless, shadowsocks        left alone: already cells.
--   NULL                      left alone: already "the entry's cell".
--
-- ANYTHING ELSE RAISES. A value this file does not recognise is not something
-- to guess at: guessing is how "hysteria" silently became a vless link in the
-- first place. The exception names the offending values and the migration does
-- not apply, which is the same rule the transport backfill used.
--
-- Hand-written, like every migration here since 2026-09-22: `prisma migrate dev
-- --create-only` stops on "Drift detected" before generating anything, and
-- reconciling that drift is its own piece of work. Nothing was discarded from a
-- draft because there was no draft.
--
-- Counts on the two local databases at the time of writing: ZERO rows in both
-- tables, in every branch below (there is no cascade in either). The stand's
-- numbers arrive in the NOTICE lines when it is applied there.
--
-- Rollback: there is no faithful one, and saying so is more honest than
-- shipping a lie. `xray` -> `vless` could be reversed; the values rewritten to
-- NULL cannot, because NULL is also a legitimate stored value and nothing
-- records which rows were which. If this has to come off, restore the two
-- columns from a dump taken before it ran. The forward direction was proven on
-- a copy first (see the report).
DO $$
DECLARE
  bad text;
  n int;
BEGIN
  -- 1. Refuse before touching anything: a value nobody listed.
  SELECT string_agg(DISTINCT v, ', ') INTO bad
  FROM (
    SELECT link_protocol AS v FROM cascade_positions
    UNION ALL
    SELECT link_protocol FROM cascade_hops
  ) s
  WHERE v IS NOT NULL
    AND v NOT IN (
      'vless', 'shadowsocks', 'hy2', 'tuic', 'xray',
      'hysteria', 'amneziawg', 'naive', 'mtproto', 'mieru', 'anytls', 'shadowtls'
    );
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION
      'link_protocol holds values this migration does not recognise: %. Decide what cell each one means and add it above; do not let this guess.', bad;
  END IF;

  -- 2. The engine name that has always meant the vless cell.
  UPDATE cascade_positions SET link_protocol = 'vless' WHERE link_protocol = 'xray';
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'cascade_positions: % rows xray -> vless', n;
  UPDATE cascade_hops SET link_protocol = 'vless' WHERE link_protocol = 'xray';
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'cascade_hops: % rows xray -> vless', n;

  -- 3. Protocol names that never were a cell. They described a leg that did not
  --    exist; NULL says the same thing and is a value the renderer understands.
  UPDATE cascade_positions SET link_protocol = NULL
  WHERE link_protocol IN ('hysteria', 'amneziawg', 'naive', 'mtproto', 'mieru', 'anytls', 'shadowtls', 'tuic');
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'cascade_positions: % rows of a protocol that was never a cell -> NULL', n;
  UPDATE cascade_hops SET link_protocol = NULL
  WHERE link_protocol IN ('hysteria', 'amneziawg', 'naive', 'mtproto', 'mieru', 'anytls', 'shadowtls', 'tuic');
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'cascade_hops: % rows of a protocol that was never a cell -> NULL', n;
END $$;

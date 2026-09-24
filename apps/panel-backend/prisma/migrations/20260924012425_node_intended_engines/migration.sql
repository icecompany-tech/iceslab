-- Which engines the operator wants installed on this node: an INTENT, not a
-- report (owner's decision 24.09, docs/plan/core-lifecycle.md section 7).
--
-- The report lives in `cores` (what the agent says it runs) and every gate
-- reads only that. This is what the node was set up to carry: the installer
-- takes it as `--engines`, the node card shows it. The FIRST entry is the
-- primary engine, the one `protocol` names; the order of the rest means
-- nothing.
--
-- Named `intended_engines`, not `engines`: the node DTO already has `engines`
-- for the REPORTED set, and one name for an intent and a fact is the mistake
-- the gates were built to avoid.
--
-- Backfill: the primary is the engine that serves `protocol` (nativeEngineFor
-- in node-engines.ts: shadowsocks is xray, tuic/anytls/shadowtls are sing-box,
-- every other protocol is its own engine), plus sing-box when `singbox_engine`
-- was on and the primary is not sing-box already.
--
-- DEFAULT '{}' and no cardinality CHECK: a row inserted without the column (a
-- test fixture, a seed script, the migration tool) reads as the same backfill,
-- computed from `protocol` and `singbox_engine` (readIntendedEngines). Every
-- API write stores a non-empty list. `protocol` and `singbox_engine` stay as
-- columns, kept in step on every write, so code that reads them is unchanged.
--
-- WRITTEN BY HAND: `migrate dev --create-only` exits on "Drift detected" before
-- drafting anything (see CLAUDE.local.md). `migrate status` was clean on both
-- databases before this was written.
--
-- ROLLBACK (run by hand on the test database, then the forward migration run
-- again):
--   ALTER TABLE "nodes" DROP COLUMN "intended_engines";

ALTER TABLE "nodes" ADD COLUMN "intended_engines" TEXT[] NOT NULL DEFAULT '{}';

UPDATE "nodes" SET "intended_engines" = CASE
    WHEN "singbox_engine" AND p.native <> 'singbox' THEN ARRAY[p.native, 'singbox']
    ELSE ARRAY[p.native]
  END
FROM (
  SELECT "id" AS node_id, CASE "protocol"
      WHEN 'shadowsocks' THEN 'xray'
      WHEN 'tuic' THEN 'singbox'
      WHEN 'anytls' THEN 'singbox'
      WHEN 'shadowtls' THEN 'singbox'
      ELSE "protocol"
    END AS native
  FROM "nodes"
) AS p
WHERE "nodes"."id" = p.node_id AND cardinality("nodes"."intended_engines") = 0;

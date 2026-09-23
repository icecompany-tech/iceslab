-- Which core versions the operator wants on this node: an INTENT, not a report.
--
-- The reports live in `cores` (what the agent says it runs). This is the other
-- party's fact: what the panel was told to put there. The node card judges the
-- report against it, and the bootstrap payload hands it to the installer.
--
-- Shape: { "<component>": "<version>" }, components from CORE_COMPONENTS and
-- versions from the manifest's `releases` (packages/shared/src/core-versions.ts),
-- checked by checkCoreVersionIntent on every write. A missing key means "the
-- pin", so a node nobody touched follows the manifest when the pin moves, and
-- every existing node gets exactly that: '{}'.
--
-- NOT NULL with '{}' rather than nullable: there is no third state to keep.
-- "No intent" and "empty intent" both mean "the pins", and a nullable column
-- would give every reader a null to handle that says nothing a '{}' does not.
-- The CHECK keeps the one shape the code reads; the keys and values are the
-- application's to check, since they move with the manifest.
--
-- WRITTEN BY HAND: `migrate dev --create-only` exits on "Drift detected" before
-- drafting anything (see CLAUDE.local.md and 20260922020057_node_chain_status).
-- `migrate status` was clean on both databases before this was written.
--
-- ROLLBACK (run by hand on the test database, then the forward migration run
-- again):
--   ALTER TABLE "nodes" DROP CONSTRAINT "nodes_core_versions_is_object";
--   ALTER TABLE "nodes" DROP COLUMN "core_versions";

ALTER TABLE "nodes" ADD COLUMN "core_versions" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_core_versions_is_object"
  CHECK (jsonb_typeof("core_versions") = 'object');

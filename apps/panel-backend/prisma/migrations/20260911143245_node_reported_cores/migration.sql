-- The cores a node reported in /healthz, with the per-core flag saying whether
-- that core carries out the node-level policy and resolver. NULL = no reporting
-- agent has checked in yet. Shape is NodeCores in packages/shared.
--
-- ⚠ HAND-TRIMMED, see CLAUDE.local.md and the header of
-- 20260911133724_node_dns_resolver: the generator adds the standing drift
-- between the migration history and the schema to every new migration. Thrown
-- out here, same list as last time: DROP DEFAULT on the uuid `id` and on
-- `updated_at` of hosts / hwid_user_devices / profile_node_bindings / profiles /
-- regions, DROP DEFAULT on route_policies.direct_domains and .block_domains,
-- drop and recreate of six identical foreign keys, and the rename of
-- cascade_links_cascade_id_from_to_direction_key.
--
-- Rollback: ALTER TABLE "nodes" DROP COLUMN "cores";

-- AlterTable
ALTER TABLE "nodes" ADD COLUMN     "cores" JSONB;

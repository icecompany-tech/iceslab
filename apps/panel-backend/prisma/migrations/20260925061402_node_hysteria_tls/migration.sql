-- E30a: the self-signed pair native hysteria serves on a node addressed by IP.
--
-- One nullable column. A node with an FQDN keeps its hysteria on ACME and this
-- stays NULL; a node addressed by IP gets its pair minted by the panel on the
-- first native hysteria push (nodes/hysteria-tls.ts). No backfill: every node
-- reads as "none yet" until then, which is what it is.
--
-- WRITTEN BY HAND: `migrate dev --create-only` exits on "Drift detected" before
-- drafting anything (see CLAUDE.local.md). `migrate status` was clean on both
-- databases before this was written. The name is the UTC stamp, after
-- 20260925035512_operator_recipes.
--
-- ROLLBACK (run by hand on the test database, then the forward migration run
-- again):
--   ALTER TABLE "nodes" DROP COLUMN "hysteria_tls";

ALTER TABLE "nodes" ADD COLUMN "hysteria_tls" JSONB;

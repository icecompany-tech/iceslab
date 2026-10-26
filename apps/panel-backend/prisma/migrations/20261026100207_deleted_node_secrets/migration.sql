-- A-279: a deleted node keeps only its tombstone.
--
-- A deleted node's row stays for good (history, and the 410 its agent needs to
-- remove itself), but nothing in it is needed for that 410 except the id and
-- heartbeat_secret (heartbeat.routes.ts). deleteNode now clears the node's
-- secrets in the same transaction that sets deleted_at; this clears the same
-- on the rows deleted before it:
--   chain_secret   the password of the node's chain socks listeners
--   hysteria_tls   the panel's self-signed pair (E30a), keyPem included
--   warp_account   the WARP device credentials (secretKey, token, license)
--   public_key     key material, written by nothing any more
-- heartbeat_secret stays: without it the 410 turns into a 401, and an agent
-- that was offline when its node was deleted would never remove itself.
--
-- WRITTEN BY HAND: `migrate dev --create-only` exits on "Drift detected"
-- before drafting (CLAUDE.local.md). No schema change: one UPDATE.
-- `migrate status` clean before and after on the branch's test database.
--
-- ROLLBACK: there is none for the data, by design; the secrets of deleted
-- nodes are what this erases, and an erased secret does not come back. To
-- undo the migration record only (the schema is untouched):
--   DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261026100207_deleted_node_secrets';
--
-- The test that holds this file: src/modules/nodes/node-tombstone.test.ts.

UPDATE "nodes"
SET "chain_secret" = NULL,
    "hysteria_tls" = NULL,
    "warp_account" = NULL,
    "public_key" = NULL
WHERE "deleted_at" IS NOT NULL;

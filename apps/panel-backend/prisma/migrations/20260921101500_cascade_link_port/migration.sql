-- The inter-hop link port, lifted out of the JSON so a port check can find it.
--
-- A cascade leg listens on the RECEIVING node at LINK_PORT_BASE + step, and
-- that port was only ever inside `config`, the serialised LinkCred. So the
-- panel could refuse two profiles on one port and had nothing to say when a
-- profile was bound onto a port a cascade was already listening on: the second
-- listener simply fails to bind on the node, in the agent's journal, hours
-- after the save that caused it.
--
-- The column duplicates `config.port` rather than replacing it: the config
-- builders parse the cred as a whole, and pulling one field out would mean
-- teaching every reader a second shape. The service writes both from one value.
--
-- ⚠ NOT a uniqueness key, and it cannot be one: the pair that collides is this
-- row against a BINDING on the same node, and those live in two tables. No
-- index spans both, so the refusal stays the service's job in both directions.
-- The index exists to make the question cheap.
--
-- TRIMMED BY HAND per CLAUDE.local.md. The generator attached the usual drift
-- (DROP DEFAULT on ids of hosts, hwid_user_devices, regions, profiles,
-- profile_node_bindings, on updated_at of the last two, on direct_domains and
-- block_domains of route_policies; six foreign keys dropped and recreated; the
-- rename of cascade_links_cascade_id_from_to_direction_key). None of it is this
-- change.
--
-- ⚠ It also APPLIED that draft before being told to: `migrate dev
-- --create-only` still applies anything pending first, and the previous
-- migration was pending. The dev database was put back by hand (defaults
-- restored from the untouched test database, index renamed back, column and
-- index dropped, the row deleted from _prisma_migrations) and verified
-- identical to it before this file was written.
--
-- ROLLBACK (run by hand before this was committed, then the forward migration
-- run again):
--   DROP INDEX "cascade_links_to_node_id_port_idx";
--   ALTER TABLE "cascade_links" DROP COLUMN "port";

-- ───── 1. The column, nullable for now ─────
--
-- No DEFAULT at any point: a link whose port was invented would be a link the
-- node never listens on, and the whole purpose of this column is to be true.
ALTER TABLE "cascade_links" ADD COLUMN "port" INTEGER;

-- ───── 2. Backfill from the cred that already holds it ─────
UPDATE "cascade_links" SET "port" = ("config"->>'port')::int
 WHERE "config"->>'port' IS NOT NULL;

-- ───── 3. Refuse to guess ─────
--
-- A row whose cred carries no port is data drift, and this migration is not
-- the place to decide what it should have been: the cascade it belongs to is
-- already half-wired, and the config builders refuse such a cred too (they
-- ship no cascade rather than a chain that blackholes traffic). Name the rows
-- and stop.
DO $$
DECLARE broken TEXT;
BEGIN
  SELECT string_agg(format('link %s of cascade %s', "id", "cascade_id"), E'\n')
    INTO broken FROM "cascade_links" WHERE "port" IS NULL;
  IF broken IS NOT NULL THEN
    RAISE EXCEPTION E'these cascade links carry no port in their cred:\n%', broken;
  END IF;
END $$;

ALTER TABLE "cascade_links" ALTER COLUMN "port" SET NOT NULL;

-- ───── 4. The question this exists for ─────
--
-- "What holds this port on this node." Receiving side first: a link port is
-- only ever occupied there.
CREATE INDEX "cascade_links_to_node_id_port_idx" ON "cascade_links"("to_node_id", "port");

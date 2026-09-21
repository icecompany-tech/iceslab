-- A port is taken per TRANSPORT, not per number.
--
-- `@@unique([node_id, port])` treated a port as one resource, so the panel
-- refused REALITY on 443/TCP next to Hysteria2 on 443/UDP. Those are different
-- sockets: every browser on earth speaks H2 on the first and H3 on the second
-- at the same time. The old key was not caution, it was a refusal of a
-- standard configuration.
--
-- WRITTEN BY HAND, and the reason is the rule in CLAUDE.local.md: the migration
-- history has drifted from the schema, so `migrate dev` attaches somebody
-- else's changes to yours. What the generator wanted to add on top of this,
-- and what was therefore thrown out:
--   * DROP DEFAULT on `id` and `updated_at` for hosts, profiles,
--     profile_node_bindings, regions, hwid_user_devices;
--   * a recreate of six foreign keys;
--   * one index rename.
-- All of it is real drift, and none of it is this change. A DROP DEFAULT on a
-- uuid primary key breaks a raw INSERT six months later, in somebody else's
-- script, with no clue pointing here.
--
-- It also refused to run at all non-interactively, because the column is
-- required and 30 rows already exist. That is the right instinct and the wrong
-- remedy: a DEFAULT would have filed every existing UDP listener as TCP. The
-- column is added nullable, backfilled from what each row actually is, and
-- only then made NOT NULL.
--
-- ROLLBACK (verified by hand before this was committed):
--   ALTER TABLE "profile_node_bindings" DROP CONSTRAINT "profile_node_bindings_node_id_port_transport_key";
--   ALTER TABLE "profile_node_bindings" DROP COLUMN "transport";
--   ALTER TABLE "profile_node_bindings" ADD CONSTRAINT "profile_node_bindings_node_id_port_key" UNIQUE ("node_id", "port");
--   DROP INDEX "inbounds_node_id_port_transport_key";
--   ALTER TABLE "inbounds" DROP COLUMN "transport";
--   CREATE UNIQUE INDEX "inbounds_node_id_port_key" ON "inbounds"("node_id", "port");

-- ───── 1. The column, nullable for now ─────
ALTER TABLE "profile_node_bindings" ADD COLUMN "transport" VARCHAR(3);
ALTER TABLE "inbounds" ADD COLUMN "transport" VARCHAR(3);

-- ───── 2. Backfill ─────
--
-- The mapping is duplicated here on purpose: a migration is a SNAPSHOT of what
-- was true when it ran, and it must not start depending on a table in the
-- application that will keep moving. PROTOCOL_TRANSPORT in packages/shared is
-- the living copy; this is the dead one, and that is correct.
--
-- xray is the one protocol whose transport is not fixed by its name: `network`
-- = kcp puts it on UDP. `inbounds` carries its own config; a binding has to
-- look at its profile.
UPDATE "inbounds" SET "transport" = CASE
  WHEN "protocol" IN ('hysteria', 'tuic', 'amneziawg') THEN 'udp'
  WHEN "protocol" = 'xray' AND "config"->>'network' = 'kcp' THEN 'udp'
  WHEN "protocol" IN ('xray', 'naive', 'anytls', 'shadowtls', 'shadowsocks', 'mtproto', 'mieru') THEN 'tcp'
  ELSE NULL
END;

UPDATE "profile_node_bindings" b SET "transport" = CASE
  WHEN p."protocol" IN ('hysteria', 'tuic', 'amneziawg') THEN 'udp'
  WHEN p."protocol" = 'xray'
       AND COALESCE(b."overrides"->>'network', p."config"->>'network') = 'kcp' THEN 'udp'
  WHEN p."protocol" IN ('xray', 'naive', 'anytls', 'shadowtls', 'shadowsocks', 'mtproto', 'mieru') THEN 'tcp'
  ELSE NULL
END
FROM "profiles" p
WHERE p."id" = b."profile_id";

-- ───── 3. Refuse to guess ─────
--
-- A row whose protocol is not in the list above has no transport, and filing
-- it as TCP would be an invention. Stop here and say which ones, rather than
-- write something plausible into a uniqueness key.
DO $$
DECLARE unknown_rows TEXT;
BEGIN
  SELECT string_agg(DISTINCT x.protocol, ', ') INTO unknown_rows FROM (
    SELECT "protocol" FROM "inbounds" WHERE "transport" IS NULL
    UNION
    SELECT p."protocol" FROM "profile_node_bindings" b
      JOIN "profiles" p ON p."id" = b."profile_id" WHERE b."transport" IS NULL
  ) x;
  IF unknown_rows IS NOT NULL THEN
    RAISE EXCEPTION 'cannot decide a transport for protocol(s): %. Add them to the CASE above and to PROTOCOL_TRANSPORT in packages/shared.', unknown_rows;
  END IF;
END $$;

-- ───── 4. Refuse to pick a winner ─────
--
-- If two rows already share (node, port, transport) the new key cannot be
-- built, and choosing which one survives is not a migration's decision: both
-- were deployed by an operator and one of them is about to stop working. Fail
-- with the pairs named, so the operator fixes it with the knowledge of which
-- profile is which.
DO $$
DECLARE dupes TEXT;
BEGIN
  SELECT string_agg(format('node %s port %s/%s (%s rows)', "node_id", "port", "transport", cnt), E'\n')
    INTO dupes
    FROM (
      SELECT "node_id", "port", "transport", count(*) AS cnt
        FROM "profile_node_bindings"
       GROUP BY 1, 2, 3 HAVING count(*) > 1
    ) d;
  IF dupes IS NOT NULL THEN
    RAISE EXCEPTION E'profile_node_bindings already holds rows that collide under [node_id, port, transport]:\n%', dupes;
  END IF;

  SELECT string_agg(format('node %s port %s/%s (%s rows)', "node_id", "port", "transport", cnt), E'\n')
    INTO dupes
    FROM (
      SELECT "node_id", "port", "transport", count(*) AS cnt
        FROM "inbounds"
       GROUP BY 1, 2, 3 HAVING count(*) > 1
    ) d;
  IF dupes IS NOT NULL THEN
    RAISE EXCEPTION E'inbounds already holds rows that collide under [node_id, port, transport]:\n%', dupes;
  END IF;
END $$;

-- ───── 5. Lock it down ─────
--
-- NOT NULL without a DEFAULT: a caller that forgets the transport is refused
-- rather than silently filed as TCP. Every writer goes through the service,
-- which derives it.
ALTER TABLE "profile_node_bindings" ALTER COLUMN "transport" SET NOT NULL;
ALTER TABLE "inbounds" ALTER COLUMN "transport" SET NOT NULL;

-- ───── 6. Swap the key ─────
ALTER TABLE "profile_node_bindings" DROP CONSTRAINT "profile_node_bindings_node_id_port_key";
ALTER TABLE "profile_node_bindings" ADD CONSTRAINT "profile_node_bindings_node_id_port_transport_key" UNIQUE ("node_id", "port", "transport");

-- ⚠ Not symmetric with the table above, and that is the drift itself: on
-- `profile_node_bindings` the uniqueness is a table CONSTRAINT, while on
-- `inbounds` the same `@@unique` is a bare UNIQUE INDEX, because that table
-- was created by a hand-written migration. `ALTER TABLE ... DROP CONSTRAINT`
-- fails there with 42704, which is how this was found. Each is dropped the way
-- it actually exists.
DROP INDEX "inbounds_node_id_port_key";
CREATE UNIQUE INDEX "inbounds_node_id_port_transport_key" ON "inbounds"("node_id", "port", "transport");

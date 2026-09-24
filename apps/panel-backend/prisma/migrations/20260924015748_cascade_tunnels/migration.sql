-- Phase 8: the AmneziaWG tunnel a cascade leg rides in when its underlay is
-- `awg` (linkParams.underlay on a position or a direction).
--
-- One row per NODE PAIR of a cascade: every direction crossing from A to B
-- rides one tunnel. `index` is panel-wide and unique, and it is the whole
-- identity on a machine: the interface is awg-l<index>, and the inner /30 and
-- the UDP port are derived from it (cascade-tunnel.ts), so two tunnels on one
-- node can collide on none of the three. `port` is lifted out of `config` for
-- the port check, the way cascade_links.port is.
--
-- Nothing to backfill: no leg had an underlay before this. The table starts
-- empty and a save with `underlay: awg` fills it.
--
-- WRITTEN BY HAND: `migrate dev --create-only` exits on "Drift detected" before
-- drafting anything (see CLAUDE.local.md). `migrate status` was clean on both
-- databases before this was written.
--
-- ROLLBACK (run by hand on the test database, then the forward migration run
-- again):
--   DROP TABLE "cascade_tunnels";

CREATE TABLE "cascade_tunnels" (
    "id" UUID NOT NULL,
    "cascade_id" UUID NOT NULL,
    "from_node_id" UUID NOT NULL,
    "to_node_id" UUID NOT NULL,
    "index" INTEGER NOT NULL,
    "port" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cascade_tunnels_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cascade_tunnels_index_key" ON "cascade_tunnels"("index");
CREATE UNIQUE INDEX "cascade_tunnels_cascade_id_from_node_id_to_node_id_key"
    ON "cascade_tunnels"("cascade_id", "from_node_id", "to_node_id");
CREATE INDEX "cascade_tunnels_from_node_id_idx" ON "cascade_tunnels"("from_node_id");
CREATE INDEX "cascade_tunnels_to_node_id_port_idx" ON "cascade_tunnels"("to_node_id", "port");

ALTER TABLE "cascade_tunnels"
    ADD CONSTRAINT "cascade_tunnels_cascade_id_fkey"
    FOREIGN KEY ("cascade_id") REFERENCES "cascades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cascade_tunnels"
    ADD CONSTRAINT "cascade_tunnels_from_node_id_fkey"
    FOREIGN KEY ("from_node_id") REFERENCES "nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cascade_tunnels"
    ADD CONSTRAINT "cascade_tunnels_to_node_id_fkey"
    FOREIGN KEY ("to_node_id") REFERENCES "nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

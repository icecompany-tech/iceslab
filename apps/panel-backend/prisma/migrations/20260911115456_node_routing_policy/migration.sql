-- Э3: node-level routing policy.
--
-- Hand-trimmed. `prisma migrate dev` generated this plus a pile of unrelated
-- drift: DROP DEFAULT on the id and updated_at columns of hosts, profiles,
-- profile_node_bindings, regions and hwid_user_devices, a drop-and-recreate of
-- six foreign keys, and an index rename. That drift is real (earlier migrations
-- are hand-written raw SQL and the history no longer matches what Prisma would
-- emit), but it is not this change, and DROP DEFAULT on a uuid primary key is
-- exactly the kind of thing that breaks a raw INSERT somewhere months later.
-- Reconciling it is its own piece of work, with its own rollback.

-- CreateTable
CREATE TABLE "node_policies" (
    "id" UUID NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "node_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "node_policy_rules" (
    "id" UUID NOT NULL,
    "policy_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "match_domain" TEXT[],
    "match_ip" TEXT[],
    "match_port" VARCHAR(64),
    "match_protocol" TEXT[],
    "match_network" VARCHAR(8),
    "action_kind" VARCHAR(16) NOT NULL,
    "action_direction_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "node_policy_rules_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "nodes" ADD COLUMN "policy_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "node_policies_name_key" ON "node_policies"("name");

-- CreateIndex
CREATE INDEX "node_policy_rules_policy_id_position_idx" ON "node_policy_rules"("policy_id", "position");

-- CreateIndex
CREATE INDEX "node_policy_rules_action_direction_id_idx" ON "node_policy_rules"("action_direction_id");

-- CreateIndex
CREATE INDEX "nodes_policy_id_idx" ON "nodes"("policy_id");

-- AddForeignKey
ALTER TABLE "node_policy_rules" ADD CONSTRAINT "node_policy_rules_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "node_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: RESTRICT on purpose. Deleting a cascade direction a policy
-- still routes through has to be refused where the operator can see it, not
-- silently drop the rule and change what the node does with traffic.
ALTER TABLE "node_policy_rules" ADD CONSTRAINT "node_policy_rules_action_direction_id_fkey" FOREIGN KEY ("action_direction_id") REFERENCES "cascade_directions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: SET NULL. Deleting a policy is an explicit act on a screen
-- that lists the nodes running it; the honest result is those nodes going back
-- to no policy, not a refused delete.
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "node_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

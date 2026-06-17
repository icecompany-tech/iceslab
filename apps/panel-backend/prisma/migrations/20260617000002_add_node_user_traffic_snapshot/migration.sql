-- #5 - per-(node, user) cumulative byte snapshot for non-destructive xray
-- stats. The poller stores the last cumulative counters it saw from the agent
-- and bills only the delta, so a lost response or a failed panel-side commit
-- never drops bytes: the snapshot is advanced in the same transaction as the
-- user_traffic increments, so a rolled-back tick re-derives the delta from the
-- un-advanced baseline on the next poll.
CREATE TABLE "node_user_traffic_snapshot" (
    "node_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "cum_in" BIGINT NOT NULL DEFAULT 0,
    "cum_out" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "node_user_traffic_snapshot_pkey" PRIMARY KEY ("node_id", "user_id")
);

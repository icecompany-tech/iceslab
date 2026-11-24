CREATE TABLE "node_minute_traffic" (
    "node_id" UUID NOT NULL REFERENCES "nodes"("id") ON DELETE CASCADE,
    "minute" TIMESTAMPTZ(6) NOT NULL,
    "bytes" BIGINT NOT NULL CHECK ("bytes" >= 0),
    CONSTRAINT "node_minute_traffic_pkey" PRIMARY KEY ("node_id", "minute")
);
CREATE INDEX "node_minute_traffic_minute_idx" ON "node_minute_traffic" ("minute");

CREATE TABLE "node_stats_poll_cursors" (
    "node_id" UUID PRIMARY KEY REFERENCES "nodes"("id") ON DELETE CASCADE,
    "observation_id" UUID,
    "scheduled_at" TIMESTAMPTZ(6),
    "lease_token" UUID,
    "lease_until" TIMESTAMPTZ(6)
);

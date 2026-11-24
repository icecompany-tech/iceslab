-- This table accepts finalized measurements only. The existing node usage
-- history lacks collection coverage and cannot backfill it.
CREATE TABLE "dashboard_client_traffic_days" (
    "date" DATE NOT NULL,
    "total_bytes" BIGINT NOT NULL,
    "to_users_bytes" BIGINT,
    "from_users_bytes" BIGINT,

    CONSTRAINT "dashboard_client_traffic_days_pkey" PRIMARY KEY ("date"),
    CONSTRAINT "dashboard_client_traffic_days_total_check" CHECK ("total_bytes" >= 0),
    CONSTRAINT "dashboard_client_traffic_days_directions_check" CHECK (
        ("to_users_bytes" IS NULL AND "from_users_bytes" IS NULL)
        OR (
            "to_users_bytes" IS NOT NULL AND "from_users_bytes" IS NOT NULL
            AND "to_users_bytes" >= 0 AND "from_users_bytes" >= 0
            AND "to_users_bytes"::numeric + "from_users_bytes" = "total_bytes"
        )
    )
);

-- C3-auto: a cascade is either a sequential 'chain' (default/legacy) or a
-- 'balancer' (one entry that latency-balances across N parallel exits, the
-- "auto" / optimal-location node). Non-breaking: existing cascades default to
-- 'chain', so their generated fragments stay byte-identical.
ALTER TABLE "cascades" ADD COLUMN "mode" VARCHAR(16) NOT NULL DEFAULT 'chain';

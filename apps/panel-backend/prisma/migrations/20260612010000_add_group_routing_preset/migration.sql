-- R3-a: per-squad routing-preset override. Null = inherit the panel-wide
-- default. A user's effective preset is the single distinct non-null override
-- across their squads (resolved in subscription.service).
ALTER TABLE "groups" ADD COLUMN "routing_preset" VARCHAR(32);

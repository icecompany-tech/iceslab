-- Per-cascade control over the "cascade leak fix": when true (default/legacy),
-- the cascade's non-entry hops are hidden from the raw subscription so clients
-- reach the chain only via its entry ("Auto"). Uncheck in the panel to ALSO
-- expose those exit nodes as directly-connectable subscription endpoints.
-- Non-breaking: existing cascades default to true, preserving current hiding.
ALTER TABLE "cascades" ADD COLUMN "hide_hops_from_sub" BOOLEAN NOT NULL DEFAULT true;

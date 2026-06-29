-- WARP egress (feat/warp-native): per-node Cloudflare WARP egress.
-- warp_enabled: route this node's xray inbound out through WARP (a wireguard
--   outbound + routing rule the node renders into its xray config).
-- warp_account: the registered WARP device creds blob (secretKey, address,
--   reserved, endpoint, token, license, ...). Json so the shape can evolve
--   without a migration. See docs/studies/STUDY-warp-native.md.
ALTER TABLE "nodes" ADD COLUMN "warp_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "nodes" ADD COLUMN "warp_account" JSONB;

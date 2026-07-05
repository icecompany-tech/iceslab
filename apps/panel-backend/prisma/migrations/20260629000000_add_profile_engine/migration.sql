-- Engine-choice (EC5): which proxy core renders a profile's inbound.
-- NULL = the protocol's native core (xray for vless/vmess/trojan/ss, hysteria
-- for hy2, singbox for tuic/anytls). 'singbox' serves a shared protocol via the
-- sing-box engine. The node-agent dispatches inbounds by (protocol, engine).
ALTER TABLE "profiles" ADD COLUMN "engine" VARCHAR(16);

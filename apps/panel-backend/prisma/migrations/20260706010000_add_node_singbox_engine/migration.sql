-- Engine-choice: opt a node into the sing-box engine alongside its native core
-- (so vless/vmess/trojan/hy2/ss profiles with engine=singbox can run on it). The
-- panel adds --with-singbox to the install command when set. Non-breaking:
-- existing nodes default to false.
ALTER TABLE "nodes" ADD COLUMN "singbox_engine" BOOLEAN NOT NULL DEFAULT false;

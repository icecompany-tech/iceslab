-- Seed the rest of the well-known clients so operators don't hand-author the
-- whole User-Agent -> format table. The original seed (20260505152655) covered
-- only singbox / clash / xrayjson / wgconf / plain; the surge, quantumultx,
-- loon, outline and xkeen formats had NO detection rule, so those clients fell
-- through to the `.*` -> plain catch-all and got a base64 list they can't
-- import. These rules slot between the original specific rules (priorities
-- 10-60) and the Default catch-all (900).
--
-- Patterns use the (?i) inline flag (matchFormatForUserAgent strips it and
-- passes `i` to RegExp). ON CONFLICT (name) DO NOTHING keeps this idempotent
-- and never clobbers a rule an operator has already edited.
INSERT INTO "subscription_response_rules" ("id", "name", "ua_pattern", "format", "priority", "updated_at") VALUES
  -- sing-box core clients (rich config: routing, DNS, per-rule outbounds)
  (gen_random_uuid(), 'Karing',       '(?i)karing',        'singbox',     100, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Throne',       '(?i)throne',        'singbox',     110, CURRENT_TIMESTAMP),
  -- Xray core client
  (gen_random_uuid(), 'FoXray',       '(?i)foxray',        'xrayjson',    120, CURRENT_TIMESTAMP),
  -- Surge + Surge-compatible (Surfboard reads Surge .conf). Surfboard first so
  -- it can never be shadowed by a future broader surge pattern.
  (gen_random_uuid(), 'Surfboard',    '(?i)surfboard',     'surge',       130, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Surge',        '(?i)surge',         'surge',       140, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Quantumult X', '(?i)quantumult',    'quantumultx', 150, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Loon',         '(?i)loon',          'loon',        160, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Outline',      '(?i)outline',       'outline',     170, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'XKeen',        '(?i)xkeen',         'xkeen',       180, CURRENT_TIMESTAMP),
  -- Universal base64 clients. Default already routes them to plain, but listing
  -- them explicitly lets the operator see they're recognized and re-target the
  -- format per client if they ever want to.
  (gen_random_uuid(), 'Shadowrocket', '(?i)shadowrocket',  'plain',       200, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Streisand',    '(?i)streisand',     'plain',       210, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'V2Box',        '(?i)v2box',         'plain',       220, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Happ',         '(?i)happ',          'plain',       230, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;

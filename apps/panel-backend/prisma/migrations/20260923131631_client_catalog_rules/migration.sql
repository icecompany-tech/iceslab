-- The User-Agent rules brought in line with the client catalog
-- (packages/shared/src/clients.ts, CLIENT_RULES).
--
-- What the recon found (docs/plan/delivery-by-client.md, section 5.2), with
-- the strings the apps actually send:
--   - Clash Verge Rev sends `clash-verge/...`; the seed `Clash` is
--     case-sensitive, so it matched nothing and the client got plain;
--   - Stash sends `Stash`; the seed carried `stash` in lower case inside the
--     Clash rule, so it missed too;
--   - Loon also introduces itself as `Decar`, which `(?i)loon` does not match;
--   - NekoBox asks for it in its own User-Agent: "(Prefer ClashMeta Format)",
--     and was being handed sing-box.
--
-- WHICH ROWS ARE OURS. The table has no flag for a seeded row, so a row is
-- treated as seeded exactly when its pattern AND its format are still what the
-- seed wrote (20260505152655, 20260617020000). Such a row is rewritten to the
-- catalog. A row an operator edited (another pattern or another format) is
-- left as it is, and so is every rule an operator added. The priority is not
-- touched on a rewritten row: the rules page reorders by priority, and a
-- rewrite must not undo an operator's order.
--
-- A rule that is new in the catalog is added with the catalog's priority, which
-- sits before the catch-all (Default, 900); ON CONFLICT (name) leaves an
-- operator's rule of the same name alone.
--
-- The test that holds this file to the catalog is
-- src/modules/srr/srr.catalog-migration.test.ts: it seeds the old rows plus an
-- operator's edits, runs the statements below, and checks both that the
-- operator's rows survived and that an untouched table ends up equal to
-- CLIENT_RULES.
--
-- WRITTEN BY HAND: `migrate dev --create-only` exits on "Drift detected" before
-- drafting anything (see CLAUDE.local.md). `migrate status` was clean on both
-- databases before this was written. Data only, no schema change.
--
-- ROLLBACK (by hand; restores the seeded values only on rows this rewrote):
--   UPDATE "subscription_response_rules" SET "ua_pattern" = 'Clash|ClashX|FlClash|stash|mihomo'
--     WHERE "name" = 'Clash' AND "ua_pattern" = '(?i)clash|mihomo' AND "format" = 'clash';
--   UPDATE "subscription_response_rules" SET "format" = 'singbox'
--     WHERE "name" = 'NekoBox/NekoRay' AND "ua_pattern" = 'NekoBox|NekoRay' AND "format" = 'clash';
--   UPDATE "subscription_response_rules" SET "ua_pattern" = '(?i)loon'
--     WHERE "name" = 'Loon' AND "ua_pattern" = '(?i)loon|decar' AND "format" = 'loon';
--   DELETE FROM "subscription_response_rules" WHERE "name" = 'Stash' AND "ua_pattern" = '(?i)stash';

UPDATE "subscription_response_rules" AS r
SET "ua_pattern" = v.new_pattern,
    "format" = v.new_format,
    "updated_at" = CURRENT_TIMESTAMP
FROM (VALUES
  ('Clash',           'Clash|ClashX|FlClash|stash|mihomo', 'clash',   '(?i)clash|mihomo', 'clash'),
  ('NekoBox/NekoRay', 'NekoBox|NekoRay',                   'singbox', 'NekoBox|NekoRay',  'clash'),
  ('Loon',            '(?i)loon',                          'loon',    '(?i)loon|decar',   'loon')
) AS v(name, old_pattern, old_format, new_pattern, new_format)
WHERE r."name" = v.name
  AND r."ua_pattern" = v.old_pattern
  AND r."format" = v.old_format;

INSERT INTO "subscription_response_rules" ("id", "name", "ua_pattern", "format", "priority", "updated_at") VALUES
  (gen_random_uuid(), 'Stash', '(?i)stash', 'clash', 45, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;

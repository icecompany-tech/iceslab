BEGIN;

-- A database default appends new squads from every creation path.
ALTER TABLE "groups" ADD COLUMN "display_order" SERIAL NOT NULL;

-- Preserve the existing created-at ordering, resolving equal timestamps by UUID.
WITH positions AS (
    SELECT id, row_number() OVER (ORDER BY created_at, id) AS position
    FROM "groups"
)
UPDATE "groups" AS squad
SET display_order = positions.position::integer
FROM positions
WHERE squad.id = positions.id;

COMMIT;

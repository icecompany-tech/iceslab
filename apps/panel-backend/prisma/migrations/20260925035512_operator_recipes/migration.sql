-- The operator's own recipes and the ones they hid (25.09).
--
--   operator_recipes   a recipe imported with `save: true`, keyed by the
--                      recipe's own id: a second save of that id replaces the
--                      row. `recipe` is the recipe as RecipeSchema v2 read it.
--   recipe_hidden      the ids hidden from the recipe rail, a personal list
--                      replaced whole on every write.
--
-- WRITTEN BY HAND: `migrate dev --create-only` exits on "Drift detected" before
-- drafting anything (see CLAUDE.local.md). `migrate status` was clean on both
-- databases before this was written. The name is the UTC stamp, after
-- 20260924192101_geo_set_version_source. `updated_at` has no default, the
-- form Prisma itself writes for @updatedAt.
--
-- ROLLBACK (run by hand on the test database, then the forward migration run
-- again):
--   DROP TABLE "recipe_hidden";
--   DROP TABLE "operator_recipes";

CREATE TABLE "operator_recipes" (
    "id" TEXT NOT NULL,
    "recipe" JSONB NOT NULL,
    "source_url" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "operator_recipes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "recipe_hidden" (
    "id" TEXT NOT NULL,

    CONSTRAINT "recipe_hidden_pkey" PRIMARY KEY ("id")
);

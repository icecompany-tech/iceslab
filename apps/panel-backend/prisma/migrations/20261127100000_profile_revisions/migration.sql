CREATE TABLE "profile_revisions" (
    "profile_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" VARCHAR(16) NOT NULL,
    "actor_type" VARCHAR(16),
    "actor_name" VARCHAR(128),
    "source" VARCHAR(16),
    "restored_from" INTEGER,
    "document" JSONB NOT NULL,
    "protected_version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "profile_revisions_pkey" PRIMARY KEY ("profile_id", "revision"),
    CONSTRAINT "profile_revisions_profile_id_fkey" FOREIGN KEY ("profile_id")
        REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

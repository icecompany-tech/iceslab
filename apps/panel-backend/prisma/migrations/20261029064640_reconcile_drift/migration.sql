-- The schema and the migration history agree again (drift, ARCH 29.10).
--
-- Since 22.09 `migrate dev --create-only` stopped on "Drift detected" and every
-- migration was written by hand. What the generator wanted, against a database
-- built from all migrations, was 22 statements. Split by who is right:
--   - DEFAULTs on ids, updated_at and route_policies' lists (gen_random_uuid(),
--     now(), ARRAY[]): the database is right, a raw INSERT relies on them; the
--     schema now describes them (@default(dbgenerated(...)), @default(now()),
--     @default([])). No DDL.
--   - the two A-150 backup tables: kept until v0.3.1, described in the schema
--     with @@ignore (a150-backup.prisma). No DDL.
--   - six foreign keys whose ON UPDATE the history left unset (NO ACTION) while
--     the schema means CASCADE, Prisma's default: this migration. The keys are
--     uuids nobody updates, so the two behave alike; the point is one shape on
--     every database. The dev database already had CASCADE on these six (left
--     by a hand rollback on 21.09), which is what "Drift detected" was about.
--   - one unique index under a hand-written name: renamed to Prisma's. Metadata
--     only.
--
-- NOT VALID, then VALIDATE: the new key is added without the table-wide check
-- under the ACCESS EXCLUSIVE lock, and the check runs after under a lighter
-- one (an operator's amneziawg_peers holds a row per user, ~30 000).
--
-- WRITTEN BY HAND. `migrate status` clean before and after on each copy it was
-- run on.
--
-- ROLLBACK (run by hand on the copies, then this migration again):
--   ALTER TABLE "amneziawg_peers" DROP CONSTRAINT "amneziawg_peers_profile_id_fkey";
--   ALTER TABLE "amneziawg_peers" ADD CONSTRAINT "amneziawg_peers_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE;
--   ALTER TABLE "api_tokens" DROP CONSTRAINT "api_tokens_created_by_admin_id_fkey";
--   ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_created_by_admin_id_fkey" FOREIGN KEY ("created_by_admin_id") REFERENCES "admin_users"("id") ON DELETE SET NULL;
--   ALTER TABLE "group_profiles" DROP CONSTRAINT "group_profiles_group_id_fkey";
--   ALTER TABLE "group_profiles" ADD CONSTRAINT "group_profiles_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE;
--   ALTER TABLE "group_profiles" DROP CONSTRAINT "group_profiles_profile_id_fkey";
--   ALTER TABLE "group_profiles" ADD CONSTRAINT "group_profiles_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE;
--   ALTER TABLE "profile_node_bindings" DROP CONSTRAINT "profile_node_bindings_node_id_fkey";
--   ALTER TABLE "profile_node_bindings" ADD CONSTRAINT "profile_node_bindings_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "nodes"("id") ON DELETE RESTRICT;
--   ALTER TABLE "profile_node_bindings" DROP CONSTRAINT "profile_node_bindings_profile_id_fkey";
--   ALTER TABLE "profile_node_bindings" ADD CONSTRAINT "profile_node_bindings_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE;
--   ALTER INDEX "cascade_links_cascade_id_from_node_id_to_node_id_direction__key" RENAME TO "cascade_links_cascade_id_from_to_direction_key";
--   DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261029064640_reconcile_drift';

ALTER TABLE "amneziawg_peers" DROP CONSTRAINT "amneziawg_peers_profile_id_fkey";
ALTER TABLE "amneziawg_peers" ADD CONSTRAINT "amneziawg_peers_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "amneziawg_peers" VALIDATE CONSTRAINT "amneziawg_peers_profile_id_fkey";

ALTER TABLE "api_tokens" DROP CONSTRAINT "api_tokens_created_by_admin_id_fkey";
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_created_by_admin_id_fkey" FOREIGN KEY ("created_by_admin_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "api_tokens" VALIDATE CONSTRAINT "api_tokens_created_by_admin_id_fkey";

ALTER TABLE "group_profiles" DROP CONSTRAINT "group_profiles_group_id_fkey";
ALTER TABLE "group_profiles" ADD CONSTRAINT "group_profiles_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "group_profiles" VALIDATE CONSTRAINT "group_profiles_group_id_fkey";

ALTER TABLE "group_profiles" DROP CONSTRAINT "group_profiles_profile_id_fkey";
ALTER TABLE "group_profiles" ADD CONSTRAINT "group_profiles_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "group_profiles" VALIDATE CONSTRAINT "group_profiles_profile_id_fkey";

ALTER TABLE "profile_node_bindings" DROP CONSTRAINT "profile_node_bindings_node_id_fkey";
ALTER TABLE "profile_node_bindings" ADD CONSTRAINT "profile_node_bindings_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "nodes"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "profile_node_bindings" VALIDATE CONSTRAINT "profile_node_bindings_node_id_fkey";

ALTER TABLE "profile_node_bindings" DROP CONSTRAINT "profile_node_bindings_profile_id_fkey";
ALTER TABLE "profile_node_bindings" ADD CONSTRAINT "profile_node_bindings_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "profile_node_bindings" VALIDATE CONSTRAINT "profile_node_bindings_profile_id_fkey";

ALTER INDEX "cascade_links_cascade_id_from_to_direction_key" RENAME TO "cascade_links_cascade_id_from_node_id_to_node_id_direction__key";

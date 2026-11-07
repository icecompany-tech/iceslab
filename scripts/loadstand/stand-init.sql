-- Once, after the migrations. The extension sits in its own schema so the
-- public one stays exactly what Prisma expects.
create schema if not exists b2;
create extension if not exists pg_stat_statements schema b2;

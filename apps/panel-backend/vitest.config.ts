import { defineConfig } from 'vitest/config';
import { config as dotenvConfig } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envFromFile = dotenvConfig({
  path: resolve(__dirname, '../../.env.test'),
}).parsed ?? {};

// `.env.test` is the local dev fallback (Docker compose dev stack on
// non-standard ports). In CI the workflow sets DATABASE_URL / REDIS_URL /
// JWT_SECRET / PUBLIC_URL via `env:` blocks pointing at the GH Actions
// service containers (postgres on 5432, redis on 6379). Without this
// merge, the dotenv values silently overwrote the CI env and every test
// tried to connect to localhost:5433 → ECONNREFUSED on the first
// `cleanDatabase()`. process.env wins per-key.
const testEnv: Record<string, string> = { ...envFromFile };
for (const k of Object.keys(envFromFile)) {
  const v = process.env[k];
  if (typeof v === 'string' && v.length > 0) testEnv[k] = v;
}

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    env: testEnv,
    // Integration tests share a single test Postgres, serialize across files
    // to avoid collisions on cleanDatabase() / unique constraints.
    fileParallelism: false,
    // First beforeEach in each file pays the buildApp() cold-start (~5-12s on
    // WSL: dotenv + Prisma client warmup + Fastify plugins). 30s gives slack.
    // Per-test timeout stays at the default 5s.
    hookTimeout: 30_000,
  },
});

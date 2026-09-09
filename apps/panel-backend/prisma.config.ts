import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// Loads /.env from repo root (two levels up from this file)
config({ path: "../../.env" });

export default defineConfig({
  schema: "prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});

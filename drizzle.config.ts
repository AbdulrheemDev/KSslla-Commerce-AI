import { config as loadEnv } from "dotenv";
import { defineConfig } from "drizzle-kit";

loadEnv({ path: ".env.local" });
loadEnv();

/**
 * Local default only. Real credentials come from DATABASE_URL and are never
 * committed. `drizzle-kit generate` does not connect to the database.
 */
const databaseUrl =
  process.env.MIGRATION_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:5432/kshakha";

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: databaseUrl },
  strict: true,
  verbose: true,
});

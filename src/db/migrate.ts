import { config as loadEnv } from "dotenv";
import { join } from "node:path";

loadEnv({ path: ".env.local" });
loadEnv();

const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;

if (!url) {
  process.stderr.write(
    "[db] DATABASE_URL (or MIGRATION_DATABASE_URL) is required to run migrations.\n",
  );
  process.exit(1);
}

const { default: postgres } = await import("postgres");
const { drizzle } = await import("drizzle-orm/postgres-js");
const { migrate } = await import("drizzle-orm/postgres-js/migrator");

const client = postgres(url, { max: 1, onnotice: () => undefined });

try {
  await migrate(drizzle(client), { migrationsFolder: join(process.cwd(), "drizzle") });
  process.stdout.write("[db] migrations applied successfully.\n");
} catch (error) {
  process.stderr.write(
    `[db] migration failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
  );
  process.exitCode = 1;
} finally {
  await client.end({ timeout: 5 });
}

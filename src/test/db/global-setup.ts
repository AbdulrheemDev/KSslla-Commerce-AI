import { existsSync } from "node:fs";
import { join } from "node:path";

import EmbeddedPostgres from "embedded-postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { TEST_DATABASE, adminDatabaseUrl, usingExternalDatabase } from "@/test/db/config";

const silent = { onnotice: () => undefined } as const;

async function startEmbeddedCluster(): Promise<EmbeddedPostgres> {
  const cluster = new EmbeddedPostgres({
    databaseDir: join(process.cwd(), TEST_DATABASE.dataDir),
    user: TEST_DATABASE.adminUser,
    password: TEST_DATABASE.adminPassword,
    port: TEST_DATABASE.port,
    persistent: true,
  });

  const dataDirectory = join(process.cwd(), TEST_DATABASE.dataDir);

  if (!existsSync(join(dataDirectory, "PG_VERSION"))) {
    await cluster.initialise();
  }

  try {
    await cluster.start();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/already running|address already in use/i.test(message)) {
      throw error;
    }
  }

  return cluster;
}

async function prepareDatabase(): Promise<void> {
  const admin = postgres(adminDatabaseUrl(), { max: 1, ...silent });

  try {
    await admin.unsafe(`drop database if exists "${TEST_DATABASE.name}" with (force)`);
    await admin.unsafe(`create database "${TEST_DATABASE.name}"`);

    await admin.unsafe(
      `do $$ begin
         if not exists (select 1 from pg_roles where rolname = '${TEST_DATABASE.appUser}') then
           create role "${TEST_DATABASE.appUser}" login password '${TEST_DATABASE.appPassword}';
         else
           alter role "${TEST_DATABASE.appUser}" login password '${TEST_DATABASE.appPassword}';
         end if;
       end $$;`,
    );
  } finally {
    await admin.end({ timeout: 5 });
  }

  const target = postgres(adminDatabaseUrl().replace(/\/[^/]*$/, `/${TEST_DATABASE.name}`), {
    max: 1,
    ...silent,
  });

  try {
    await migrate(drizzle(target), { migrationsFolder: join(process.cwd(), "drizzle") });

    // Least privilege for the role the application uses: DML only, no DDL and
    // no BYPASSRLS, so every tenant policy is exercised by the tests.
    await target.unsafe(`grant usage on schema public, app to "${TEST_DATABASE.appUser}"`);
    await target.unsafe(
      `grant select, insert, update, delete on all tables in schema public to "${TEST_DATABASE.appUser}"`,
    );
    await target.unsafe(
      `grant usage, select on all sequences in schema public to "${TEST_DATABASE.appUser}"`,
    );
  } finally {
    await target.end({ timeout: 5 });
  }
}

export default async function setup(): Promise<() => Promise<void>> {
  const cluster = usingExternalDatabase() ? null : await startEmbeddedCluster();

  await prepareDatabase();

  return async () => {
    await cluster?.stop();
  };
}

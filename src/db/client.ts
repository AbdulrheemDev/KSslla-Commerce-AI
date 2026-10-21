import "server-only";

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@/db/schema";
import { getServerEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";

/**
 * PostgreSQL connection layer.
 *
 * UI code must never import this module. Route handlers, server components and
 * use cases obtain the database through `getDb()`; tests may build isolated
 * connections with `createDbConnection()`.
 */
export type Database = PostgresJsDatabase<typeof schema>;

export interface DbConnection {
  db: Database;
  client: ReturnType<typeof postgres>;
}

export interface CreateDbOptions {
  max?: number;
}

export function createDbConnection(url: string, options: CreateDbOptions = {}): DbConnection {
  if (!url.trim()) {
    throw new AppError({
      code: "CONFIG_INVALID",
      message: "A database connection URL is required.",
    });
  }

  const client = postgres(url, {
    max: options.max ?? 10,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => undefined,
  });

  return {
    db: drizzle(client, { schema }),
    client,
  };
}

let singleton: DbConnection | null = null;

export function getDbConnection(): DbConnection {
  if (singleton) {
    return singleton;
  }

  const env = getServerEnv();
  if (!env.DATABASE_URL) {
    throw new AppError({
      code: "CONFIG_INVALID",
      message: "DATABASE_URL is not configured.",
    });
  }

  singleton = createDbConnection(env.DATABASE_URL);
  return singleton;
}

export function getDb(): Database {
  return getDbConnection().db;
}

/** Test/shutdown helper. */
export async function closeDb(): Promise<void> {
  if (!singleton) return;
  const current = singleton;
  singleton = null;
  await current.client.end({ timeout: 5 });
}

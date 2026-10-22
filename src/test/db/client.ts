import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import type { Database } from "@/db/client";
import * as schema from "@/db/schema";
import { adminDatabaseUrl, appDatabaseUrl, TEST_DATABASE } from "@/test/db/config";

/**
 * Database handle for tests. Every statement runs as the unprivileged app role,
 * so row-level security behaves exactly as it will in production.
 */
let client: ReturnType<typeof postgres> | null = null;
let db: Database | null = null;

export function getTestDb(): Database {
  if (!db) {
    client = postgres(appDatabaseUrl(), { max: 5, onnotice: () => undefined });
    db = drizzle(client, { schema });
  }
  return db;
}

/** Wipes tenant data between tests. Runs as the privileged role. */
export async function resetDatabase(): Promise<void> {
  const admin = postgres(adminDatabaseUrl().replace(/\/[^/]*$/, `/${TEST_DATABASE.name}`), {
    max: 1,
    onnotice: () => undefined,
  });

  try {
    await admin.unsafe(
      `truncate table "webhook_events", "audit_logs", "invitations", "stores",
         "organization_members", "sessions", "organizations", "users" restart identity cascade`,
    );
  } finally {
    await admin.end({ timeout: 5 });
  }
}

/** Runs a statement as the privileged role. Test-only; never used by app code. */
export async function executeAsAdmin(statement: string): Promise<void> {
  const admin = postgres(adminDatabaseUrl().replace(/\/[^/]*$/, `/${TEST_DATABASE.name}`), {
    max: 1,
    onnotice: () => undefined,
  });

  try {
    await admin.unsafe(statement);
  } finally {
    await admin.end({ timeout: 5 });
  }
}

export async function closeTestDb(): Promise<void> {
  if (!client) return;
  const current = client;
  client = null;
  db = null;
  await current.end({ timeout: 5 });
}

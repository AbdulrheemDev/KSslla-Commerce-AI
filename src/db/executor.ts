import type { Database } from "@/db/client";

/**
 * Anything that can run queries: the pooled database or a tenant transaction.
 * Repositories accept this so the same code works inside and outside a
 * transaction without widening access.
 */
export type DbExecutor = Pick<Database, "select" | "insert" | "update" | "delete" | "execute">;

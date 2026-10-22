import type { Transaction } from "@/db/tenant";
import {
  loadOrderBounds,
  loadOrders,
  type OrderBounds,
  type OrderRow,
} from "@/modules/intelligence/infrastructure/intelligence-repository";

/**
 * Read access for sales intelligence.
 *
 * Phase 07 already owns the only query that reads orders for analysis, and it
 * selects exactly the columns this phase needs (`statusSlug`, `totalAmount`,
 * `currency`, `draft`, `orderDate`). Duplicating that SQL here would create two
 * places for the order population to drift apart, so this module **delegates**
 * instead of re-querying. What it adds is a sales-shaped entry point and a
 * comment that makes the reuse explicit.
 *
 * Tenant safety is inherited: the caller runs inside `withTenantTransaction`,
 * and every statement filters on `storeId`, which itself was verified against
 * the session's organization before the transaction opened.
 */

export interface SalesWindowData {
  bounds: OrderBounds;
  current: OrderRow[];
  previous: OrderRow[];
}

export async function loadSalesWindow(
  tx: Transaction,
  storeId: string,
  ranges: { current: { from: Date; to: Date }; previous: { from: Date; to: Date } },
): Promise<SalesWindowData> {
  const [bounds, current, previous] = await Promise.all([
    loadOrderBounds(tx, storeId),
    loadOrders(tx, storeId, ranges.current),
    loadOrders(tx, storeId, ranges.previous),
  ]);

  return { bounds, current, previous };
}

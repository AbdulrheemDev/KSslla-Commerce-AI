import type { InventoryCategoryRef, InventoryProductInput, UnlinkedInventoryEntry } from "./types";

/**
 * The exact shape one store-level read produces.
 *
 * Kept in the domain (not in infrastructure) so the application layer can type
 * the snapshot without importing Drizzle, and so tests can build one by hand.
 */
export interface InventorySnapshotRows {
  /** One entry per catalogued product, sorted by name. */
  readonly products: readonly InventoryProductInput[];
  /** Every categories row of the store, linked or not. */
  readonly categories: readonly InventoryCategoryRef[];
  /** Inventory rows whose `product_id` is null. */
  readonly unlinked: readonly UnlinkedInventoryEntry[];
  /** Raw provider entries, one per quantity key (per variant when present). */
  readonly inventoryEntries: number;
  /** Newest `last_synced_at` across inventory rows, or null when there are none. */
  readonly lastSyncedAt: string | null;
}

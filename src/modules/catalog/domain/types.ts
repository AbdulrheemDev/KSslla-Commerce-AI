/**
 * Catalogue domain types.
 *
 * Framework-free on purpose: nothing here imports Next.js, fetch, Drizzle, or
 * the Salla SDK. The sync service and the repositories depend on these shapes,
 * not on the provider payload.
 */

export const SYNC_RESOURCES = [
  "products",
  "categories",
  "customers",
  "orders",
  "inventory",
] as const;
export type SyncResource = (typeof SYNC_RESOURCES)[number];

export const SYNC_RUN_STATUSES = ["running", "succeeded", "failed"] as const;
export type SyncRunStatus = (typeof SYNC_RUN_STATUSES)[number];

/** A category as normalised from the provider payload. */
export interface CatalogCategoryInput {
  externalId: string;
  name: string;
  parentExternalId: string | null;
  status: string;
  sortOrder: number | null;
  imageUrl: string | null;
  sourceUpdatedAt: Date | null;
  metadata: Record<string, unknown>;
}

/** A product as normalised from the provider payload. */
export interface CatalogProductInput {
  externalId: string;
  name: string;
  sku: string | null;
  productType: string | null;
  status: string;
  priceAmount: string | null;
  currency: string | null;
  regularPriceAmount: string | null;
  salePriceAmount: string | null;
  quantity: number | null;
  isAvailable: boolean;
  url: string | null;
  imageUrl: string | null;
  description: string | null;
  brandName: string | null;
  sourceUpdatedAt: Date | null;
  metadata: Record<string, unknown>;
  /** Category ids as reported by Salla; resolved to local rows during upsert. */
  categoryExternalIds: string[];
}

export interface PersistedCategory {
  id: string;
  externalCategoryId: string;
  name: string;
  parentExternalId: string | null;
  parentCategoryId: string | null;
  parentName: string | null;
  status: string;
  sortOrder: number | null;
  productCount: number;
  sourceUpdatedAt: string | null;
  lastSeenAt: string;
  updatedAt: string;
}

export interface PersistedProduct {
  id: string;
  externalProductId: string;
  name: string;
  sku: string | null;
  productType: string | null;
  status: string;
  priceAmount: string | null;
  currency: string | null;
  regularPriceAmount: string | null;
  salePriceAmount: string | null;
  quantity: number | null;
  isAvailable: boolean;
  url: string | null;
  imageUrl: string | null;
  description: string | null;
  brandName: string | null;
  categories: Array<{ id: string; name: string }>;
  sourceUpdatedAt: string | null;
  lastSeenAt: string;
  updatedAt: string;
}

export interface ProductPage {
  items: PersistedProduct[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface SyncRunSummary {
  id: string;
  resource: SyncResource;
  status: SyncRunStatus;
  correlationId: string;
  itemsProcessed: number;
  itemsCreated: number;
  itemsUpdated: number;
  relationsLinked: number;
  itemsSkipped: number;
  pagesProcessed: number;
  errorCode: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface SyncResourceState {
  resource: SyncResource;
  /** `never` until the first run finishes; `running` while a lease is held. */
  status: "never" | "running" | "succeeded" | "failed";
  lastRun: SyncRunSummary | null;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastErrorCode: string | null;
}

export interface CommerceOverview {
  products: number;
  categories: number;
  lastSyncedAt: string | null;
  sync: Record<SyncResource, SyncResourceState>;
}

export interface SyncProgress {
  runId: string;
  resource: SyncResource;
  status: SyncRunStatus;
  pagesProcessed: number;
  itemsProcessed: number;
  itemsCreated: number;
  itemsUpdated: number;
  relationsLinked: number;
  itemsSkipped: number;
  errorCode: string | null;
}

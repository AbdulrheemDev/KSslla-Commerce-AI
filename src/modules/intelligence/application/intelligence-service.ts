import type { Database } from "@/db/client";
import { withTenantTransaction } from "@/db/tenant";
import { AppError } from "@/lib/errors";
import { assertPermission } from "@/modules/identity/application/authorization";
import type { TenantContext } from "@/modules/identity/application/types";
import {
  computeCategoryIntelligence,
  type CategoryIntelligence,
} from "@/modules/intelligence/domain/categories";
import {
  computeCustomerIntelligence,
  type CustomerIntelligence,
} from "@/modules/intelligence/domain/customers";
import { computeStoreHealth, type StoreHealth } from "@/modules/intelligence/domain/health";
import {
  computeInventoryIntelligence,
  type InventoryIntelligence,
} from "@/modules/intelligence/domain/inventory";
import {
  buildOpportunities,
  type OpportunityList,
} from "@/modules/intelligence/domain/opportunities";
import {
  InvalidPeriodError,
  computeCoverage,
  hasPreviousBaseline,
  previousPeriod,
  resolvePeriod,
  toPeriodView,
  type PeriodRequest,
} from "@/modules/intelligence/domain/period";
import {
  analyseProduct,
  rankProducts,
  summariseProducts,
  type ProductClass,
  type ProductIntelligence,
  type ProductMetricRow,
  type ProductRanking,
  type ProductSummary,
} from "@/modules/intelligence/domain/products";
import { computeSalesMetrics, type SalesMetrics } from "@/modules/intelligence/domain/sales";
import { THRESHOLDS } from "@/modules/intelligence/domain/thresholds";
import type {
  AnalysisPeriod,
  Coverage,
  DataFreshness,
  FreshnessResource,
  IntelligenceEnvelope,
} from "@/modules/intelligence/domain/types";
import {
  loadCategoryRows,
  loadCustomerRows,
  loadInventoryRows,
  loadOrderBounds,
  loadOrders,
  loadProductCategoryLinks,
  loadProductRows,
  type OrderRow,
} from "@/modules/intelligence/infrastructure/intelligence-repository";
import { requireStoreAccess } from "@/modules/stores/application/store-service";
import { resolveResourceState } from "@/modules/sync/application/sync-state";

/**
 * Store-intelligence read model.
 *
 * Everything is computed **on read** from the Phase 04–06 mirrors. No metric is
 * stored, so there is nothing to invalidate and no derived number can drift from
 * the rows it claims to describe. The cost is a handful of aggregate queries per
 * request against indexes that already exist for the list pages; a store large
 * enough to make that slow would first need evidence, which is why no summary
 * table exists yet (ADR-053).
 *
 * Tenant safety: the store is resolved from the session twice — `store:read` is
 * asserted, then `requireStoreAccess` looks the store up inside the caller's
 * organization. The URL's `storeId` is a request, never proof.
 */

const RESOURCES = ["products", "categories", "customers", "orders", "inventory"] as const;

const CLASS_ORDER: Record<ProductClass, number> = {
  inventory_risk: 0,
  star: 1,
  growth_opportunity: 2,
  low_performer: 3,
  stable: 4,
  insufficient_data: 5,
};

const MAX_PRODUCT_ITEMS = 200;

export function periodRequestFromSearch(search: URLSearchParams): PeriodRequest {
  return {
    period: search.get("period"),
    from: search.get("from"),
    to: search.get("to"),
  };
}

export function mapPeriodError(error: unknown): never {
  if (error instanceof InvalidPeriodError) {
    throw new AppError({
      code: "VALIDATION_FAILED",
      message: "Invalid period.",
      details: { field: "period", reason: error.code },
    });
  }
  throw error;
}

export async function resolveFreshness(
  db: Database,
  context: TenantContext,
  storeId: string,
  now: Date,
): Promise<DataFreshness> {
  const states = await Promise.all(
    RESOURCES.map((resource) => resolveResourceState(db, context, storeId, resource)),
  );

  const resources: FreshnessResource[] = states.map((state) => {
    const lastSuccessAt = state.lastSuccessAt ?? null;
    const ageHours = lastSuccessAt
      ? (now.getTime() - new Date(lastSuccessAt).getTime()) / 3_600_000
      : null;

    return {
      resource: state.resource,
      status: state.status,
      lastSuccessAt,
      lastFailureAt: state.lastFailureAt ?? null,
      lastErrorCode: state.lastErrorCode ?? null,
      // A resource that never synced is reported as `never` rather than
      // "stale": day one is not a stale store.
      stale: ageHours !== null && ageHours > THRESHOLDS.STALE_SYNC_HOURS,
    };
  });

  const successes = resources
    .map((resource) => resource.lastSuccessAt)
    .filter((value): value is string => value !== null)
    .sort();

  return {
    syncedAt: successes.at(-1) ?? null,
    resources,
    staleResources: resources
      .filter((resource) => resource.stale)
      .map((resource) => resource.resource),
  };
}

interface Snapshot {
  now: Date;
  period: AnalysisPeriod;
  coverage: Coverage;
  freshness: DataFreshness;
  sales: SalesMetrics;
  productRows: ProductMetricRow[];
  products: ProductIntelligence[];
  summary: ProductSummary;
  rankings: { top: ProductRanking[]; bottom: ProductRanking[] };
  inventory: InventoryIntelligence;
  customers: CustomerIntelligence;
  categories: CategoryIntelligence;
  health: StoreHealth;
  opportunities: OpportunityList;
}

async function loadSnapshot(
  db: Database,
  context: TenantContext,
  storeId: string,
  request: PeriodRequest,
): Promise<Snapshot> {
  assertPermission(context, "store:read");
  await requireStoreAccess(db, context, storeId);

  const now = new Date();

  let period: AnalysisPeriod;
  try {
    period = resolvePeriod(request, now);
  } catch (error) {
    mapPeriodError(error);
  }

  const previous = previousPeriod(period);
  const last30 = { from: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), to: now };

  const freshness = await resolveFreshness(db, context, storeId, now);

  const data = await withTenantTransaction(
    db,
    { userId: context.userId, organizationId: context.organizationId },
    async (tx) => {
      const [
        productRows,
        inventoryRows,
        categoryRows,
        links,
        bounds,
        currentOrders,
        previousOrders,
        last30Orders,
        customerRows,
      ] = await Promise.all([
        loadProductRows(tx, storeId),
        loadInventoryRows(tx, storeId),
        loadCategoryRows(tx, storeId),
        loadProductCategoryLinks(tx, storeId),
        loadOrderBounds(tx, storeId),
        loadOrders(tx, storeId, period),
        loadOrders(tx, storeId, previous),
        loadOrders(tx, storeId, last30),
        loadCustomerRows(tx, storeId),
      ]);

      return {
        productRows,
        inventoryRows,
        categoryRows,
        links,
        bounds,
        currentOrders,
        previousOrders,
        last30Orders,
        customerRows,
      };
    },
  );

  const ordersState = freshness.resources.find((resource) => resource.resource === "orders");
  const customersState = freshness.resources.find((resource) => resource.resource === "customers");
  const productsState = freshness.resources.find((resource) => resource.resource === "products");

  const ordersSynced = Boolean(ordersState?.lastSuccessAt);
  const ordersSyncIncomplete = ordersState?.status === "failed";
  const hasBaseline = hasPreviousBaseline(period, data.bounds.firstOrderAt, ordersSyncIncomplete);

  const coverage = computeCoverage({
    period,
    totalOrders: data.bounds.total,
    firstOrderAt: data.bounds.firstOrderAt,
    lastOrderAt: data.bounds.lastOrderAt,
    ordersSyncIncomplete,
  });

  const sales = computeSalesMetrics({
    current: data.currentOrders,
    previous: data.previousOrders,
    ordersSynced,
    syncIncomplete: ordersSyncIncomplete,
    hasBaseline,
  });

  const categoryIdsByProduct = new Map<string, string[]>();
  for (const link of data.links) {
    const existing = categoryIdsByProduct.get(link.productId) ?? [];
    existing.push(link.categoryId);
    categoryIdsByProduct.set(link.productId, existing);
  }

  const productInputs: ProductMetricRow[] = data.productRows.map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    priceAmount: row.priceAmount,
    currency: row.currency,
    quantity: row.quantity,
    isAvailable: row.isAvailable,
    hasImage: row.imageUrl !== null,
    categoryNames: row.categoryNames,
    inventoryQuantity: row.inventoryQuantity,
    soldQuantity: row.soldQuantity,
    unlimitedQuantity: row.unlimitedQuantity,
  }));

  const products = productInputs
    .map(analyseProduct)
    .sort(
      (a, b) =>
        CLASS_ORDER[a.classification] - CLASS_ORDER[b.classification] ||
        (b.unitsSold.value ?? -1) - (a.unitsSold.value ?? -1) ||
        a.name.localeCompare(b.name, "ar"),
    );

  const summary = summariseProducts(products, productInputs);
  const rankings = rankProducts(products, 10);

  const inventory = computeInventoryIntelligence(data.inventoryRows);

  const currency = sales.currency.value;

  const aggregatesByCustomer = new Map<string, { orders: number; total: number | null }>();
  for (const order of data.currentOrders) {
    // A canceled order is not a purchase: it is excluded from the count and the
    // money, exactly as it is in the sales metrics above. Counting it here would
    // let the customer panel contradict the sales panel on the same page.
    if (order.draft || order.customerId === null || order.statusSlug === "canceled") continue;

    const existing = aggregatesByCustomer.get(order.customerId) ?? {
      orders: 0,
      total: 0 as number | null,
    };
    existing.orders += 1;

    const amount =
      order.totalAmount !== null && order.currency !== null ? Number(order.totalAmount) : null;

    // A single unusable amount makes this customer's revenue unknown, not zero.
    if (existing.total !== null) {
      existing.total = amount === null || !Number.isFinite(amount) ? null : existing.total + amount;
    }

    aggregatesByCustomer.set(order.customerId, existing);
  }

  const customers = computeCustomerIntelligence({
    customers: data.customerRows,
    aggregates: [...aggregatesByCustomer.entries()].map(([customerId, value]) => ({
      customerId,
      orders: value.orders,
      total: value.total,
    })),
    period,
    customersSynced: Boolean(customersState?.lastSuccessAt),
    customersSyncIncomplete: customersState?.status === "failed",
    currency,
  });

  const categories = computeCategoryIntelligence(
    data.categoryRows,
    data.productRows.map((row) => ({
      productId: row.id,
      categoryIds: categoryIdsByProduct.get(row.id) ?? [],
      soldQuantity: row.soldQuantity,
      stock: row.inventoryQuantity ?? row.quantity,
      isAvailable: row.isAvailable,
    })),
  );

  const completedOrders30d = ordersSynced
    ? data.last30Orders.filter(
        (order: OrderRow) => !order.draft && order.statusSlug === "completed",
      ).length
    : null;

  const health = computeStoreHealth({
    productTotal: summary.total,
    missingPrice: summary.missingPrice,
    missingCategory: summary.missingCategory,
    missingImage: summary.missingImage,
    inStock: summary.inStock,
    stockKnown: productInputs.filter(
      (row) => row.inventoryQuantity !== null || row.quantity !== null,
    ).length,
    completedOrders30d,
    freshness,
    now,
  });

  const opportunities = buildOpportunities({
    products,
    categories: categories.items,
    sales,
    freshness,
    coverage,
    ordersSynced,
    productsSynced: Boolean(productsState?.lastSuccessAt),
    now,
  });

  return {
    now,
    period,
    coverage,
    freshness,
    sales,
    productRows: productInputs,
    products,
    summary,
    rankings,
    inventory,
    customers,
    categories,
    health,
    opportunities,
  };
}

function envelope<T>(storeId: string, snapshot: Snapshot, data: T): IntelligenceEnvelope<T> {
  return {
    storeId,
    generatedAt: snapshot.now.toISOString(),
    period: toPeriodView(snapshot.period),
    coverage: snapshot.coverage,
    freshness: snapshot.freshness,
    data,
  };
}

/** Baseline definitions, returned with every payload so the UI can explain itself. */
const DEFINITIONS = {
  salesPopulation: "الطلبات غير المسودّة (draft = false) في الفترة.",
  completedOrder: "الطلب الذي حالته status.slug = completed.",
  orderValue: "مجموع orders.total_amount، ويُرفض إذا تعدّدت العملات أو غاب الإجمالي.",
  productUnitsSold: "مجموع sold_quantity من Salla لكل المنتج؛ قيمة تراكمية لا تُوثّق Salla مدّتها.",
  productRevenue: "غير متاح: بنود الطلب في List Orders لا تحمل معرّف منتج ولا سعرًا.",
  velocity: "غير متاح: لا توجد فترة موثّقة للمبيعات، فلا يمكن حساب وحدة/يوم.",
  newCustomer:
    "العميل الذي source_created_at داخل الفترة؛ يُعتبر جزئيًا إذا غاب تاريخ الإنشاء لبعض العملاء.",
} as const;

export interface OverviewData {
  sales: SalesMetrics;
  products: {
    total: number;
    inStock: number;
    outOfStock: number;
    lowStock: number;
    unsold: number;
    byClass: ProductSummary["byClass"];
  };
  inventory: {
    trackedProducts: number;
    outOfStock: number;
    lowStock: number;
    overstock: number;
    lastSyncedAt: string | null;
  };
  customers: CustomerIntelligence;
  health: StoreHealth;
  opportunities: {
    total: number;
    top: OpportunityList["items"];
  };
  definitions: typeof DEFINITIONS;
}

export async function getStoreIntelligenceOverview(
  db: Database,
  context: TenantContext,
  storeId: string,
  request: PeriodRequest,
): Promise<IntelligenceEnvelope<OverviewData>> {
  const snapshot = await loadSnapshot(db, context, storeId, request);

  return envelope(storeId, snapshot, {
    sales: snapshot.sales,
    products: {
      total: snapshot.summary.total,
      inStock: snapshot.summary.inStock,
      outOfStock: snapshot.summary.outOfStock,
      lowStock: snapshot.summary.lowStock,
      unsold: snapshot.summary.unsold,
      byClass: snapshot.summary.byClass,
    },
    inventory: {
      trackedProducts: snapshot.inventory.trackedProducts,
      outOfStock: snapshot.inventory.outOfStock,
      lowStock: snapshot.inventory.lowStock,
      overstock: snapshot.inventory.overstock,
      lastSyncedAt: snapshot.inventory.lastSyncedAt,
    },
    customers: snapshot.customers,
    health: snapshot.health,
    opportunities: {
      total: snapshot.opportunities.total,
      top: snapshot.opportunities.items.slice(0, 5),
    },
    definitions: DEFINITIONS,
  });
}

export interface ProductIntelligenceData {
  summary: ProductSummary;
  items: ProductIntelligence[];
  total: number;
  truncated: boolean;
  rankings: { top: ProductRanking[]; bottom: ProductRanking[] };
  definitions: typeof DEFINITIONS;
}

export async function getProductIntelligence(
  db: Database,
  context: TenantContext,
  storeId: string,
  request: PeriodRequest,
): Promise<IntelligenceEnvelope<ProductIntelligenceData>> {
  const snapshot = await loadSnapshot(db, context, storeId, request);

  return envelope(storeId, snapshot, {
    summary: snapshot.summary,
    items: snapshot.products.slice(0, MAX_PRODUCT_ITEMS),
    total: snapshot.products.length,
    truncated: snapshot.products.length > MAX_PRODUCT_ITEMS,
    rankings: snapshot.rankings,
    definitions: DEFINITIONS,
  });
}

export async function getInventoryIntelligence(
  db: Database,
  context: TenantContext,
  storeId: string,
  request: PeriodRequest,
): Promise<IntelligenceEnvelope<InventoryIntelligence>> {
  const snapshot = await loadSnapshot(db, context, storeId, request);
  return envelope(storeId, snapshot, snapshot.inventory);
}

export async function getCustomerIntelligence(
  db: Database,
  context: TenantContext,
  storeId: string,
  request: PeriodRequest,
): Promise<IntelligenceEnvelope<CustomerIntelligence>> {
  const snapshot = await loadSnapshot(db, context, storeId, request);
  return envelope(storeId, snapshot, snapshot.customers);
}

export async function getCategoryIntelligence(
  db: Database,
  context: TenantContext,
  storeId: string,
  request: PeriodRequest,
): Promise<IntelligenceEnvelope<CategoryIntelligence>> {
  const snapshot = await loadSnapshot(db, context, storeId, request);
  return envelope(storeId, snapshot, snapshot.categories);
}

export interface OpportunityData {
  items: OpportunityList["items"];
  total: number;
  truncated: boolean;
  countsByType: OpportunityList["countsByType"];
}

export async function getOpportunities(
  db: Database,
  context: TenantContext,
  storeId: string,
  request: PeriodRequest,
): Promise<IntelligenceEnvelope<OpportunityData>> {
  const snapshot = await loadSnapshot(db, context, storeId, request);

  return envelope(storeId, snapshot, {
    items: snapshot.opportunities.items,
    total: snapshot.opportunities.total,
    truncated: snapshot.opportunities.truncated,
    countsByType: snapshot.opportunities.countsByType,
  });
}

export interface DashboardData {
  overview: OverviewData;
  productSummary: ProductSummary;
  products: ProductIntelligence[];
  productTotal: number;
  rankings: { top: ProductRanking[]; bottom: ProductRanking[] };
  inventory: InventoryIntelligence;
  categories: CategoryIntelligence;
  opportunities: OpportunityList;
}

/**
 * One snapshot for the page.
 *
 * The UI needs several sections at once; loading them through four separate
 * service calls would run the same aggregate queries four times. This wrapper
 * computes one snapshot and projects it, so every section on screen describes
 * the same instant.
 */
export async function getIntelligenceDashboard(
  db: Database,
  context: TenantContext,
  storeId: string,
  request: PeriodRequest,
): Promise<IntelligenceEnvelope<DashboardData>> {
  const snapshot = await loadSnapshot(db, context, storeId, request);

  return envelope(storeId, snapshot, {
    overview: {
      sales: snapshot.sales,
      products: {
        total: snapshot.summary.total,
        inStock: snapshot.summary.inStock,
        outOfStock: snapshot.summary.outOfStock,
        lowStock: snapshot.summary.lowStock,
        unsold: snapshot.summary.unsold,
        byClass: snapshot.summary.byClass,
      },
      inventory: {
        trackedProducts: snapshot.inventory.trackedProducts,
        outOfStock: snapshot.inventory.outOfStock,
        lowStock: snapshot.inventory.lowStock,
        overstock: snapshot.inventory.overstock,
        lastSyncedAt: snapshot.inventory.lastSyncedAt,
      },
      customers: snapshot.customers,
      health: snapshot.health,
      opportunities: {
        total: snapshot.opportunities.total,
        top: snapshot.opportunities.items.slice(0, 5),
      },
      definitions: DEFINITIONS,
    },
    productSummary: snapshot.summary,
    products: snapshot.products.slice(0, 30),
    productTotal: snapshot.products.length,
    rankings: snapshot.rankings,
    inventory: snapshot.inventory,
    categories: snapshot.categories,
    opportunities: snapshot.opportunities,
  });
}

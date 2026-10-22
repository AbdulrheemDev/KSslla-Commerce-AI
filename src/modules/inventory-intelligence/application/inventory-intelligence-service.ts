import type { Database } from "@/db/client";
import { withTenantTransaction } from "@/db/tenant";
import { assertPermission } from "@/modules/identity/application/authorization";
import type { TenantContext } from "@/modules/identity/application/types";
import { resolveFreshness } from "@/modules/intelligence/application/intelligence-service";
import type { DataFreshness } from "@/modules/intelligence/domain/types";
import { requireStoreAccess } from "@/modules/stores/application/store-service";
import { resolveResourceState } from "@/modules/sync/application/sync-state";

import {
  buildCoverage,
  buildInventoryReport,
  buildCategoryInventoryHealth,
  buildRecommendations,
  analyseInventoryProduct,
  INVENTORY_THRESHOLDS,
  INVENTORY_THRESHOLD_LABELS_AR,
  type CategoryInventoryHealth,
  type InventoryReport,
} from "../domain";
import type {
  InventoryConfidence,
  InventoryCoverage,
  InventoryIssueSummary,
  InventoryOverview,
  InventoryRecommendation,
  InventorySyncState,
  ProductInventoryAnalysis,
} from "../domain/types";
import { loadInventorySnapshot } from "../infrastructure/inventory-snapshot-repository";
import type { InventoryQuery, InventoryFilter } from "./query";

/**
 * Inventory-intelligence read model.
 *
 * One snapshot per request. Four bulk statements (products, category links,
 * categories, inventory rows) inside one tenant transaction, analysed in memory
 * once, and every endpoint projects from the same result — no per-product query,
 * no cache, no materialised table (ADR-043, ADR-053).
 *
 * The chain is the Phase 07 one, unchanged:
 * `store:read` → store resolved inside the caller's organization → every
 * statement inside a tenant transaction (RLS as the second wall). A foreign
 * `storeId` is a 404 before any inventory is read.
 *
 * This service writes nothing. There is no adjust, no set-quantity, no sync
 * trigger and no provider call, and the routes are GET only.
 */

export interface InventoryEnvelope<T> {
  readonly storeId: string;
  readonly generatedAt: string;
  readonly freshness: DataFreshness;
  readonly coverage: InventoryCoverage;
  readonly confidence: InventoryConfidence;
  readonly data: T;
}

export interface UnavailableMetric {
  readonly metric: string;
  readonly reason: string;
  readonly explanation: string;
}

export interface ProductsPayload {
  readonly items: readonly ProductInventoryAnalysis[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly pageCount: number;
  readonly query: string;
  readonly filter: InventoryFilter;
}

export interface OverviewPayload {
  readonly overview: InventoryOverview;
  readonly counts: InventoryReport["counts"];
  readonly issues: readonly InventoryIssueSummary[];
  readonly topRecommendations: readonly InventoryRecommendation[];
  readonly definitions: typeof INVENTORY_DEFINITIONS;
  readonly thresholds: typeof INVENTORY_THRESHOLDS;
  readonly thresholdLabels: typeof INVENTORY_THRESHOLD_LABELS_AR;
  readonly unavailableByDesign: readonly UnavailableMetric[];
}

export interface CategoriesPayload {
  readonly items: readonly CategoryInventoryHealth[];
}

export interface IssuesPayload {
  readonly items: readonly InventoryIssueSummary[];
  readonly total: number;
}

export interface RecommendationsPayload {
  readonly items: readonly InventoryRecommendation[];
  readonly total: number;
  readonly advisoryOnly: true;
}

export interface DashboardPayload extends OverviewPayload {
  readonly categories: readonly CategoryInventoryHealth[];
  readonly products: ProductsPayload;
}

interface Snapshot {
  readonly storeId: string;
  readonly now: Date;
  readonly freshness: DataFreshness;
  readonly analyses: readonly ProductInventoryAnalysis[];
  readonly report: InventoryReport;
  readonly categories: readonly CategoryInventoryHealth[];
  readonly recommendations: readonly InventoryRecommendation[];
}

/**
 * Definitions shipped with every payload, in Arabic, so the screen can explain
 * itself without a second request and without a number whose rule is unknown.
 */
export const INVENTORY_DEFINITIONS = {
  status:
    "حالة المخزون تُقرأ من الكمية الحالية المحفوظة: صفر أو أقل يعني نافد، والكمية غير المحدودة تتقدّم على الرقم، والقيمة بين 1 و5 منخفضة، وما فوقها متوفر. هذه حدود مطلقة لا تعتمد على سرعة البيع.",
  coverage:
    "التغطية = عدد المنتجات التي لها سجل مخزون مقسومًا على عدد المنتجات في الكتالوج. أقل من 100% يعني أن جزءًا من الكتالوج لم تُسحب كميته بعد، ولذلك لا تُقرأ الأرقام كأنها كاملة.",
  healthScore:
    "درجة الصحة = التغطية (25) + توفر المنتجات (35) + بُعد نسبة المنخفض (20) + بُعد نسبة النافد (20). الدرجة وصفية لحالة الرف الآن، وليست توقع مبيعات، وتُخفَّض إلى جزئية عند نقص التغطية أو وجود كميات سالبة.",
  daysOfStock:
    "الأيام المتبقية = الكمية المتاحة ÷ معدل الطلب اليومي. معدل الطلب اليومي لكل منتج غير متاح: بنود الطلب لا تحمل معرّف منتج، والكمية المبيعة التراكمية من المزوّد بلا فترة. لذلك تظهر الأيام المتبقية «—» مع السبب ولا تُقدَّر.",
  stockout:
    "التنبؤ بنفاد المخزون يحتاج معدل طلب موثّقًا لكل منتج؛ غير متاح حاليًا، فلا يصدر تنبؤ ولا نطاق خطر. ما يظهر هو حالة الكمية الآن فقط.",
  excess:
    "الفائض والراكد يحتاجان معدل طلب ومدة مراقبة. الكمية المرتفعة تُعرض كملاحظة كمية محايدة، ولا تعني راكدًا ولا فائضًا.",
  reorder:
    "كمية إعادة الطلب = الطلب اليومي × (مهلة التوريد + مخزون الأمان) − المتاح. الطلب اليومي ومهلة التوريد ومخزون الأمان غير متاحة أو غير مضبوطة، فلا تُحسب كمية إعادة طلب.",
  soldQuantity:
    "الكمية المبيعة التراكمية تُعرض كما أعادها المزوّد فقط. لا تُحوَّل إلى معدل يومي، ولا تُنسب إلى فترة، ولا تُستخدم في أي حساب تالٍ.",
  ranking:
    "ترتيب المشكلات حتمي: الدرجة = عدد المتأثرين × وزن الخطورة (عالية 3، متوسطة 2، منخفضة 1)، ثم الخطورة، ثم العدد، ثم المعرّف. نفس اللقطة تعطي نفس الترتيب دائمًا.",
  categories:
    "صحة التصنيف تُجمع من منتجاتها: أعداد المتوفر والنافد والمنخفض وغير المحدود والتغطية. ليست مبيعات تصنيف ولا معدل دوران، لأن المصدر لا يوفرهما.",
  recommendations:
    "التوصيات مشتقة من المشكلات المرصودة فقط، وتذكر القاعدة والأمثلة. استشارية: لا يُنفَّذ أي إجراء مخزون من هذه الشاشة.",
  negative:
    "الكمية السالبة تُعرض كما وصلت وتُعدّ مشكلة عالية تحتاج مراجعة يدوية؛ لا تُقصّ إلى صفر لأن ذلك يخفي عيبًا في البيانات.",
} as const;

/**
 * The four quantities this data source cannot produce, stated up front on the
 * overview rather than buried in an empty cell.
 */
export const UNAVAILABLE_BY_DESIGN: readonly UnavailableMetric[] = [
  {
    metric: "inventory.daysOfStock",
    reason: "product_demand_not_linked",
    explanation:
      "لا يوجد معدل طلب موثّق لكل منتج: بنود الطلب بلا معرّف منتج (المرحلة 05)، والكمية المبيعة تراكمية بلا فترة.",
  },
  {
    metric: "inventory.stockoutPrediction",
    reason: "product_demand_not_linked",
    explanation: "التنبؤ بالنفاد يحتاج الأيام المتبقية، وهي غير متاحة لنفس السبب.",
  },
  {
    metric: "inventory.deadStock",
    reason: "product_demand_not_linked",
    explanation:
      "تمييز الراكد يحتاج معدل طلب ومدة مراقبة؛ الاثنان غير متاحين، والكمية المرتفعة ليست دليلًا.",
  },
  {
    metric: "inventory.reorderQuantity",
    reason: "reorder_inputs_missing",
    explanation:
      "كمية إعادة الطلب تحتاج الطلب اليومي ومهلة التوريد ومخزون الأمان، وثلاثتها غير متاحة أو غير مضبوطة.",
  },
];

const SEVERITY_ORDER = { high: 3, medium: 2, low: 1 } as const;

const STATUS_ORDER: Record<string, number> = {
  out_of_stock: 4,
  low_stock: 3,
  unknown: 2,
  in_stock: 1,
  unlimited: 0,
};

function severityRank(product: ProductInventoryAnalysis): number {
  return product.severity === null ? 0 : SEVERITY_ORDER[product.severity];
}

async function loadSnapshot(
  db: Database,
  context: TenantContext,
  storeId: string,
): Promise<Snapshot> {
  assertPermission(context, "store:read");
  await requireStoreAccess(db, context, storeId);

  const now = new Date();

  const [freshness, inventoryState] = await Promise.all([
    resolveFreshness(db, context, storeId, now),
    resolveResourceState(db, context, storeId, "inventory"),
  ]);

  const rows = await withTenantTransaction(
    db,
    { userId: context.userId, organizationId: context.organizationId },
    (tx) => loadInventorySnapshot(tx, storeId),
  );

  const analyses = rows.products.map((product) => analyseInventoryProduct(product));

  const sync: InventorySyncState = {
    inventorySynced: inventoryState.lastSuccessAt !== null,
    inventorySyncFailed: inventoryState.status === "failed",
    lastInventorySyncAt: inventoryState.lastSuccessAt,
    staleResources: freshness.staleResources,
  };

  const coverage = buildCoverage({
    productsTotal: rows.products.length,
    productsTracked: analyses.filter((analysis) => analysis.status !== "unknown").length,
    inventoryEntries: rows.inventoryEntries,
    unlinkedEntries: rows.unlinked.length,
    lastSyncedAt: rows.lastSyncedAt,
    sync,
  });

  const report = buildInventoryReport({
    products: rows.products,
    analyses,
    unlinkedEntries: rows.unlinked,
    coverage,
    sync,
  });

  const categories = buildCategoryInventoryHealth(analyses, rows.categories);
  const recommendations = buildRecommendations(report.issues, rows.products.length);

  return {
    storeId,
    now,
    freshness,
    analyses,
    report,
    categories,
    recommendations,
  };
}

function envelope<T>(snapshot: Snapshot, data: T): InventoryEnvelope<T> {
  return {
    storeId: snapshot.storeId,
    generatedAt: snapshot.now.toISOString(),
    freshness: snapshot.freshness,
    coverage: snapshot.report.coverage,
    confidence: snapshot.report.confidence,
    data,
  };
}

function matchesQuery(product: ProductInventoryAnalysis, query: string): boolean {
  if (query.length === 0) return true;
  const needle = query.toLocaleLowerCase("ar");
  return (
    product.name.toLocaleLowerCase("ar").includes(needle) ||
    (product.sku ?? "").toLocaleLowerCase("ar").includes(needle)
  );
}

function matchesFilter(product: ProductInventoryAnalysis, filter: InventoryFilter): boolean {
  if (filter === "all") return true;
  if (filter === "high_quantity") return product.highStockQuantity;
  return product.status === filter;
}

function sortProducts(products: readonly ProductInventoryAnalysis[]): ProductInventoryAnalysis[] {
  return [...products].sort((a, b) => {
    const severityDelta = severityRank(b) - severityRank(a);
    if (severityDelta !== 0) return severityDelta;

    const statusDelta = (STATUS_ORDER[b.status] ?? 0) - (STATUS_ORDER[a.status] ?? 0);
    if (statusDelta !== 0) return statusDelta;

    const quantityA = a.stock.value ?? Number.POSITIVE_INFINITY;
    const quantityB = b.stock.value ?? Number.POSITIVE_INFINITY;
    if (quantityA !== quantityB) return quantityA - quantityB;

    return a.name.localeCompare(b.name, "ar") || a.id.localeCompare(b.id);
  });
}

export function pageProducts(
  products: readonly ProductInventoryAnalysis[],
  query: InventoryQuery,
): ProductsPayload {
  const filtered = sortProducts(
    products.filter(
      (product) => matchesQuery(product, query.query) && matchesFilter(product, query.filter),
    ),
  );

  const total = filtered.length;
  const pageCount = total === 0 ? 0 : Math.ceil(total / query.pageSize);
  const page = pageCount === 0 ? 0 : Math.min(query.page, pageCount);
  const start = (page - 1) * query.pageSize;

  return {
    items: page === 0 ? [] : filtered.slice(start, start + query.pageSize),
    page,
    pageSize: query.pageSize,
    total,
    pageCount,
    query: query.query,
    filter: query.filter,
  };
}

/**
 * Products in the order the table shows them by default: highest severity first,
 * then out of stock, low stock, unknown, in stock, unlimited, then lowest
 * quantity, then name.
 */
export function rankedProducts(
  products: readonly ProductInventoryAnalysis[],
): readonly ProductInventoryAnalysis[] {
  return sortProducts(products);
}

function overviewPayload(snapshot: Snapshot): OverviewPayload {
  return {
    overview: snapshot.report.overview,
    counts: snapshot.report.counts,
    issues: snapshot.report.issues,
    topRecommendations: snapshot.recommendations.slice(0, 5),
    definitions: INVENTORY_DEFINITIONS,
    thresholds: INVENTORY_THRESHOLDS,
    thresholdLabels: INVENTORY_THRESHOLD_LABELS_AR,
    unavailableByDesign: UNAVAILABLE_BY_DESIGN,
  };
}

export async function getInventoryOverview(
  db: Database,
  context: TenantContext,
  storeId: string,
): Promise<InventoryEnvelope<OverviewPayload>> {
  const snapshot = await loadSnapshot(db, context, storeId);
  return envelope(snapshot, overviewPayload(snapshot));
}

export async function getInventoryProducts(
  db: Database,
  context: TenantContext,
  storeId: string,
  query: InventoryQuery,
): Promise<InventoryEnvelope<ProductsPayload>> {
  const snapshot = await loadSnapshot(db, context, storeId);
  return envelope(snapshot, pageProducts(snapshot.analyses, query));
}

export async function getInventoryCategories(
  db: Database,
  context: TenantContext,
  storeId: string,
): Promise<InventoryEnvelope<CategoriesPayload>> {
  const snapshot = await loadSnapshot(db, context, storeId);
  return envelope(snapshot, { items: snapshot.categories });
}

export async function getInventoryIssues(
  db: Database,
  context: TenantContext,
  storeId: string,
): Promise<InventoryEnvelope<IssuesPayload>> {
  const snapshot = await loadSnapshot(db, context, storeId);
  return envelope(snapshot, {
    items: snapshot.report.issues,
    total: snapshot.report.issues.length,
  });
}

export async function getInventoryRecommendations(
  db: Database,
  context: TenantContext,
  storeId: string,
): Promise<InventoryEnvelope<RecommendationsPayload>> {
  const snapshot = await loadSnapshot(db, context, storeId);
  return envelope(snapshot, {
    items: snapshot.recommendations,
    total: snapshot.recommendations.length,
    advisoryOnly: true,
  });
}

export async function getInventoryDashboard(
  db: Database,
  context: TenantContext,
  storeId: string,
  query: InventoryQuery,
): Promise<InventoryEnvelope<DashboardPayload>> {
  const snapshot = await loadSnapshot(db, context, storeId);

  return envelope(snapshot, {
    ...overviewPayload(snapshot),
    categories: snapshot.categories,
    products: pageProducts(snapshot.analyses, query),
  });
}

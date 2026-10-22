import type { Database } from "@/db/client";
import { withTenantTransaction } from "@/db/tenant";
import { assertPermission } from "@/modules/identity/application/authorization";
import type { TenantContext } from "@/modules/identity/application/types";
import { resolveFreshness } from "@/modules/intelligence/application/intelligence-service";
import type { DataFreshness } from "@/modules/intelligence/domain/types";
import { requireStoreAccess } from "@/modules/stores/application/store-service";
import { resolveResourceState } from "@/modules/sync/application/sync-state";

import {
  buildCatalogReport,
  type CatalogConfidence,
  type CatalogCoverage,
  type CatalogOverview,
  type CatalogReport,
  type CatalogSyncState,
} from "../domain/catalog";
import { buildCategoryHealth, type CategoryHealth } from "../domain/categories";
import type { IssueSummary } from "../domain/types";
import { analyseProduct } from "../domain/products";
import { buildRecommendations } from "../domain/recommendations";
import type { ProductAnalysis, Recommendation } from "../domain/types";
import {
  loadCatalog,
  type CatalogSnapshotRows,
} from "../infrastructure/product-catalog-repository";
import type { CatalogQuery, ProductFilter } from "./query";

/**
 * Product-intelligence read model.
 *
 * One snapshot per request: the catalogue is loaded in four bulk statements,
 * analysed once in memory, and every endpoint projects from the same result. The
 * catalogue is small enough (a store's products, not its orders) that this stays
 * a handful of indexed reads with no per-product query and no cache to
 * invalidate (ADR-053 still holds: no materialised metrics).
 *
 * Tenant safety is the Phase 07 chain, unchanged:
 * `store:read` → store resolved inside the caller's organization → every
 * statement inside a tenant transaction (RLS as the second wall). A foreign
 * `storeId` is a 404 before any product is read.
 *
 * There is no period parameter. The catalogue answers "what is stored now", and
 * the freshness record says how old that is.
 */

export interface CatalogEnvelope<T> {
  readonly storeId: string;
  readonly generatedAt: string;
  readonly freshness: DataFreshness;
  readonly coverage: CatalogCoverage;
  readonly confidence: CatalogConfidence;
  readonly data: T;
}

export interface ProductsPayload {
  readonly items: readonly ProductAnalysis[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly pageCount: number;
  readonly query: string;
  readonly filter: ProductFilter;
}

export interface OverviewPayload {
  readonly overview: CatalogOverview;
  readonly counts: CatalogReport["counts"];
  readonly topIssues: readonly IssueSummary[];
  readonly topRecommendations: readonly Recommendation[];
  readonly definitions: typeof PRODUCT_DEFINITIONS;
  readonly unavailableByDesign: readonly UnavailableMetric[];
}

export interface CategoriesPayload {
  readonly items: readonly CategoryHealth[];
}

export interface IssuesPayload {
  readonly items: readonly IssueSummary[];
  readonly total: number;
}

export interface RecommendationsPayload {
  readonly items: readonly Recommendation[];
  readonly total: number;
}

export interface DashboardPayload extends OverviewPayload {
  readonly issues: readonly IssueSummary[];
  readonly recommendations: readonly Recommendation[];
  readonly categories: readonly CategoryHealth[];
  readonly products: ProductsPayload;
}

export interface UnavailableMetric {
  readonly metric: string;
  readonly reason: string;
  readonly explanation: string;
}

interface Snapshot {
  readonly storeId: string;
  readonly now: Date;
  readonly freshness: DataFreshness;
  readonly rows: CatalogSnapshotRows;
  readonly analyses: readonly ProductAnalysis[];
  readonly report: CatalogReport;
  readonly categories: readonly CategoryHealth[];
  readonly recommendations: readonly Recommendation[];
}

/**
 * Definitions returned with every payload. Each one names the exact population,
 * the fields read, and what is deliberately not claimed.
 */
export const PRODUCT_DEFINITIONS = {
  contentQuality:
    "مجموع أوزان الفحوص الناجحة من 100: الاسم، وجود الوصف، طول الوصف، رابط المنتج، ورمز SKU. ليس مؤشر SEO ولا يقيس ترتيب البحث.",
  metadataHealth:
    "نسبة المنتجات التي تحمل metadata.title وmetadata.description معًا، من إجمالي المنتجات التي حُفظت لها بيانات وصفية.",
  imageHealth:
    "يُفحص وجود الصورة الرئيسية المحفوظة وصحة شكل رابطها فقط. عدد الصور ونص alt غير محفوظين في النسخة المحلية.",
  lifecycle:
    "مبني على updated_at الموثّق من المزوّد فقط؛ لا يوجد تاريخ إنشاء موثّق، لذلك عمر المنتج غير متاح ولا يُشتق من تاريخ التحديث.",
  categories:
    "صحة كتالوج التصنيفات: عدد المنتجات ومشكلات المحتوى والصور والبيانات الوصفية داخلها. ليست أداء مبيعات: لا يوجد ربط موثوق بين بنود الطلب والمنتجات.",
  ranking:
    "ترتيب حتمي: درجة المشكلة = عدد المنتجات المتأثرة × وزن الخطورة (عالية 3، متوسطة 2، منخفضة 1)، ثم الخطورة، ثم العدد، ثم المعرّف.",
  products:
    "كل صف منتج محسوب من الحقول المحفوظة فعليًا؛ ما لا يوجد في النسخة المحلية يظهر غير متاح مع سببه، ولا يظهر صفرًا.",
  performance:
    "غير متاح: بنود الطلب في Salla لا تحمل معرّف منتج ولا سعرًا، فلا يمكن نسبة إيراد أو وحدات مبيعة إلى منتج. الكمية المبيعة التراكمية من المزوّد تُعرض كما هي ولا تُحوَّل إلى مبيعات فترة.",
} as const;

/** The five metrics this data source cannot produce, stated up front. */
export const UNAVAILABLE_BY_DESIGN: readonly UnavailableMetric[] = [
  {
    metric: "product.sales",
    reason: "product_sales_not_linked",
    explanation: "بنود الطلب لا تحمل معرّف منتج، فلا تُنسب مبيعات فترة إلى منتج.",
  },
  {
    metric: "product.revenue",
    reason: "product_sales_not_linked",
    explanation: "لا يوجد سعر سطر مرتبط بالمنتج، فلا يُحسب إيراد لكل منتج.",
  },
  {
    metric: "product.imageCount",
    reason: "images_not_mirrored",
    explanation: "النسخة المحلية تحفظ رابط صورة واحدًا، لا قائمة الصور.",
  },
  {
    metric: "product.imageAltText",
    reason: "image_alt_not_mirrored",
    explanation: "نص alt ليس ضمن الحقول المحفوظة في النسخة المحلية.",
  },
  {
    metric: "product.ageDays",
    reason: "created_at_not_documented",
    explanation: "Salla لا توثّق تاريخ إنشاء المنتج، وتاريخ التحديث ليس عمرًا.",
  },
];

const SEVERITY_ORDER = { high: 3, medium: 2, low: 1 } as const;

function severityRank(product: ProductAnalysis): number {
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

  const [freshness, productsState, categoriesState] = await Promise.all([
    resolveFreshness(db, context, storeId, now),
    resolveResourceState(db, context, storeId, "products"),
    resolveResourceState(db, context, storeId, "categories"),
  ]);

  const rows = await withTenantTransaction(
    db,
    { userId: context.userId, organizationId: context.organizationId },
    (tx) => loadCatalog(tx, storeId),
  );

  const analyses = rows.products.map((product) => analyseProduct(product, now));

  const sync: CatalogSyncState = {
    productsSynced: productsState.lastSuccessAt !== null,
    productsSyncFailed: productsState.status === "failed",
    categoriesSynced: categoriesState.lastSuccessAt !== null,
    categoriesSyncFailed: categoriesState.status === "failed",
    productsSkipped: productsState.lastRun?.itemsSkipped ?? 0,
    categoriesSkipped: categoriesState.lastRun?.itemsSkipped ?? 0,
    lastProductsSyncAt: productsState.lastSuccessAt,
    lastCategoriesSyncAt: categoriesState.lastSuccessAt,
    staleResources: freshness.staleResources,
  };

  const report = buildCatalogReport(rows.products, analyses, rows.categories, sync);
  const categories = buildCategoryHealth(rows.products, analyses, rows.categories);
  const recommendations = buildRecommendations(report.issues, rows.products.length);

  return { storeId, now, freshness, rows, analyses, report, categories, recommendations };
}

function envelope<T>(snapshot: Snapshot, data: T): CatalogEnvelope<T> {
  return {
    storeId: snapshot.storeId,
    generatedAt: snapshot.now.toISOString(),
    freshness: snapshot.freshness,
    coverage: snapshot.report.coverage,
    confidence: snapshot.report.confidence,
    data,
  };
}

function matchesQuery(product: ProductAnalysis, query: string): boolean {
  if (query.length === 0) return true;
  const needle = query.toLocaleLowerCase("ar");
  return (
    product.name.toLocaleLowerCase("ar").includes(needle) ||
    (product.sku ?? "").toLocaleLowerCase("ar").includes(needle)
  );
}

function sortProducts(products: readonly ProductAnalysis[]): ProductAnalysis[] {
  return [...products].sort((a, b) => {
    const severityDelta = severityRank(b) - severityRank(a);
    if (severityDelta !== 0) return severityDelta;

    const scoreDelta = (a.content.score.value ?? 0) - (b.content.score.value ?? 0);
    if (scoreDelta !== 0) return scoreDelta;

    return a.name.localeCompare(b.name, "ar") || a.id.localeCompare(b.id);
  });
}

export function pageProducts(
  products: readonly ProductAnalysis[],
  query: CatalogQuery,
): ProductsPayload {
  const filtered = sortProducts(
    products.filter((product) => {
      if (!matchesQuery(product, query.query)) return false;
      if (query.filter === "attention") return product.needsAttention;
      if (query.filter === "clean") return !product.needsAttention;
      return true;
    }),
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

function overviewPayload(snapshot: Snapshot): OverviewPayload {
  return {
    overview: snapshot.report.overview,
    counts: snapshot.report.counts,
    topIssues: snapshot.report.issues.slice(0, 5),
    topRecommendations: snapshot.recommendations.slice(0, 5),
    definitions: PRODUCT_DEFINITIONS,
    unavailableByDesign: UNAVAILABLE_BY_DESIGN,
  };
}

export async function getProductOverview(
  db: Database,
  context: TenantContext,
  storeId: string,
): Promise<CatalogEnvelope<OverviewPayload>> {
  const snapshot = await loadSnapshot(db, context, storeId);
  return envelope(snapshot, overviewPayload(snapshot));
}

export async function getProductCatalog(
  db: Database,
  context: TenantContext,
  storeId: string,
  query: CatalogQuery,
): Promise<CatalogEnvelope<ProductsPayload>> {
  const snapshot = await loadSnapshot(db, context, storeId);
  return envelope(snapshot, pageProducts(snapshot.analyses, query));
}

export async function getCategoryIntelligence(
  db: Database,
  context: TenantContext,
  storeId: string,
): Promise<CatalogEnvelope<CategoriesPayload>> {
  const snapshot = await loadSnapshot(db, context, storeId);
  return envelope(snapshot, { items: snapshot.categories });
}

export async function getIssueRanking(
  db: Database,
  context: TenantContext,
  storeId: string,
): Promise<CatalogEnvelope<IssuesPayload>> {
  const snapshot = await loadSnapshot(db, context, storeId);
  return envelope(snapshot, {
    items: snapshot.report.issues,
    total: snapshot.report.issues.length,
  });
}

export async function getRecommendations(
  db: Database,
  context: TenantContext,
  storeId: string,
): Promise<CatalogEnvelope<RecommendationsPayload>> {
  const snapshot = await loadSnapshot(db, context, storeId);
  return envelope(snapshot, {
    items: snapshot.recommendations,
    total: snapshot.recommendations.length,
  });
}

export async function getProductDashboard(
  db: Database,
  context: TenantContext,
  storeId: string,
  query: CatalogQuery,
): Promise<CatalogEnvelope<DashboardPayload>> {
  const snapshot = await loadSnapshot(db, context, storeId);

  return envelope(snapshot, {
    ...overviewPayload(snapshot),
    issues: snapshot.report.issues,
    recommendations: snapshot.recommendations,
    categories: snapshot.categories,
    products: pageProducts(snapshot.analyses, query),
  });
}

import { withTenantTransaction } from "@/db/tenant";
import type { TenantContext } from "@/modules/identity/application/types";
import { assertPermission } from "@/modules/identity/application/authorization";
import {
  mapPeriodError,
  resolveFreshness,
} from "@/modules/intelligence/application/intelligence-service";
import {
  computeCoverage,
  hasPreviousBaseline,
  previousPeriod,
  resolvePeriod,
  toPeriodView,
  type PeriodRequest,
} from "@/modules/intelligence/domain/period";
import type {
  AnalysisPeriod,
  Coverage,
  DataFreshness,
  IntelligenceEnvelope,
  Metric,
} from "@/modules/intelligence/domain/types";
import type { Database } from "@/db/client";
import { requireStoreAccess } from "@/modules/stores/application/store-service";

import { buildSalesAlerts, type SalesAlert } from "../domain/alerts";
import { detectAnomalies, type AnomalyReport } from "../domain/anomalies";
import { computeDiscountAnalysis, type DiscountAnalysis } from "../domain/discounts";
import {
  buildAnomaliesCsv,
  buildSummaryCsv,
  buildTrendsCsv,
  exportFileName,
  type ExportDataset,
} from "../domain/export";
import { detectLeakage, type LeakageReport } from "../domain/leakage";
import { computeSalesOverview, type SalesOverviewMetrics } from "../domain/metrics";
import { analyseSeasonality, type SeasonalityAnalysis } from "../domain/seasonality";
import { computeSalesTrends, type SalesTrends, type TrendGranularity } from "../domain/trends";
import { loadSalesWindow } from "../infrastructure/sales-intelligence-repository";

/**
 * Sales-intelligence read model.
 *
 * Like Phase 07, every number is computed on read from the mirrored orders; no
 * snapshot table, no cache, and nothing to invalidate. One snapshot loads the
 * current and previous windows plus the order bounds, and every section of the
 * dashboard is projected from that same instant — so the tiles, the trend chart,
 * the anomalies, and the CSV cannot disagree.
 *
 * Tenant safety mirrors Phase 07 exactly: `store:read` is asserted, then the
 * store is resolved inside the caller's organization, then all queries run in a
 * tenant transaction (RLS as the second wall). A foreign `storeId` is a 404.
 */

export interface SalesDataConfidence {
  level: "high" | "medium" | "low";
  ordersSynced: boolean;
  syncIncomplete: boolean;
  coverageStatus: Coverage["status"];
  staleResources: string[];
  baselineAvailable: boolean;
  mixedCurrency: boolean;
  historyStartsAfterWindow: boolean;
}

export interface SalesOverviewPayload {
  metrics: SalesOverviewMetrics;
  confidence: SalesDataConfidence;
  seasonality: SeasonalityAnalysis;
  discounts: Pick<DiscountAnalysis, "available" | "reason" | "source">;
  anomalies: { total: number; byType: Record<string, number> };
  alerts: SalesAlert[];
  definitions: typeof SALES_DEFINITIONS;
}

export interface SalesTrendsPayload {
  granularity: TrendGranularity;
  buckets: SalesTrends["buckets"];
  previous: SalesTrends["previous"];
  currency: Metric<string>;
  totals: {
    orders: Metric<number>;
    revenue: Metric<number>;
    averageOrderValue: Metric<number>;
  };
  confidence: SalesDataConfidence;
}

export interface SalesAnomaliesPayload {
  baseline: AnomalyReport["baseline"];
  anomalies: AnomalyReport["anomalies"];
  suppressed: AnomalyReport["suppressed"];
  alerts: SalesAlert[];
}

export interface SalesDiscountsPayload extends DiscountAnalysis {
  confidence: SalesDataConfidence;
}

export interface SalesDashboardData {
  metrics: SalesOverviewMetrics;
  confidence: SalesDataConfidence;
  trends: SalesTrends;
  seasonality: SeasonalityAnalysis;
  anomalies: AnomalyReport;
  leakage: LeakageReport;
  discounts: DiscountAnalysis;
  alerts: SalesAlert[];
}

export interface SalesExport {
  filename: string;
  csv: string;
}

interface Snapshot {
  now: Date;
  period: AnalysisPeriod;
  previous: AnalysisPeriod;
  coverage: Coverage;
  freshness: DataFreshness;
  metrics: SalesOverviewMetrics;
  dayTrends: SalesTrends;
  trends: SalesTrends;
  seasonality: SeasonalityAnalysis;
  anomalies: AnomalyReport;
  leakage: LeakageReport;
  discounts: DiscountAnalysis;
  alerts: SalesAlert[];
  confidence: SalesDataConfidence;
}

function confidenceOf(snapshot: {
  coverage: Coverage;
  freshness: DataFreshness;
  ordersSynced: boolean;
  syncIncomplete: boolean;
  hasBaseline: boolean;
  mixedCurrency: boolean;
  firstOrderAt: Date | null;
  period: AnalysisPeriod;
}): SalesDataConfidence {
  const historyStartsAfterWindow =
    snapshot.firstOrderAt !== null &&
    snapshot.firstOrderAt.getTime() > snapshot.period.from.getTime();

  const staleResources = [...snapshot.freshness.staleResources];

  let level: SalesDataConfidence["level"] = "high";
  if (!snapshot.ordersSynced || snapshot.syncIncomplete || snapshot.coverage.status === "empty") {
    level = "low";
  } else if (
    snapshot.coverage.status === "partial" ||
    !snapshot.hasBaseline ||
    snapshot.mixedCurrency ||
    staleResources.length > 0
  ) {
    level = "medium";
  }

  return {
    level,
    ordersSynced: snapshot.ordersSynced,
    syncIncomplete: snapshot.syncIncomplete,
    coverageStatus: snapshot.coverage.status,
    staleResources,
    baselineAvailable: snapshot.hasBaseline,
    mixedCurrency: snapshot.mixedCurrency,
    historyStartsAfterWindow,
  };
}

async function loadSnapshot(
  db: Database,
  context: TenantContext,
  storeId: string,
  request: PeriodRequest,
  granularity: TrendGranularity,
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
  const freshness = await resolveFreshness(db, context, storeId, now);
  const ordersState = freshness.resources.find((resource) => resource.resource === "orders");
  const ordersSynced = Boolean(ordersState?.lastSuccessAt);
  const syncIncomplete = ordersState?.status === "failed";

  const data = await withTenantTransaction(
    db,
    { userId: context.userId, organizationId: context.organizationId },
    (tx) =>
      loadSalesWindow(tx, storeId, {
        current: period,
        previous,
      }),
  );

  const coverage = computeCoverage({
    period,
    totalOrders: data.bounds.total,
    firstOrderAt: data.bounds.firstOrderAt,
    lastOrderAt: data.bounds.lastOrderAt,
    ordersSyncIncomplete: syncIncomplete,
  });

  const hasBaseline = hasPreviousBaseline(period, data.bounds.firstOrderAt, syncIncomplete);

  const metrics = computeSalesOverview({
    current: data.current,
    previous: data.previous,
    ordersSynced,
    syncIncomplete,
    hasBaseline,
  });

  const trendInput = {
    period,
    rows: data.current,
    ordersSynced,
    syncIncomplete,
    firstOrderAt: data.bounds.firstOrderAt,
    currency: metrics.currency,
    previous: hasBaseline ? { period: previous, rows: data.previous } : undefined,
  };

  const dayTrends = computeSalesTrends({ ...trendInput, granularity: "day" });
  const trends =
    granularity === "day" ? dayTrends : computeSalesTrends({ ...trendInput, granularity });

  const seasonality = analyseSeasonality({
    period,
    daily: dayTrends.buckets,
    ordersSynced,
    syncIncomplete,
    firstOrderAt: data.bounds.firstOrderAt,
    currency: metrics.currency,
  });

  const anomalies = detectAnomalies({
    metrics,
    hasBaseline,
    ordersSynced,
    syncIncomplete,
    coverage,
    period,
    previous,
  });

  const leakage = detectLeakage(
    { metrics, hasBaseline, ordersSynced, syncIncomplete },
    period.from.toISOString().slice(0, 10),
  );

  const discounts = computeDiscountAnalysis(metrics.currency);

  const alerts = buildSalesAlerts({
    anomalies,
    leakage,
    coverage,
    freshness,
    syncIncomplete,
  });

  const confidence = confidenceOf({
    coverage,
    freshness,
    ordersSynced,
    syncIncomplete,
    hasBaseline,
    mixedCurrency: metrics.currency.reason === "mixed_currency",
    firstOrderAt: data.bounds.firstOrderAt,
    period,
  });

  return {
    now,
    period,
    previous,
    coverage,
    freshness,
    metrics,
    dayTrends,
    trends,
    seasonality,
    anomalies,
    leakage,
    discounts,
    alerts,
    confidence,
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

/**
 * Definitions returned with every payload, so the UI explains itself with the
 * same words the docs use. Each one names the exact population and formula.
 */
export const SALES_DEFINITIONS = {
  recognizedRevenue:
    "مجموع orders.total_amount للطلبات غير المسودّة وغير الملغاة، بعملة واحدة، ولا يُجمع إذا تعدّدت العملات أو غاب أي إجمالي. ليس صافيًا من الرسوم ولا المرتجعات.",
  averageOrderValue:
    "الإيراد المعتمد ÷ عدد الطلبات المقيمة غير الملغاة (الطلبات التي لها إجمالي بعملة واحدة).",
  cancellationRate: "الطلبات الملغاة ÷ الطلبات غير المسودّة × 100. نسبة عددية، لا مبلغ.",
  draftOrders: "الطلبات التي تحمل draft = true. تُعدّ ولا تدخل في أي مبلغ.",
  growth:
    "نسبة التغيّر بين النافذة المطلوبة والنافذة السابقة المساوية لها في الطول. بلا فترة سابقة داخل السجل ⇒ غير متاح، لا صفر.",
  baseline:
    "الفترة السابقة هي النافذة التي تسبق بداية الفترة المطلوبة بمدة مساوية لها. تُشترط تغطيتها بالكامل وبعدد طلبات كافٍ.",
  trends:
    "تجميع الطلبات في نقاط يومية/أسبوعية/شهرية بحدود UTC. النقطة التي تسبق بداية السجل لا تُعرض كصفر بل كغير متاحة.",
  seasonality:
    "مقارنة أيام الأسبوع المتماثلة داخل نافذة لا تقل عن ثمانية أسابيع، مع حد أدنى للتكرار والتباين قبل اعتبار النمط موسميًا.",
  anomalies:
    "قواعد حتمية تقارن الفترة الحالية بالسابقة (هبوط الإيراد/الطلبات، تغيّر المتوسط، ارتفاع الإلغاء، هبوط الاكتمال) مع عتبات معلنة؛ لا نموذج ولا تعلّم آلي.",
  leakage:
    "إشارات ضعف مبنية على أرقام الطلبات فقط (الإلغاء، هبوط المتوسط مع ثبات الحجم…). الزيارات والتحويل والسلال المهجورة غير متاحة في هذه البيانات.",
  discounts:
    "غير متاح: نقطة الطلبات لا تُرجع حقول خصم، وتفاصيل الخصم في Order Details غير محفوظة ولا تُستنتج من فرق السعر.",
} as const;

function overviewData(snapshot: Snapshot): SalesOverviewPayload {
  const byType: Record<string, number> = {};
  for (const anomaly of snapshot.anomalies.anomalies) {
    byType[anomaly.type] = (byType[anomaly.type] ?? 0) + 1;
  }

  return {
    metrics: snapshot.metrics,
    confidence: snapshot.confidence,
    seasonality: snapshot.seasonality,
    discounts: {
      available: snapshot.discounts.available,
      reason: snapshot.discounts.reason,
      source: snapshot.discounts.source,
    },
    anomalies: { total: snapshot.anomalies.anomalies.length, byType },
    alerts: snapshot.alerts.slice(0, 5),
    definitions: SALES_DEFINITIONS,
  };
}

export async function getSalesOverview(
  db: Database,
  context: TenantContext,
  storeId: string,
  request: PeriodRequest,
): Promise<IntelligenceEnvelope<SalesOverviewPayload>> {
  const snapshot = await loadSnapshot(db, context, storeId, request, "day");
  return envelope(storeId, snapshot, overviewData(snapshot));
}

export async function getSalesTrends(
  db: Database,
  context: TenantContext,
  storeId: string,
  request: PeriodRequest,
  granularity: TrendGranularity,
): Promise<IntelligenceEnvelope<SalesTrendsPayload>> {
  const snapshot = await loadSnapshot(db, context, storeId, request, granularity);

  return envelope(storeId, snapshot, {
    granularity: snapshot.trends.granularity,
    buckets: snapshot.trends.buckets,
    previous: snapshot.trends.previous,
    currency: snapshot.trends.currency,
    totals: {
      orders: snapshot.metrics.orders,
      revenue: snapshot.metrics.recognizedRevenue,
      averageOrderValue: snapshot.metrics.averageOrderValue,
    },
    confidence: snapshot.confidence,
  });
}

export async function getSalesAnomalies(
  db: Database,
  context: TenantContext,
  storeId: string,
  request: PeriodRequest,
): Promise<IntelligenceEnvelope<SalesAnomaliesPayload>> {
  const snapshot = await loadSnapshot(db, context, storeId, request, "day");

  return envelope(storeId, snapshot, {
    baseline: snapshot.anomalies.baseline,
    anomalies: snapshot.anomalies.anomalies,
    suppressed: snapshot.anomalies.suppressed,
    alerts: snapshot.alerts,
  });
}

export async function getSalesDiscounts(
  db: Database,
  context: TenantContext,
  storeId: string,
  request: PeriodRequest,
): Promise<IntelligenceEnvelope<SalesDiscountsPayload>> {
  const snapshot = await loadSnapshot(db, context, storeId, request, "day");

  return envelope(storeId, snapshot, {
    ...snapshot.discounts,
    confidence: snapshot.confidence,
  });
}

export async function getSalesDashboard(
  db: Database,
  context: TenantContext,
  storeId: string,
  request: PeriodRequest,
  granularity: TrendGranularity,
): Promise<IntelligenceEnvelope<SalesDashboardData>> {
  const snapshot = await loadSnapshot(db, context, storeId, request, granularity);

  return envelope(storeId, snapshot, {
    metrics: snapshot.metrics,
    confidence: snapshot.confidence,
    trends: snapshot.trends,
    seasonality: snapshot.seasonality,
    anomalies: snapshot.anomalies,
    leakage: snapshot.leakage,
    discounts: snapshot.discounts,
    alerts: snapshot.alerts,
  });
}

/**
 * CSV export computed from the same snapshot as the dashboard.
 *
 * The file is UTF-8 with a BOM so Excel reads Arabic correctly; the rows hold no
 * customer identity because no engine in this phase loads one.
 */
export async function getSalesExport(
  db: Database,
  context: TenantContext,
  storeId: string,
  request: PeriodRequest,
  dataset: ExportDataset,
  granularity: TrendGranularity,
): Promise<SalesExport> {
  const snapshot = await loadSnapshot(db, context, storeId, request, granularity);

  const body =
    dataset === "trends"
      ? buildTrendsCsv(snapshot.trends)
      : dataset === "anomalies"
        ? buildAnomaliesCsv(snapshot.anomalies)
        : buildSummaryCsv(snapshot.metrics, snapshot.metrics.currency.value);

  return {
    filename: exportFileName(
      storeId,
      dataset,
      snapshot.period.key,
      snapshot.period.from.toISOString(),
    ),
    csv: `\uFEFF${body}\r\n`,
  };
}

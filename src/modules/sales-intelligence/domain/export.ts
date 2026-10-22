import type { AnomalyReport } from "./anomalies";
import { salesMetricEntries, type SalesOverviewMetrics } from "./metrics";
import type { SalesTrends } from "./trends";

/**
 * CSV rendering for the sales report.
 *
 * The export is not a second implementation: every row is produced from the
 * same `Metric` objects the API returned, so a file and a screen cannot
 * disagree. Cells are plain numbers or labels; no customer field is reachable
 * from here because none of the engines load one.
 */

export type ExportDataset = "summary" | "trends" | "anomalies";

export const EXPORT_DATASETS: readonly ExportDataset[] = ["summary", "trends", "anomalies"];

function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function row(values: ReadonlyArray<string | number | null | undefined>): string {
  return values.map(cell).join(",");
}

function metricValue(metric: { value: number | null }): string {
  return metric.value === null ? "" : String(metric.value);
}

/** Summary metrics, one row per metric, with the availability and the reason. */
export function buildSummaryCsv(metrics: SalesOverviewMetrics, currency: string | null): string {
  const lines = [
    row(["metric", "label_ar", "value", "availability", "basis", "reason", "currency"]),
  ];

  for (const entry of salesMetricEntries(metrics)) {
    lines.push(
      row([
        entry.key,
        entry.label,
        metricValue(entry.metric),
        entry.metric.availability,
        entry.metric.basis,
        entry.metric.reason,
        currency,
      ]),
    );
  }

  return lines.join("\r\n");
}

/** One row per bucket. Empty values mean "not computable", never zero. */
export function buildTrendsCsv(trends: SalesTrends): string {
  const lines = [
    row([
      "bucket_start",
      "bucket_end",
      "history",
      "orders",
      "revenue",
      "average_order_value",
      "previous_orders",
      "previous_revenue",
      "currency",
    ]),
  ];

  for (const [index, bucket] of trends.buckets.entries()) {
    const previous = trends.previous?.buckets[index];

    lines.push(
      row([
        bucket.key,
        bucket.to,
        bucket.history,
        metricValue(bucket.orders),
        metricValue(bucket.revenue),
        metricValue(bucket.averageOrderValue),
        previous ? metricValue(previous.orders) : "",
        previous ? metricValue(previous.revenue) : "",
        trends.currency.value,
      ]),
    );
  }

  return lines.join("\r\n");
}

/** One row per anomaly, with the arithmetic that triggered it. */
export function buildAnomaliesCsv(report: AnomalyReport): string {
  const lines = [
    row([
      "type",
      "severity",
      "metric",
      "observed",
      "baseline",
      "threshold",
      "unit",
      "change",
      "recommendation",
      "rationale",
      "period_from",
      "period_to",
      "previous_from",
      "previous_to",
    ]),
  ];

  for (const anomaly of report.anomalies) {
    lines.push(
      row([
        anomaly.type,
        anomaly.severity,
        anomaly.metric,
        anomaly.observed,
        anomaly.baseline,
        anomaly.threshold,
        anomaly.unit,
        anomaly.change,
        anomaly.recommendedAction,
        anomaly.rationale,
        anomaly.period.from,
        anomaly.period.to,
        anomaly.period.previousFrom,
        anomaly.period.previousTo,
      ]),
    );
  }

  return lines.join("\r\n");
}

export function exportFileName(
  storeId: string,
  dataset: ExportDataset,
  periodKey: string,
  from: string,
): string {
  const safeFrom = from.slice(0, 10);
  return `sales-intelligence-${storeId}-${dataset}-${periodKey}-${safeFrom}.csv`;
}

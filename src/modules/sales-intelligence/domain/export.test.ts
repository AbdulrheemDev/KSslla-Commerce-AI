import { describe, expect, it } from "vitest";

import { available } from "@/modules/intelligence/domain/types";
import { metric, salesMetrics } from "@/test/sales-fixtures";

import type { AnomalyReport } from "./anomalies";
import { buildAnomaliesCsv, buildSummaryCsv, buildTrendsCsv, exportFileName } from "./export";
import type { SalesTrends } from "./trends";

function lines(csv: string): string[] {
  return csv.split("\r\n");
}

describe("sales export", () => {
  it("renders one summary row per metric with the same values as the API", () => {
    const csv = buildSummaryCsv(salesMetrics(), "SAR");
    const rows = lines(csv);

    expect(rows[0]).toBe("metric,label_ar,value,availability,basis,reason,currency");
    expect(rows).toHaveLength(18); // header + 17 metrics

    const revenue = rows.find((line) => line.startsWith("recognizedRevenue,"));
    expect(revenue).toContain("1000");
    expect(revenue).toContain("available");
    expect(revenue).toContain("SAR");

    const unavailable = rows.find((line) => line.startsWith("previousOrders,"));
    expect(unavailable).toContain("8");
  });

  it("leaves the value empty — never zero — when a metric is unavailable", () => {
    const metrics = salesMetrics({
      recognizedRevenue: {
        value: null,
        availability: "unavailable",
        basis: "sum(orders.total_amount excluding canceled)",
        reason: "orders_not_synced",
      },
    });

    const row = lines(buildSummaryCsv(metrics, null)).find((line) =>
      line.startsWith("recognizedRevenue,"),
    );

    expect(row).toBe(
      "recognizedRevenue,الإيراد المعتمد,,unavailable,sum(orders.total_amount excluding canceled),orders_not_synced,",
    );
  });

  it("renders one trends row per bucket with its coverage state", () => {
    const trends: SalesTrends = {
      granularity: "day",
      currency: available("SAR", "test"),
      previous: null,
      truncated: false,
      buckets: [
        {
          key: "2026-09-21",
          from: "2026-09-21T00:00:00.000Z",
          to: "2026-09-21T23:59:59.999Z",
          history: "before_history",
          orders: {
            value: null,
            availability: "unavailable",
            basis: "count(orders) in bucket",
            reason: "outside_history",
          },
          revenue: {
            value: null,
            availability: "unavailable",
            basis: "sum(total_amount) in bucket",
            reason: "outside_history",
          },
          averageOrderValue: {
            value: null,
            availability: "unavailable",
            basis: "bucket_revenue / priced_orders",
            reason: "outside_history",
          },
          pricedOrders: 0,
        },
        {
          key: "2026-09-22",
          from: "2026-09-22T00:00:00.000Z",
          to: "2026-09-22T23:59:59.999Z",
          history: "covered",
          orders: available(2, "test"),
          revenue: available(300, "test"),
          averageOrderValue: available(150, "test"),
          pricedOrders: 2,
        },
      ],
    };

    const rows = lines(buildTrendsCsv(trends));
    expect(rows).toHaveLength(3);
    expect(rows[0]).toBe(
      "bucket_start,bucket_end,history,orders,revenue,average_order_value,previous_orders,previous_revenue,currency",
    );
    expect(rows[1]).toBe("2026-09-21,2026-09-21T23:59:59.999Z,before_history,,,,,,SAR");
    expect(rows[2]).toBe("2026-09-22,2026-09-22T23:59:59.999Z,covered,2,300,150,,,SAR");
  });

  it("quotes cells that would break the CSV", () => {
    const report: AnomalyReport = {
      baseline: {
        available: true,
        reason: null,
        from: "2026-08-23T00:00:00.000Z",
        to: "2026-09-21T23:59:59.999Z",
      },
      suppressed: [],
      anomalies: [
        {
          id: "anomaly:revenue_drop:2026-09-22",
          type: "revenue_drop",
          severity: "high",
          confidence: "high",
          metric: "recognized_revenue",
          title: "هبوط",
          meaning: "معنى",
          observed: 1000,
          baseline: 1600,
          threshold: 20,
          unit: "percent",
          change: -37.5,
          evidence: [],
          recommendedAction: 'راجع "العروض"، ثم الطلبات',
          rationale: "القاعدة: −20%",
          period: {
            from: "2026-09-22T00:00:00.000Z",
            to: "2026-10-22T00:00:00.000Z",
            previousFrom: "2026-08-23T00:00:00.000Z",
            previousTo: "2026-09-21T23:59:59.999Z",
          },
        },
      ],
    };

    const csv = buildAnomaliesCsv(report);
    expect(csv).toContain('"راجع ""العروض""، ثم الطلبات"');
    expect(lines(csv)).toHaveLength(2);
  });

  it("exports no customer identity in any dataset", () => {
    const summary = buildSummaryCsv(salesMetrics(), "SAR");
    const trends = buildTrendsCsv({
      granularity: "day",
      currency: metric("SAR"),
      previous: null,
      truncated: false,
      buckets: [],
    });

    for (const csv of [summary, trends]) {
      expect(csv).not.toContain("@");
      expect(csv.toLowerCase()).not.toContain("email");
      expect(csv.toLowerCase()).not.toContain("phone");
      expect(csv.toLowerCase()).not.toContain("customer");
    }
  });

  it("names the file with the store, dataset, period and start date", () => {
    expect(
      exportFileName(
        "11111111-2222-3333-4444-555555555555",
        "trends",
        "30d",
        "2026-09-22T00:00:00.000Z",
      ),
    ).toBe("sales-intelligence-11111111-2222-3333-4444-555555555555-trends-30d-2026-09-22.csv");
  });
});

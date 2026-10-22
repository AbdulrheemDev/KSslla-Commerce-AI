import { describe, expect, it } from "vitest";

import type { Coverage, DataFreshness } from "@/modules/intelligence/domain/types";
import { salesMetrics } from "@/test/sales-fixtures";

import { buildSalesAlerts } from "./alerts";
import { detectAnomalies } from "./anomalies";
import { detectLeakage } from "./leakage";

const PERIOD = {
  key: "30d" as const,
  from: new Date("2026-09-22T00:00:00.000Z"),
  to: new Date("2026-10-22T00:00:00.000Z"),
  days: 30,
};

const PREVIOUS = {
  key: "30d" as const,
  from: new Date("2026-08-23T00:00:00.000Z"),
  to: new Date("2026-09-21T23:59:59.999Z"),
  days: 30,
};

const COVERAGE: Coverage = {
  requestedFrom: PERIOD.from.toISOString(),
  requestedTo: PERIOD.to.toISOString(),
  firstOrderAt: "2026-06-01T00:00:00.000Z",
  lastOrderAt: "2026-10-21T00:00:00.000Z",
  status: "complete",
  notes: [],
};

const FRESHNESS: DataFreshness = {
  syncedAt: "2026-10-22T09:00:00.000Z",
  resources: [],
  staleResources: [],
};

function build(
  overrides: {
    coverage?: Coverage;
    freshness?: DataFreshness;
    syncIncomplete?: boolean;
  } = {},
) {
  const metrics = salesMetrics();

  const anomalies = detectAnomalies({
    metrics,
    hasBaseline: true,
    ordersSynced: true,
    syncIncomplete: false,
    coverage: overrides.coverage ?? COVERAGE,
    period: PERIOD,
    previous: PREVIOUS,
  });

  const leakage = detectLeakage(
    { metrics, hasBaseline: true, ordersSynced: true, syncIncomplete: false },
    "2026-09-22",
  );

  return buildSalesAlerts({
    anomalies,
    leakage,
    coverage: overrides.coverage ?? COVERAGE,
    freshness: overrides.freshness ?? FRESHNESS,
    syncIncomplete: overrides.syncIncomplete ?? false,
  });
}

describe("sales alerts", () => {
  it("projects every anomaly and leakage signal into an advisory alert", () => {
    const alerts = build();
    const kinds = new Set(alerts.map((alert) => alert.kind));

    expect(kinds).toContain("anomaly");
    expect(kinds).toContain("leakage");
    expect(alerts.every((alert) => alert.advisoryOnly === true)).toBe(true);
    expect(alerts.every((alert) => alert.evidence.length > 0)).toBe(true);
  });

  it("orders high severity before medium and low", () => {
    const ranks = build().map((alert) =>
      alert.severity === "high" ? 0 : alert.severity === "medium" ? 1 : 2,
    );

    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });

  it("adds a data-quality alert when the mirror is stale", () => {
    const alerts = build({
      freshness: { ...FRESHNESS, staleResources: ["orders"] },
    });

    const dataAlert = alerts.find((alert) => alert.kind === "data_quality");
    expect(dataAlert).toBeDefined();
    expect(dataAlert?.severity).toBe("low");
    expect(dataAlert?.evidence).toContainEqual({ label: "stale_sync", value: "present" });
  });

  it("escalates the data-quality alert when the last sync failed", () => {
    const alerts = build({ syncIncomplete: true });
    const dataAlert = alerts.find((alert) => alert.kind === "data_quality");

    expect(dataAlert?.severity).toBe("medium");
    expect(dataAlert?.evidence).toContainEqual({
      label: "orders_sync_incomplete",
      value: "present",
    });
  });

  it("warns about partial coverage", () => {
    const alerts = build({
      coverage: { ...COVERAGE, status: "partial", notes: ["history_starts_after_window"] },
    });

    expect(alerts.some((alert) => alert.kind === "data_quality")).toBe(true);
  });
});

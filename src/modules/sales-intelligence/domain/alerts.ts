import type {
  Confidence,
  OpportunityEvidence,
  Severity,
} from "@/modules/intelligence/domain/opportunities";
import type { Coverage, DataFreshness } from "@/modules/intelligence/domain/types";

import type { AnomalyReport } from "./anomalies";
import type { LeakageReport } from "./leakage";

/**
 * Advisory sales alerts.
 *
 * An alert is a deterministic projection of something the engines already
 * proved — an anomaly or a leakage signal — plus a data-quality warning when the
 * mirror itself is unreliable. It never introduces a number, never calls a model,
 * and cannot execute anything: `advisoryOnly` is the literal `true`.
 */

export type SalesAlertKind = "anomaly" | "leakage" | "data_quality";

export interface SalesAlert {
  id: string;
  kind: SalesAlertKind;
  severity: Severity;
  title: string;
  message: string;
  evidence: OpportunityEvidence[];
  action: string;
  confidence: Confidence;
  advisoryOnly: true;
}

export interface AlertInput {
  anomalies: AnomalyReport;
  leakage: LeakageReport;
  coverage: Coverage;
  freshness: DataFreshness;
  syncIncomplete: boolean;
}

const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
const MAX_ALERTS = 20;

export function buildSalesAlerts(input: AlertInput): SalesAlert[] {
  const alerts: SalesAlert[] = [];

  for (const anomaly of input.anomalies.anomalies) {
    alerts.push({
      id: `alert:${anomaly.id}`,
      kind: "anomaly",
      severity: anomaly.severity,
      title: anomaly.title,
      message: `${anomaly.rationale} ${anomaly.meaning}`,
      evidence: anomaly.evidence,
      action: anomaly.recommendedAction,
      confidence: anomaly.confidence,
      advisoryOnly: true,
    });
  }

  for (const leak of input.leakage.signals) {
    alerts.push({
      id: `alert:${leak.id}`,
      kind: "leakage",
      severity: leak.severity,
      title: leak.title,
      message: `${leak.rationale} ${leak.description}`,
      evidence: leak.evidence,
      action: leak.recommendedAction,
      confidence: leak.confidence,
      advisoryOnly: true,
    });
  }

  const dataReasons: string[] = [];
  if (input.syncIncomplete) dataReasons.push("orders_sync_incomplete");
  if (input.freshness.staleResources.length > 0) dataReasons.push("stale_sync");
  if (input.coverage.status === "empty") dataReasons.push("no_orders_stored");
  else if (input.coverage.status === "partial") dataReasons.push("partial_coverage");

  if (dataReasons.length > 0) {
    alerts.push({
      id: "alert:data_quality",
      kind: "data_quality",
      severity: input.syncIncomplete ? "medium" : "low",
      title: "جودة بيانات المبيعات",
      message:
        "الأرقام أعلاه مبنية على النسخة المحلية من بيانات Salla، وهذه النسخة تحتاج مراجعة قبل الاعتماد عليها.",
      evidence: dataReasons.map((reason) => ({ label: reason, value: "present" })),
      action: "شغّل مزامنة للطلبات وتأكد من نجاحها قبل اتخاذ قرار مبني على هذه الأرقام.",
      confidence: "high",
      advisoryOnly: true,
    });
  }

  return alerts
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
        a.kind.localeCompare(b.kind) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, MAX_ALERTS);
}

export const ALERT_KIND_LABELS_AR: Record<SalesAlertKind, string> = {
  anomaly: "شذوذ",
  leakage: "تسرّب",
  data_quality: "جودة البيانات",
};

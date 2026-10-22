/**
 * The interface a future AI layer would implement — and nothing else.
 *
 * Phase 07 ships **no** model, **no** provider SDK, **no** prompt, **no** network
 * call and **no** agent. This file exists so the deterministic engines already
 * speak a stable shape when a later phase adds explanatory text on top of them.
 *
 * Two invariants are encoded in the type rather than in documentation:
 *
 * 1. `evidence` is a list of **already-computed facts** (the same metric objects
 *    the deterministic layer returns), so generated text can only restate what
 *    the data says — it cannot introduce a number.
 * 2. `advisoryOnly` is the literal `true`: an insight is never an action, and it
 *    carries no reference to a write endpoint, a store token, or a Salla client.
 *    Reads and recommendations stay on this side of the boundary; any future
 *    write path must go through the existing permission model and audit trail.
 */

export type InsightKind =
  /** A short store-level narrative for the dashboard header. */
  | "summary"
  /** An explanation of why a metric has the value it has. */
  | "explanation"
  /** A narrative restatement of an existing recommendation. */
  | "recommendation"
  /** A flagged change between two windows. */
  | "anomaly";

export interface InsightEvidence {
  /** Metric key, e.g. `sales.average_order_value`. */
  readonly metric: string;
  /** The value as computed by the deterministic layer; never re-derived. */
  readonly value: number | string | null;
  readonly availability: "available" | "partial" | "unavailable";
  readonly reason: string | null;
}

export interface IntelligenceInsight {
  readonly id: string;
  readonly kind: InsightKind;
  readonly entityType: "store" | "product" | "category" | "inventory" | "customer_segment";
  readonly entityId: string | null;
  readonly title: string;
  readonly body: string;
  readonly evidence: readonly InsightEvidence[];
  readonly confidence: "high" | "medium" | "low";
  /** `null` while no provider is configured; the field is reserved, not used. */
  readonly generatedBy: { readonly provider: string; readonly model: string } | null;
  readonly generatedAt: string;
  /** Structurally prevents an insight from being treated as an executed action. */
  readonly advisoryOnly: true;
}

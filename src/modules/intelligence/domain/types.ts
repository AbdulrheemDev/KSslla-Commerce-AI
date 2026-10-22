/**
 * Store-intelligence vocabulary.
 *
 * The guiding rule of Phase 07: a number is shown only when the stored data can
 * actually produce it. Every metric therefore carries
 *
 * - `value`        — the number, or `null` when it cannot be computed;
 * - `availability` — `available` | `partial` | `unavailable`;
 * - `basis`        — the precise definition used (a formula or a provider field);
 * - `reason`       — why it is missing or partial, in machine-readable form.
 *
 * "Zero" and "unknown" are different facts and must never render the same way.
 */

export type Availability = "available" | "partial" | "unavailable";

export interface Metric<T> {
  readonly value: T | null;
  readonly availability: Availability;
  /** How the value was produced: formula id or provider field. */
  readonly basis: string | null;
  /** Machine-readable reason for `partial`/`unavailable`. */
  readonly reason: string | null;
}

export function available<T>(value: T, basis: string): Metric<T> {
  return { value, availability: "available", basis, reason: null };
}

export function partial<T>(value: T, basis: string, reason: string): Metric<T> {
  return { value, availability: "partial", basis, reason };
}

export function unavailable<T>(reason: string, basis: string | null = null): Metric<T> {
  return { value: null, availability: "unavailable", basis, reason };
}

/** Periods the analytics accept. Anything else is rejected, not guessed. */
export type PeriodKey = "today" | "7d" | "30d" | "90d" | "custom";

export interface AnalysisPeriod {
  readonly key: PeriodKey;
  readonly from: Date;
  readonly to: Date;
  /** Inclusive length in days (a `today` window is one day). */
  readonly days: number;
}

export interface PeriodView {
  readonly key: PeriodKey;
  readonly from: string;
  readonly to: string;
  readonly days: number;
}

/** How much of the requested window the stored history actually covers. */
export interface Coverage {
  readonly requestedFrom: string;
  readonly requestedTo: string;
  readonly firstOrderAt: string | null;
  readonly lastOrderAt: string | null;
  readonly status: "complete" | "partial" | "empty";
  readonly notes: string[];
}

/** Freshness of each mirrored resource, derived from `sync_runs`. */
export interface FreshnessResource {
  readonly resource: "products" | "categories" | "customers" | "orders" | "inventory";
  readonly status: "never" | "running" | "succeeded" | "failed";
  readonly lastSuccessAt: string | null;
  readonly lastFailureAt: string | null;
  readonly lastErrorCode: string | null;
  readonly stale: boolean;
}

export interface DataFreshness {
  readonly syncedAt: string | null;
  readonly resources: readonly FreshnessResource[];
  readonly staleResources: readonly string[];
}

/** Standard envelope returned by every intelligence endpoint. */
export interface IntelligenceEnvelope<T> {
  readonly storeId: string;
  readonly generatedAt: string;
  readonly period: PeriodView;
  readonly coverage: Coverage;
  readonly freshness: DataFreshness;
  readonly data: T;
}

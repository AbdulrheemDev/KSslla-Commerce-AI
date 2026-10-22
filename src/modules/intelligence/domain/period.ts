import type {
  AnalysisPeriod,
  Coverage,
  PeriodKey,
  PeriodView,
} from "@/modules/intelligence/domain/types";

/**
 * Time windows.
 *
 * All boundaries are **UTC**. Salla returns each order with its own timezone
 * (`date.timezone`), and the mirror stores a timezone-qualified timestamp, so a
 * UTC boundary is the only definition that is identical for every order in the
 * window. A merchant-local calendar day would need a store timezone the API does
 * not document per store, and inventing `Asia/Riyadh` would shift the first and
 * last hours of every window for stores outside it.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_CUSTOM_RANGE_DAYS = 366;

export class InvalidPeriodError extends Error {
  constructor(readonly code: "invalid_period" | "invalid_range" | "range_too_large") {
    super(code);
    this.name = "InvalidPeriodError";
  }
}

export const SUPPORTED_PERIODS: readonly PeriodKey[] = ["today", "7d", "30d", "90d", "custom"];

export const DEFAULT_PERIOD: PeriodKey = "30d";

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function addUtcDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * DAY_MS);
}

function parseDateOnly(value: string, boundary: "start" | "end"): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new InvalidPeriodError("invalid_period");

  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));

  // Reject impossible calendar dates such as 2026-02-31 (which Date rolls over).
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new InvalidPeriodError("invalid_period");
  }

  return boundary === "start" ? date : new Date(date.getTime() + DAY_MS - 1);
}

export interface PeriodRequest {
  period?: string | null;
  from?: string | null;
  to?: string | null;
}

/**
 * Resolves a request into a bounded window.
 *
 * `now` is injected so the same request always produces the same window in
 * tests, and so an analysis can be reproduced later from its `generatedAt`.
 */
export function resolvePeriod(input: PeriodRequest, now: Date): AnalysisPeriod {
  const key = (input.period ?? DEFAULT_PERIOD) as PeriodKey;

  if (!SUPPORTED_PERIODS.includes(key)) throw new InvalidPeriodError("invalid_period");

  if (key === "custom") {
    if (!input.from || !input.to) throw new InvalidPeriodError("invalid_period");

    const from = parseDateOnly(input.from, "start");
    const to = parseDateOnly(input.to, "end");

    if (from.getTime() > to.getTime()) throw new InvalidPeriodError("invalid_range");

    const days = Math.floor((to.getTime() - from.getTime()) / DAY_MS) + 1;
    if (days > MAX_CUSTOM_RANGE_DAYS) throw new InvalidPeriodError("range_too_large");

    return { key, from, to, days };
  }

  if (key === "today") {
    return { key, from: startOfUtcDay(now), to: now, days: 1 };
  }

  const days = key === "7d" ? 7 : key === "30d" ? 30 : 90;
  return { key, from: addUtcDays(now, -days), to: now, days };
}

/** The immediately preceding window of the same length, used for growth. */
export function previousPeriod(period: AnalysisPeriod): AnalysisPeriod {
  const end = new Date(period.from.getTime() - 1);
  const start = new Date(period.from.getTime() - period.days * DAY_MS);

  return { key: period.key, from: start, to: end, days: period.days };
}

export function toPeriodView(period: AnalysisPeriod): PeriodView {
  return {
    key: period.key,
    from: period.from.toISOString(),
    to: period.to.toISOString(),
    days: period.days,
  };
}

export interface CoverageInput {
  period: AnalysisPeriod;
  totalOrders: number;
  firstOrderAt: Date | null;
  lastOrderAt: Date | null;
  /** True when the latest orders run failed or stopped before completing. */
  ordersSyncIncomplete: boolean;
}

/**
 * Reports how much of the requested window the mirror can actually answer for.
 *
 * Two different things are checked, and they are not the same:
 *
 * - **history**: does the earliest stored order predate the window start? If
 *   not, the first days are unknown rather than zero;
 * - **completeness**: did the orders sync finish? A window inside the history
 *   can still be partial if the run that fills it failed.
 */
export function computeCoverage(input: CoverageInput): Coverage {
  const { period, firstOrderAt, lastOrderAt, totalOrders, ordersSyncIncomplete } = input;
  const notes: string[] = [];

  if (totalOrders === 0) {
    return {
      requestedFrom: period.from.toISOString(),
      requestedTo: period.to.toISOString(),
      firstOrderAt: null,
      lastOrderAt: null,
      status: "empty",
      notes: ["no_orders_stored"],
    };
  }

  if (!firstOrderAt) {
    notes.push("no_order_dates");
  } else if (firstOrderAt.getTime() > period.from.getTime()) {
    notes.push("history_starts_after_window");
  }

  if (ordersSyncIncomplete) notes.push("orders_sync_incomplete");

  return {
    requestedFrom: period.from.toISOString(),
    requestedTo: period.to.toISOString(),
    firstOrderAt: firstOrderAt?.toISOString() ?? null,
    lastOrderAt: lastOrderAt?.toISOString() ?? null,
    status: notes.length === 0 ? "complete" : "partial",
    notes,
  };
}

/**
 * True when the previous window lies inside the stored history, which is what a
 * growth comparison needs. Without it, growth is `unavailable` — not zero.
 */
export function hasPreviousBaseline(
  period: AnalysisPeriod,
  firstOrderAt: Date | null,
  ordersSyncIncomplete: boolean,
): boolean {
  if (!firstOrderAt) return false;
  return firstOrderAt.getTime() <= previousPeriod(period).from.getTime() && !ordersSyncIncomplete;
}

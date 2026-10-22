/**
 * Minimal metrics seam.
 *
 * Phase 04 needs counters that a future Prometheus/OpenTelemetry adapter can
 * consume, without adding either dependency now. The default sink keeps a
 * bounded in-process snapshot for diagnostics; callers never depend on it.
 *
 * Cardinality rule: label values come from a closed set in code
 * (`products`, `categories`, `succeeded`, `failed`, ...), never from user input
 * or provider ids.
 */

export type MetricName =
  | "sync.runs"
  | "sync.failures"
  | "sync.items"
  | "sync.pages"
  | "sync.duration_ms"
  | "salla.requests"
  | "salla.rate_limits";

type Labels = Record<string, string>;

export interface MetricsSink {
  increment(name: MetricName, labels?: Labels, value?: number): void;
  observe(name: MetricName, value: number, labels?: Labels): void;
}

const MAX_SERIES = 200;

class InMemoryMetrics implements MetricsSink {
  private readonly counters = new Map<string, number>();
  private readonly observations = new Map<string, { count: number; sum: number; max: number }>();

  increment(name: MetricName, labels: Labels = {}, value = 1): void {
    const key = this.key(name, labels);
    this.counters.set(key, (this.counters.get(key) ?? 0) + value);
  }

  observe(name: MetricName, value: number, labels: Labels = {}): void {
    const key = this.key(name, labels);
    const current = this.observations.get(key) ?? { count: 0, sum: 0, max: 0 };
    this.observations.set(key, {
      count: current.count + 1,
      sum: current.sum + value,
      max: Math.max(current.max, value),
    });
  }

  get size(): number {
    return this.counters.size + this.observations.size;
  }

  snapshot(): Array<{
    name: string;
    count?: number;
    countObs?: number;
    sum?: number;
    max?: number;
  }> {
    return [
      ...[...this.counters.entries()].map(([name, count]) => ({ name, count })),
      ...[...this.observations.entries()].map(([name, stats]) => ({
        name,
        countObs: stats.count,
        sum: stats.sum,
        max: stats.max,
      })),
    ];
  }

  reset(): void {
    this.counters.clear();
    this.observations.clear();
  }

  private key(name: MetricName, labels: Labels): string {
    const serialized = Object.keys(labels)
      .sort()
      .map((key) => `${key}=${labels[key]}`)
      .join(",");
    return serialized ? `${name}{${serialized}}` : name;
  }
}

const inMemory = new InMemoryMetrics();

/** Swappable at application start; tests use the default. */
export const metrics: MetricsSink = {
  increment(name, labels, value) {
    if (inMemory.size > MAX_SERIES) return;
    inMemory.increment(name, labels, value);
  },
  observe(name, value, labels) {
    if (inMemory.size > MAX_SERIES) return;
    inMemory.observe(name, value, labels);
  },
};

export function snapshotMetrics(): ReturnType<InMemoryMetrics["snapshot"]> {
  return inMemory.snapshot();
}

export function resetMetrics(): void {
  inMemory.reset();
}

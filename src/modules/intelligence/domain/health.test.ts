import { describe, expect, it } from "vitest";

import {
  computeStoreHealth,
  HEALTH_WEIGHTS,
  type HealthInput,
} from "@/modules/intelligence/domain/health";
import type { DataFreshness } from "@/modules/intelligence/domain/types";

const NOW = new Date("2026-10-22T12:00:00.000Z");

function freshness(overrides: Partial<DataFreshness> = {}): DataFreshness {
  return {
    syncedAt: "2026-10-22T11:00:00.000Z",
    resources: [
      {
        resource: "products",
        status: "succeeded",
        lastSuccessAt: "2026-10-22T11:00:00.000Z",
        lastFailureAt: null,
        lastErrorCode: null,
        stale: false,
      },
      {
        resource: "categories",
        status: "succeeded",
        lastSuccessAt: "2026-10-22T11:00:00.000Z",
        lastFailureAt: null,
        lastErrorCode: null,
        stale: false,
      },
      {
        resource: "customers",
        status: "succeeded",
        lastSuccessAt: "2026-10-22T11:00:00.000Z",
        lastFailureAt: null,
        lastErrorCode: null,
        stale: false,
      },
      {
        resource: "orders",
        status: "succeeded",
        lastSuccessAt: "2026-10-22T11:00:00.000Z",
        lastFailureAt: null,
        lastErrorCode: null,
        stale: false,
      },
      {
        resource: "inventory",
        status: "succeeded",
        lastSuccessAt: "2026-10-22T11:00:00.000Z",
        lastFailureAt: null,
        lastErrorCode: null,
        stale: false,
      },
    ],
    staleResources: [],
    ...overrides,
  };
}

function input(overrides: Partial<HealthInput> = {}): HealthInput {
  return {
    productTotal: 10,
    missingPrice: 0,
    missingCategory: 0,
    missingImage: 0,
    inStock: 10,
    stockKnown: 10,
    completedOrders30d: 10,
    freshness: freshness(),
    now: NOW,
    ...overrides,
  };
}

describe("computeStoreHealth", () => {
  it("gives a perfect store 100", () => {
    const result = computeStoreHealth(input());

    expect(result.score.value).toBe(100);
    expect(result.score.availability).toBe("available");
    expect(result.grade).toBe("excellent");
    expect(result.usedComponents).toHaveLength(5);
  });

  it("scores a partial store between the extremes", () => {
    const result = computeStoreHealth(
      input({ missingPrice: 5, missingCategory: 5, inStock: 5, completedOrders30d: 5 }),
    );

    expect(result.score.value).toBeGreaterThan(50);
    expect(result.score.value).toBeLessThan(90);
    expect(result.grade).not.toBe("excellent");
  });

  it("excludes components without data and renormalises", () => {
    const result = computeStoreHealth(
      input({
        productTotal: 0,
        stockKnown: 0,
        completedOrders30d: null,
        freshness: {
          syncedAt: null,
          resources: [],
          staleResources: [],
        },
      }),
    );

    expect(result.score.value).toBeNull();
    expect(result.score.reason).toBe("insufficient_data");
    expect(result.grade).toBeNull();
  });

  it("marks the score partial when only some components exist", () => {
    const result = computeStoreHealth(
      input({
        productTotal: 0,
        stockKnown: 0,
        completedOrders30d: null,
        freshness: {
          syncedAt: "2026-10-22T11:00:00.000Z",
          resources: [
            {
              resource: "orders",
              status: "succeeded",
              lastSuccessAt: "2026-10-22T11:00:00.000Z",
              lastFailureAt: null,
              lastErrorCode: null,
              stale: false,
            },
          ],
          staleResources: [],
        },
      }),
    );

    expect(result.score.availability).toBe("partial");
    expect(result.score.reason).toBe("some_components_unavailable");
    expect(result.usedComponents.sort()).toEqual(["freshness", "sync_health"]);
  });

  it("drops the freshness ladder with age", () => {
    const at = (iso: string) =>
      computeStoreHealth(
        input({ freshness: freshness({ syncedAt: iso, resources: [] }) }),
      ).components.find((component) => component.id === "freshness")!.score;

    expect(at("2026-10-22T11:30:00.000Z")).toBe(100);
    expect(at("2026-10-21T18:00:00.000Z")).toBe(75);
    expect(at("2026-10-18T12:00:00.000Z")).toBe(40);
    expect(at("2026-09-01T12:00:00.000Z")).toBe(10);
  });

  it("uses documented weights that sum to 100", () => {
    expect(Object.values(HEALTH_WEIGHTS).reduce((sum, weight) => sum + weight, 0)).toBe(100);
  });

  it("treats stale resources as unhealthy sync", () => {
    const stale: DataFreshness["resources"] = [
      {
        resource: "products",
        status: "succeeded",
        lastSuccessAt: "2026-10-20T11:00:00.000Z",
        lastFailureAt: null,
        lastErrorCode: null,
        stale: true,
      },
      {
        resource: "orders",
        status: "succeeded",
        lastSuccessAt: "2026-10-22T11:00:00.000Z",
        lastFailureAt: null,
        lastErrorCode: null,
        stale: false,
      },
    ];

    const result = computeStoreHealth(
      input({ freshness: freshness({ resources: stale, staleResources: ["products"] }) }),
    );
    const sync = result.components.find((component) => component.id === "sync_health")!;

    expect(sync.score).toBe(50);
  });
});

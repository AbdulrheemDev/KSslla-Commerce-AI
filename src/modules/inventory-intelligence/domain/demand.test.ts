import { describe, expect, it } from "vitest";

import { DEMAND_UNAVAILABLE_REASON, resolveDemand } from "./demand";

/**
 * Demand is the missing input of this whole phase.
 *
 * The contract exists so a future documented source can be wired in, but nothing
 * in the module can supply a value today: `resolveDemand()` takes no arguments and
 * always returns `unavailable`. These tests make that a hard guarantee rather than
 * a comment.
 */
describe("product demand resolution", () => {
  it("is always unavailable, with the documented reason", () => {
    const demand = resolveDemand();

    expect(demand.dailyDemand.value).toBeNull();
    expect(demand.dailyDemand.availability).toBe("unavailable");
    expect(demand.dailyDemand.reason).toBe(DEMAND_UNAVAILABLE_REASON);
  });

  it("names the arithmetic it would need in its basis", () => {
    expect(resolveDemand().dailyDemand.basis).toContain("window");
  });

  it("uses one reason code for every dependent metric", () => {
    expect(DEMAND_UNAVAILABLE_REASON).toBe("product_demand_not_linked");
  });

  it("does not derive a rate from the cumulative sold quantity", () => {
    // There is no parameter to pass a cumulative counter through — the signature
    // is the guard. If a future change adds one, this test must be revisited
    // together with docs/salla-reference.md §18.
    expect(resolveDemand.length).toBe(0);
  });
});

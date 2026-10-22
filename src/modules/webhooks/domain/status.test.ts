import { describe, expect, it } from "vitest";

import {
  canTransition,
  CLAIMABLE_STATUSES,
  isTerminalStatus,
  REPLAYABLE_STATUSES,
  WEBHOOK_EVENT_STATUSES,
  type WebhookEventStatus,
} from "@/modules/webhooks/domain/status";
import {
  decideAfterFailure,
  isRetryableErrorCode,
  MAX_WEBHOOK_ATTEMPTS,
  RETRY_DELAYS_MS,
} from "@/modules/webhooks/domain/retry";

/**
 * Inbox state machine and retry policy.
 *
 * The rules under test are the ones the worker relies on: only `received` and
 * `failed` are claimable, nothing but an audited replay re-opens a terminal
 * row, and a failed attempt never becomes `processed`.
 */

const TRANSIENT: Record<WebhookEventStatus, readonly WebhookEventStatus[]> = {
  received: ["processing", "ignored", "unmatched"],
  processing: ["processed", "failed", "dead_letter"],
  failed: ["processing", "dead_letter", "received"],
  processed: ["received"],
  dead_letter: ["received"],
  ignored: ["received"],
  unmatched: ["received"],
};

describe("canTransition", () => {
  it("matches the documented state machine for every pair", () => {
    for (const from of WEBHOOK_EVENT_STATUSES) {
      for (const to of WEBHOOK_EVENT_STATUSES) {
        expect(canTransition(from, to), `${from} → ${to}`).toBe(TRANSIENT[from].includes(to));
      }
    }
  });

  it("never lets a terminal row go back to processing without a replay", () => {
    for (const from of ["processed", "dead_letter", "ignored", "unmatched"] as const) {
      expect(canTransition(from, "processing")).toBe(false);
    }
  });

  it("never lets a processed row fail or a failed row jump straight to processed", () => {
    expect(canTransition("processed", "failed")).toBe(false);
    expect(canTransition("processed", "dead_letter")).toBe(false);
    expect(canTransition("failed", "processed")).toBe(false);
    expect(canTransition("received", "processed")).toBe(false);
  });
});

describe("claimable and replayable statuses", () => {
  it("claims only rows that are due", () => {
    expect([...CLAIMABLE_STATUSES]).toEqual(["received", "failed"]);
  });

  it("cannot claim a terminal row", () => {
    // `failed` is replayable *and* claimable: it is the row's own retry, not a
    // replay. Every other replayable state is terminal and inert until an
    // operator re-opens it.
    for (const status of REPLAYABLE_STATUSES.filter(isTerminalStatus)) {
      expect(CLAIMABLE_STATUSES.includes(status)).toBe(false);
    }
  });

  it("marks exactly the terminal states as terminal", () => {
    expect(WEBHOOK_EVENT_STATUSES.filter(isTerminalStatus)).toEqual([
      "processed",
      "dead_letter",
      "unmatched",
      "ignored",
    ]);
  });
});

describe("decideAfterFailure", () => {
  const now = new Date("2026-10-22T10:00:00.000Z");

  it("schedules the documented delays", () => {
    expect(RETRY_DELAYS_MS).toEqual([60_000, 300_000]);

    const first = decideAfterFailure(1, now, true);
    expect(first).toMatchObject({ status: "failed", attempt: 1, delayMs: 60_000 });
    expect(first.status === "failed" && first.availableAt.toISOString()).toBe(
      "2026-10-22T10:01:00.000Z",
    );

    const second = decideAfterFailure(2, now, true);
    expect(second).toMatchObject({ status: "failed", attempt: 2, delayMs: 300_000 });
    expect(second.status === "failed" && second.availableAt.toISOString()).toBe(
      "2026-10-22T10:05:00.000Z",
    );
  });

  it("dead-letters on the last allowed attempt", () => {
    expect(MAX_WEBHOOK_ATTEMPTS).toBe(3);
    expect(decideAfterFailure(3, now, true)).toEqual({
      status: "dead_letter",
      attempt: 3,
      availableAt: now,
    });
  });

  it("dead-letters immediately for a non-retryable failure", () => {
    expect(decideAfterFailure(1, now, false)).toEqual({
      status: "dead_letter",
      attempt: 1,
      availableAt: now,
    });
  });

  it("stays bounded even if the attempt counter is ahead of the schedule", () => {
    expect(decideAfterFailure(9, now, true).status).toBe("dead_letter");
  });
});

describe("isRetryableErrorCode", () => {
  it("retries transient provider and database problems", () => {
    for (const code of ["INTEGRATION_ERROR", "RATE_LIMITED", "INTERNAL"]) {
      expect(isRetryableErrorCode(code)).toBe(true);
    }
  });

  it("does not retry a configuration or authorization fault", () => {
    for (const code of [
      "INTEGRATION_AUTH_REQUIRED",
      "INTEGRATION_NOT_CONNECTED",
      "FORBIDDEN",
      "NOT_FOUND",
      "VALIDATION_FAILED",
    ]) {
      expect(isRetryableErrorCode(code)).toBe(false);
    }
  });

  it("defaults an unknown code to retryable, bounded by the attempt ceiling", () => {
    expect(isRetryableErrorCode("SOMETHING_NEW")).toBe(true);
  });
});

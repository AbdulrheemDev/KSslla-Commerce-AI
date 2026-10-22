/**
 * Inbox state machine.
 *
 * ```
 * received ──▶ processing ──▶ processed
 *    ▲             │
 *    │             ├──▶ failed ──(available_at)──▶ processing
 *    │             │        └── attempts exhausted ──▶ dead_letter
 *    └── replay ───┴──▶ dead_letter
 *
 * unmatched  — verified delivery that maps to no connected store (terminal)
 * ignored    — known or unknown event with no local action (terminal)
 * ```
 *
 * `processed → processing` is not reachable: a terminal row is only re-opened by
 * an explicit replay, which resets it to `received` and is audited.
 */

export const WEBHOOK_EVENT_STATUSES = [
  "received",
  "processing",
  "processed",
  "failed",
  "dead_letter",
  "unmatched",
  "ignored",
] as const;

export type WebhookEventStatus = (typeof WEBHOOK_EVENT_STATUSES)[number];

/** Statuses a worker may claim. */
export const CLAIMABLE_STATUSES: readonly WebhookEventStatus[] = ["received", "failed"];

/** Statuses a tenant user may replay from. */
export const REPLAYABLE_STATUSES: readonly WebhookEventStatus[] = [
  "failed",
  "dead_letter",
  "ignored",
  "processed",
];

export function isTerminalStatus(status: WebhookEventStatus): boolean {
  return (
    status === "processed" ||
    status === "unmatched" ||
    status === "ignored" ||
    status === "dead_letter"
  );
}

export function canTransition(from: WebhookEventStatus, to: WebhookEventStatus): boolean {
  switch (from) {
    case "received":
      return to === "processing" || to === "ignored" || to === "unmatched";
    case "failed":
      return to === "processing" || to === "dead_letter" || to === "received";
    case "processing":
      return to === "processed" || to === "failed" || to === "dead_letter";
    case "dead_letter":
    case "ignored":
    case "unmatched":
    case "processed":
      return to === "received";
    default:
      return false;
  }
}

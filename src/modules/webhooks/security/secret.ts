import { getServerEnv } from "@/lib/env";

/**
 * Webhook signing secret.
 *
 * Salla registers a secret with the webhook; the same value is configured here
 * as `SALLA_WEBHOOK_SECRET`. It is read on demand from the validated server
 * environment and never cached in a module-level constant, so a rotated secret
 * takes effect without a restart and a test can substitute one.
 *
 * Nothing in this module logs the value, and no caller receives it: only the
 * signature helpers get it.
 */
export function getWebhookSecret(): string | null {
  try {
    const value = getServerEnv().SALLA_WEBHOOK_SECRET;
    return value && value.trim().length > 0 ? value.trim() : null;
  } catch {
    return null;
  }
}

export function isWebhookConfigured(): boolean {
  return getWebhookSecret() !== null;
}

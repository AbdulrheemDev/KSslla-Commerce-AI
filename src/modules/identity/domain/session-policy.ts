/** Session and cookie policy (docs/phase-02.md §3.2). */

export const SESSION_COOKIE_NAME = "__Host-ksh_session";
export const CSRF_COOKIE_NAME = "__Host-ksh_csrf";
export const CSRF_HEADER_NAME = "x-csrf-token";

export const SESSION_IDLE_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000;

/** `last_seen_at` is written at most once per interval to avoid write amplification. */
export const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

import { getServerEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";

/**
 * Secret used to key session and invitation token digests.
 *
 * Read lazily so tests can control the environment before the first call and so
 * `next build` does not require it.
 */
export function getAuthSecret(): string {
  const secret = getServerEnv().AUTH_SECRET;

  if (!secret) {
    throw new AppError({
      code: "CONFIG_INVALID",
      message: "AUTH_SECRET is not configured.",
    });
  }

  return secret;
}

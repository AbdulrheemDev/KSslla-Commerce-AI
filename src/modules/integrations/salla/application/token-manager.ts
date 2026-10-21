import { randomUUID } from "node:crypto";

import type { Database } from "@/db/client";
import { withTenantTransaction } from "@/db/tenant";
import type { ConnectionStatus } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { connectionAad, decryptSecret, encryptSecret } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import { recordAudit } from "@/modules/audit/infrastructure/audit-repository";
import { requireSallaConfig } from "@/modules/integrations/salla/config";
import {
  sallaInvalidGrant,
  SallaIntegrationError,
} from "@/modules/integrations/salla/domain/errors";
import {
  REFRESH_LEASE_SECONDS,
  isAccessTokenUsable,
  isConnectionUsable,
} from "@/modules/integrations/salla/domain/tokens";
import { refreshAccessToken } from "@/modules/integrations/salla/infrastructure/oauth-client";
import {
  acquireRefreshLease,
  findConnectionById,
  markReauthRequired,
  recordRefreshFailure,
  releaseRefreshLease,
  saveRefreshedTokens,
  updateConnectionStatus,
  type ConnectionRecord,
} from "@/modules/integrations/salla/infrastructure/connection-repository";

/**
 * Salla access-token provider.
 *
 * Salla refresh tokens are single-use: spending one twice invalidates the grant
 * and forces the merchant to reinstall the app. Therefore:
 *
 * - exactly one worker may refresh a connection at a time (database lease);
 * - the connection is reloaded after acquiring the lease, and the refresh is
 *   skipped if another worker already advanced the token version;
 * - the token endpoint is never retried;
 * - `invalid_grant` moves the connection to `reauth_required` permanently.
 */

const LEASE_WAIT_STEP_MS = 100;
const LEASE_WAIT_ATTEMPTS = 50;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface AccessTokenResult {
  accessToken: string;
  expiresAt: Date;
  connectionId: string;
}

export interface GetAccessTokenOptions {
  forceRefresh?: boolean;
  now?: Date;
}

function unusableConnection(status: ConnectionStatus): AppError {
  return new AppError({
    code: "INTEGRATION_AUTH_REQUIRED",
    message:
      status === "disconnected" || status === "revoked"
        ? "This store is not connected to Salla."
        : "Salla authorization must be renewed for this store.",
    details: { connectionStatus: status },
  });
}

async function loadConnection(
  db: Database,
  organizationId: string,
  connectionId: string,
): Promise<ConnectionRecord> {
  const connection = await withTenantTransaction(db, { organizationId }, (tx) =>
    findConnectionById(tx, connectionId),
  );

  if (!connection) {
    throw new AppError({ code: "NOT_FOUND", message: "Salla connection not found." });
  }

  return connection;
}

function decryptAccessToken(connection: ConnectionRecord, aad: string): AccessTokenResult {
  if (!connection.accessTokenCiphertext || !connection.accessTokenExpiresAt) {
    throw new AppError({
      code: "INTEGRATION_AUTH_REQUIRED",
      message: "Salla authorization must be renewed for this store.",
    });
  }

  return {
    accessToken: decryptSecret(connection.accessTokenCiphertext, aad),
    expiresAt: connection.accessTokenExpiresAt,
    connectionId: connection.id,
  };
}

export async function getAccessToken(
  db: Database,
  input: { organizationId: string; connectionId: string },
  options: GetAccessTokenOptions = {},
): Promise<AccessTokenResult> {
  const now = options.now ?? new Date();

  let connection = await loadConnection(db, input.organizationId, input.connectionId);
  const aadFor = (row: ConnectionRecord) =>
    connectionAad({
      provider: "salla",
      organizationId: input.organizationId,
      storeId: row.storeId,
    });

  if (!isConnectionUsable(connection.status)) {
    throw unusableConnection(connection.status);
  }

  if (!options.forceRefresh && isAccessTokenUsable(connection.accessTokenExpiresAt, now)) {
    return decryptAccessToken(connection, aadFor(connection));
  }

  if (!connection.refreshTokenCiphertext) {
    if (isAccessTokenUsable(connection.accessTokenExpiresAt, now)) {
      return decryptAccessToken(connection, aadFor(connection));
    }
    await withTenantTransaction(db, { organizationId: input.organizationId }, (tx) =>
      markReauthRequired(tx, connection.id, "no_refresh_token"),
    );
    throw sallaInvalidGrant();
  }

  if (
    connection.refreshTokenExpiresAt &&
    connection.refreshTokenExpiresAt.getTime() <= now.getTime()
  ) {
    await withTenantTransaction(db, { organizationId: input.organizationId }, (tx) =>
      markReauthRequired(tx, connection.id, "refresh_expired"),
    );
    throw sallaInvalidGrant();
  }

  const lockId = randomUUID();
  const observedVersion = connection.tokenVersion;
  let acquired = false;

  for (let attempt = 0; attempt < LEASE_WAIT_ATTEMPTS; attempt += 1) {
    acquired = await withTenantTransaction(db, { organizationId: input.organizationId }, (tx) =>
      acquireRefreshLease(tx, connection.id, lockId, REFRESH_LEASE_SECONDS),
    );

    if (acquired) break;

    await sleep(LEASE_WAIT_STEP_MS);
    connection = await loadConnection(db, input.organizationId, input.connectionId);

    if (!isConnectionUsable(connection.status)) {
      throw unusableConnection(connection.status);
    }

    if (isAccessTokenUsable(connection.accessTokenExpiresAt, now)) {
      return decryptAccessToken(connection, aadFor(connection));
    }
  }

  if (!acquired) {
    throw new AppError({
      code: "INTEGRATION_ERROR",
      message: "A token refresh is already in progress. Try again shortly.",
      retryable: true,
    });
  }

  try {
    const reloaded = await loadConnection(db, input.organizationId, input.connectionId);

    // Another worker refreshed while we waited for the lease.
    if (
      reloaded.tokenVersion !== observedVersion &&
      isAccessTokenUsable(reloaded.accessTokenExpiresAt, now)
    ) {
      await withTenantTransaction(db, { organizationId: input.organizationId }, (tx) =>
        releaseRefreshLease(tx, reloaded.id, lockId),
      );
      return decryptAccessToken(reloaded, aadFor(reloaded));
    }

    await withTenantTransaction(db, { organizationId: input.organizationId }, (tx) =>
      updateConnectionStatus(tx, reloaded.id, "refreshing"),
    );

    const config = requireSallaConfig();
    const currentRefreshToken = decryptSecret(reloaded.refreshTokenCiphertext!, aadFor(reloaded));

    const refreshedAt = new Date();
    const tokens = await refreshAccessToken(config, currentRefreshToken, refreshedAt);
    const aad = aadFor(reloaded);

    const saved = await withTenantTransaction(
      db,
      { organizationId: input.organizationId },
      async (tx) => {
        const row = await saveRefreshedTokens(tx, reloaded.id, lockId, {
          accessTokenCiphertext: encryptSecret(tokens.accessToken, aad),
          refreshTokenCiphertext: encryptSecret(tokens.refreshToken!, aad),
          accessTokenExpiresAt: tokens.accessTokenExpiresAt,
          refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
          scopes: tokens.scopes,
          refreshedAt,
          expectedVersion: observedVersion,
        });

        if (row) {
          await recordAudit(tx, {
            organizationId: input.organizationId,
            actorUserId: null,
            action: "salla.token.refreshed",
            entityType: "store_connection",
            entityId: row.id,
            metadata: { provider: "salla", tokenVersion: row.tokenVersion },
          });
        }

        return row;
      },
    );

    if (!saved) {
      await withTenantTransaction(db, { organizationId: input.organizationId }, (tx) =>
        releaseRefreshLease(tx, reloaded.id, lockId),
      );
      const latest = await loadConnection(db, input.organizationId, input.connectionId);
      if (isAccessTokenUsable(latest.accessTokenExpiresAt, now)) {
        return decryptAccessToken(latest, aadFor(latest));
      }
      throw new AppError({
        code: "INTEGRATION_ERROR",
        message: "Token refresh could not be persisted. Try again shortly.",
        retryable: true,
      });
    }

    return {
      accessToken: tokens.accessToken,
      expiresAt: tokens.accessTokenExpiresAt,
      connectionId: saved.id,
    };
  } catch (error) {
    if (error instanceof SallaIntegrationError && error.sallaKind === "invalid_grant") {
      await withTenantTransaction(db, { organizationId: input.organizationId }, async (tx) => {
        await markReauthRequired(tx, connection.id, "invalid_grant");
        await recordAudit(tx, {
          organizationId: input.organizationId,
          actorUserId: null,
          action: "salla.token.refresh_failed",
          entityType: "store_connection",
          entityId: connection.id,
          metadata: { provider: "salla", reason: "invalid_grant" },
        });
      });
      throw sallaInvalidGrant();
    }

    // Transient failure: keep the connection, release the lease, and surface a
    // retryable error. Tokens are untouched.
    const code = error instanceof SallaIntegrationError ? error.sallaKind : "unknown";
    await withTenantTransaction(db, { organizationId: input.organizationId }, async (tx) => {
      await recordRefreshFailure(tx, connection.id, lockId, code);
      await updateConnectionStatus(tx, connection.id, "connected", code);
      await releaseRefreshLease(tx, connection.id, lockId);
      await recordAudit(tx, {
        organizationId: input.organizationId,
        actorUserId: null,
        action: "salla.token.refresh_failed",
        entityType: "store_connection",
        entityId: connection.id,
        metadata: { provider: "salla", reason: code },
      });
    });

    logger.warn({ sallaKind: code, connectionId: connection.id }, "salla token refresh failed");
    throw error;
  }
}

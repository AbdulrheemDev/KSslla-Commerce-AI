import type { Database } from "@/db/client";
import { bindOrganization, withOAuthStateLookup, withTenantTransaction } from "@/db/tenant";
import type { ConnectionStatus } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { connectionAad, encryptSecret } from "@/lib/crypto";
import { recordAudit } from "@/modules/audit/infrastructure/audit-repository";
import { hasPermission, type Permission } from "@/modules/identity/domain/permissions";
import { getAuthSecret } from "@/modules/identity/infrastructure/auth-secret";
import { loadMembershipForUser } from "@/modules/identity/application/auth-service";
import type { RequestMeta, TenantContext } from "@/modules/identity/application/types";
import { requireStoreAccess } from "@/modules/stores/application/store-service";
import { findStoreById, updateStoreStatus } from "@/modules/stores/infrastructure/store-repository";
import { readSallaConfig, requireSallaConfig } from "@/modules/integrations/salla/config";
import type { CallbackFailureReason } from "@/modules/integrations/salla/domain/messages";
import { SALLA_REQUIRED_SCOPES } from "@/modules/integrations/salla/domain/scopes";
import {
  generateOAuthState,
  getStateExpiry,
  hashOAuthState,
} from "@/modules/integrations/salla/domain/state";
import {
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  fetchMerchantIdentity,
} from "@/modules/integrations/salla/infrastructure/oauth-client";
import {
  consumeState,
  findStateByHash,
  insertOAuthState,
  invalidatePendingStates,
} from "@/modules/integrations/salla/infrastructure/state-repository";
import {
  disconnectConnection,
  findConnectionByStore,
  saveAuthorizedConnection,
  updateConnectionStatus,
  upsertPendingConnection,
  type ConnectionRecord,
} from "@/modules/integrations/salla/infrastructure/connection-repository";

/**
 * Salla store connection lifecycle.
 *
 * Everything tenant-scoped is derived from the authenticated session. The
 * callback trusts only the server-side OAuth state record, never query values
 * other than the opaque `state` and the one-time `code`.
 */

export interface ConnectionView {
  provider: "salla";
  status: ConnectionStatus;
  connected: boolean;
  needsReauthorization: boolean;
  externalStoreId: string | null;
  externalStoreName: string | null;
  scopes: string[];
  connectedAt: string | null;
  lastRefreshAt: string | null;
  accessTokenExpiresAt: string | null;
  lastErrorCode: string | null;
}

export function toConnectionView(connection: ConnectionRecord | undefined): ConnectionView {
  if (!connection) {
    return {
      provider: "salla",
      status: "disconnected",
      connected: false,
      needsReauthorization: false,
      externalStoreId: null,
      externalStoreName: null,
      scopes: [],
      connectedAt: null,
      lastRefreshAt: null,
      accessTokenExpiresAt: null,
      lastErrorCode: null,
    };
  }

  return {
    provider: "salla",
    status: connection.status,
    connected: connection.status === "connected",
    needsReauthorization: connection.status === "reauth_required",
    externalStoreId: connection.externalStoreId,
    externalStoreName: connection.externalStoreName,
    scopes: connection.scopes,
    connectedAt: connection.connectedAt?.toISOString() ?? null,
    lastRefreshAt: connection.lastRefreshAt?.toISOString() ?? null,
    accessTokenExpiresAt: connection.accessTokenExpiresAt?.toISOString() ?? null,
    lastErrorCode: connection.lastErrorCode,
  };
}

export async function getStoreConnection(
  db: Database,
  context: TenantContext,
  storeId: string,
): Promise<ConnectionView> {
  await requireStoreAccess(db, context, storeId);

  const connection = await withTenantTransaction(
    db,
    { userId: context.userId, organizationId: context.organizationId },
    (tx) => findConnectionByStore(tx, storeId),
  );

  return toConnectionView(connection);
}

export interface StartAuthorizationResult {
  authorizationUrl: string;
  expiresAt: Date;
}

export async function startSallaAuthorization(
  db: Database,
  context: TenantContext,
  storeId: string,
  meta: RequestMeta,
): Promise<StartAuthorizationResult> {
  assertPermission(context, "store:connect");
  const config = requireSallaConfig();

  // Resolves the store against the active organization; foreign ids are 404.
  const store = await requireStoreAccess(db, context, storeId);

  if (store.platform !== "salla") {
    throw new AppError({ code: "CONFLICT", message: "This store does not support Salla." });
  }

  const state = generateOAuthState();
  const stateHash = hashOAuthState(state, getAuthSecret());
  const now = new Date();
  const expiresAt = getStateExpiry(now);

  await withTenantTransaction(
    db,
    { userId: context.userId, organizationId: context.organizationId },
    async (tx) => {
      await invalidatePendingStates(tx, store.id, now);
      await upsertPendingConnection(tx, {
        organizationId: context.organizationId,
        storeId: store.id,
      });
      await insertOAuthState(tx, {
        stateHash,
        userId: context.userId,
        organizationId: context.organizationId,
        storeId: store.id,
        provider: "salla",
        expiresAt,
      });
      await recordAudit(tx, {
        organizationId: context.organizationId,
        actorUserId: context.userId,
        action: "salla.authorization.started",
        entityType: "store",
        entityId: store.id,
        metadata: { provider: "salla", oauthMode: config.mode },
        ipHash: meta.ipHash,
        userAgent: meta.userAgent,
        requestId: meta.requestId,
      });
    },
  );

  return {
    authorizationUrl: buildAuthorizationUrl(config, state, config.scopes),
    expiresAt,
  };
}

export type { CallbackFailureReason } from "@/modules/integrations/salla/domain/messages";

export type CallbackResult =
  | { ok: true; storeId: string; connection: ConnectionView }
  | { ok: false; storeId: string | null; reason: CallbackFailureReason };

interface StateContext {
  storeId: string;
  organizationId: string;
  userId: string;
}

/**
 * Validates and consumes an OAuth state.
 *
 * Returns a typed failure instead of throwing so the route can redirect with a
 * minimal, non-sensitive reason code.
 */
async function resolveAndConsumeState(
  db: Database,
  rawState: string,
  sessionUserId: string,
): Promise<
  | { ok: true; state: StateContext }
  | { ok: false; reason: CallbackFailureReason; storeId: string | null }
> {
  const stateHash = hashOAuthState(rawState, getAuthSecret());
  const now = new Date();

  const found = await withOAuthStateLookup(db, stateHash, async (tx) => {
    const record = await findStateByHash(tx, stateHash);
    if (!record) return { kind: "missing" as const };
    if (record.usedAt) return { kind: "replayed" as const, storeId: record.storeId };
    if (record.expiresAt.getTime() <= now.getTime()) {
      return { kind: "expired" as const, storeId: record.storeId };
    }
    if (record.provider !== "salla") return { kind: "missing" as const };
    if (record.userId !== sessionUserId) {
      return { kind: "wrong_user" as const, storeId: record.storeId };
    }

    // The state row is proven by its hash; binding its organization lets the
    // tenant-scoped policy authorize the single-use update without relaxing it.
    await bindOrganization(tx, record.organizationId);

    const consumed = await consumeState(tx, record.id, now);
    if (!consumed) return { kind: "replayed" as const, storeId: record.storeId };

    return {
      kind: "ok" as const,
      storeId: record.storeId,
      organizationId: record.organizationId,
      userId: record.userId,
    };
  });

  if (found.kind === "missing") return { ok: false, reason: "invalid_state", storeId: null };
  if (found.kind === "expired")
    return { ok: false, reason: "state_expired", storeId: found.storeId };
  if (found.kind === "replayed") {
    return { ok: false, reason: "state_replayed", storeId: found.storeId };
  }
  if (found.kind === "wrong_user") {
    return { ok: false, reason: "session_mismatch", storeId: found.storeId };
  }

  return {
    ok: true,
    state: {
      storeId: found.storeId,
      organizationId: found.organizationId,
      userId: found.userId,
    },
  };
}

async function failAndAudit(
  db: Database,
  state: StateContext,
  reason: CallbackFailureReason,
  meta: RequestMeta,
): Promise<CallbackResult> {
  await withTenantTransaction(
    db,
    { userId: state.userId, organizationId: state.organizationId },
    async (tx) => {
      const connection = await findConnectionByStore(tx, state.storeId);
      if (connection) {
        await updateConnectionStatus(tx, connection.id, "error", reason);
      }
      await recordAudit(tx, {
        organizationId: state.organizationId,
        actorUserId: state.userId,
        action: "salla.authorization.failed",
        entityType: "store",
        entityId: state.storeId,
        metadata: { reason },
        ipHash: meta.ipHash,
        userAgent: meta.userAgent,
        requestId: meta.requestId,
      });
    },
  );

  return { ok: false, storeId: state.storeId, reason };
}

export interface CompleteAuthorizationInput {
  rawState: string;
  code: string | null;
  providerError: string | null;
  sessionUserId: string;
  meta: RequestMeta;
}

export async function completeSallaAuthorization(
  db: Database,
  input: CompleteAuthorizationInput,
): Promise<CallbackResult> {
  const stateResult = await resolveAndConsumeState(db, input.rawState, input.sessionUserId);

  if (!stateResult.ok) {
    return { ok: false, storeId: stateResult.storeId, reason: stateResult.reason };
  }

  const state = stateResult.state;

  // Membership and role are re-checked at callback time: a user may have been
  // removed or demoted while the authorization screen was open.
  const membership = await loadMembershipForUser(db, state.userId, state.organizationId);
  if (!membership || membership.status !== "active") {
    return { ok: false, storeId: state.storeId, reason: "not_member" };
  }
  if (!hasPermission(membership.role, "store:connect")) {
    return { ok: false, storeId: state.storeId, reason: "forbidden" };
  }

  const store = await withTenantTransaction(
    db,
    { userId: state.userId, organizationId: state.organizationId },
    (tx) => findStoreById(tx, state.storeId),
  );

  if (!store || store.organizationId !== state.organizationId) {
    return { ok: false, storeId: null, reason: "invalid_state" };
  }

  if (input.providerError) {
    return failAndAudit(db, state, "access_denied", input.meta);
  }

  if (!input.code) {
    return failAndAudit(db, state, "missing_code", input.meta);
  }

  const config = readSallaConfig();
  if (!config || !config.supported) {
    return failAndAudit(db, state, "not_configured", input.meta);
  }

  let tokens;
  try {
    tokens = await exchangeAuthorizationCode(config, input.code);
  } catch {
    // The authorization code is never logged, stored, or returned.
    return failAndAudit(db, state, "exchange_failed", input.meta);
  }

  let identity;
  try {
    identity = await fetchMerchantIdentity(config, tokens.accessToken);
  } catch {
    return failAndAudit(db, state, "failed", input.meta);
  }

  const previous = await withTenantTransaction(
    db,
    { userId: state.userId, organizationId: state.organizationId },
    (tx) => findConnectionByStore(tx, state.storeId),
  );

  const aad = connectionAad({
    provider: "salla",
    organizationId: state.organizationId,
    storeId: state.storeId,
  });

  try {
    const saved = await withTenantTransaction(
      db,
      { userId: state.userId, organizationId: state.organizationId },
      async (tx) => {
        const pending = await upsertPendingConnection(tx, {
          organizationId: state.organizationId,
          storeId: state.storeId,
        });

        const row = await saveAuthorizedConnection(tx, pending.id, {
          externalStoreId: identity.externalStoreId,
          externalUserId: identity.externalUserId,
          externalStoreName: identity.externalStoreName,
          scopes: tokens.scopes.length > 0 ? tokens.scopes : [...SALLA_REQUIRED_SCOPES],
          accessTokenCiphertext: encryptSecret(tokens.accessToken, aad),
          refreshTokenCiphertext: tokens.refreshToken
            ? encryptSecret(tokens.refreshToken, aad)
            : null,
          accessTokenExpiresAt: tokens.accessTokenExpiresAt,
          refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
          connectedAt: new Date(),
        });

        if (!row) throw new Error("connection row missing");

        await updateStoreStatus(tx, state.storeId, "connected");

        const wasConnected = Boolean(previous?.connectedAt);

        await recordAudit(tx, {
          organizationId: state.organizationId,
          actorUserId: state.userId,
          action: "salla.authorization.succeeded",
          entityType: "store_connection",
          entityId: row.id,
          metadata: { provider: "salla", scopes: row.scopes },
          ipHash: input.meta.ipHash,
          userAgent: input.meta.userAgent,
          requestId: input.meta.requestId,
        });

        await recordAudit(tx, {
          organizationId: state.organizationId,
          actorUserId: state.userId,
          action: wasConnected ? "salla.connection.updated" : "salla.connection.created",
          entityType: "store_connection",
          entityId: row.id,
          metadata: { provider: "salla", reauthorized: wasConnected },
          ipHash: input.meta.ipHash,
          userAgent: input.meta.userAgent,
          requestId: input.meta.requestId,
        });

        return row;
      },
    );

    return { ok: true, storeId: state.storeId, connection: toConnectionView(saved) };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return failAndAudit(db, state, "already_linked", input.meta);
    }
    throw error;
  }
}

export async function disconnectSallaConnection(
  db: Database,
  context: TenantContext,
  storeId: string,
  meta: RequestMeta,
): Promise<ConnectionView> {
  assertPermission(context, "store:disconnect");
  await requireStoreAccess(db, context, storeId);

  return withTenantTransaction(
    db,
    { userId: context.userId, organizationId: context.organizationId },
    async (tx) => {
      const connection = await findConnectionByStore(tx, storeId);

      if (!connection) {
        throw new AppError({ code: "NOT_FOUND", message: "No Salla connection to disconnect." });
      }

      const disconnected = await disconnectConnection(tx, connection.id, new Date());
      if (!disconnected) {
        throw new AppError({ code: "NOT_FOUND", message: "No Salla connection to disconnect." });
      }

      await updateStoreStatus(tx, storeId, "not_connected");

      await recordAudit(tx, {
        organizationId: context.organizationId,
        actorUserId: context.userId,
        action: "salla.connection.disconnected",
        entityType: "store_connection",
        entityId: connection.id,
        metadata: { provider: "salla", scope: "local_only" },
        ipHash: meta.ipHash,
        userAgent: meta.userAgent,
        requestId: meta.requestId,
      });

      return toConnectionView({
        ...connection,
        status: "disconnected",
        accessTokenCiphertext: null,
        refreshTokenCiphertext: null,
        revokedAt: new Date(),
      });
    },
  );
}

function assertPermission(context: TenantContext, permission: Permission): void {
  if (!hasPermission(context.role, permission)) {
    throw new AppError({
      code: "FORBIDDEN",
      message: "You do not have permission to perform this action.",
      details: { permission },
    });
  }
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (typeof current === "object" && current !== null && "code" in current) {
      if ((current as { code?: unknown }).code === "23505") return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

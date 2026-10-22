import { getDb } from "@/db/client";
import { listAuditLogs } from "@/modules/audit/application/audit-service";
import { apiSuccess, withApi } from "@/server/api";
import { requirePermission } from "@/server/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = withApi(async (request) => {
  const context = await requirePermission(request, "audit:read");
  return apiSuccess({ entries: await listAuditLogs(getDb(), context) });
});

import { getDb } from "@/db/client";
import { createStore, listStores } from "@/modules/stores/application/store-service";
import { apiSuccess, withApi } from "@/server/api";
import { assertCsrf } from "@/server/csrf";
import { requestMeta } from "@/server/request-meta";
import { createStoreSchema } from "@/server/schemas";
import { requireOrganizationAccess } from "@/server/session";
import { parseJson } from "@/server/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = withApi(async (request) => {
  const context = await requireOrganizationAccess(request);
  return apiSuccess({ stores: await listStores(getDb(), context) });
});

export const POST = withApi(async (request) => {
  assertCsrf(request);
  const context = await requireOrganizationAccess(request);
  const input = await parseJson(request, createStoreSchema);

  const store = await createStore(getDb(), context, input, requestMeta(request));

  return apiSuccess({ store }, 201);
});

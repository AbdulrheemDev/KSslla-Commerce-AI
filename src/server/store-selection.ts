import { notFound } from "next/navigation";

import { getDb } from "@/db/client";
import type { TenantContext } from "@/modules/identity/application/types";
import { listStores, type StoreView } from "@/modules/stores/application/store-service";
import { requirePageTenant } from "@/server/pages";

/**
 * Store selection for the organization-level pages (`/app/orders`, …).
 *
 * The `store` query parameter is a *request*, never proof: it is matched
 * against the stores the session's organization can actually see, so a foreign
 * id is a 404 and never a cross-tenant read. With no parameter, a single-store
 * organization is unambiguous; a multi-store organization gets a picker that
 * links to the same page with `?store=<id>`.
 */
export interface CommerceStoreSelection {
  context: TenantContext;
  stores: StoreView[];
  store: StoreView | null;
}

export async function resolveCommerceStore(
  requestedStoreId: string | null | undefined,
): Promise<CommerceStoreSelection> {
  const { context } = await requirePageTenant();
  const stores = await listStores(getDb(), context);

  if (requestedStoreId) {
    const match = stores.find((store) => store.id === requestedStoreId) ?? null;
    if (!match) notFound();
    return { context, stores, store: match };
  }

  return { context, stores, store: stores.length === 1 ? stores[0]! : null };
}

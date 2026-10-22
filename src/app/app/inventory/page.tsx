import type { Metadata } from "next";
import Link from "next/link";

import { CommerceStoreHeader } from "@/components/app/commerce-store-header";
import { SimulatorNotice } from "@/components/app/simulator-notice";
import {
  formatCount,
  formatMoney,
  formatWallClock,
  Stat,
  StorePicker,
} from "@/components/app/commerce-widgets";
import { DataSyncControls } from "@/components/app/data-sync-controls";
import { getDb } from "@/db/client";
import { getStoreConnection } from "@/modules/integrations/salla/application/connection-service";
import {
  SALLA_CUSTOMER_SCOPES,
  SALLA_INVENTORY_SCOPES,
  SALLA_ORDER_SCOPES,
} from "@/modules/integrations/salla/domain/scopes";
import { listStoredInventory } from "@/modules/inventory/application/inventory-sync-service";
import { getStoreDataOverview } from "@/modules/sync/application/store-data-sync-service";
import { resolveCommerceStore } from "@/server/store-selection";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "المخزون" };

const PAGE_SIZE = 20;

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const requestedStore = typeof query.store === "string" ? query.store : null;
  const { context, stores, store } = await resolveCommerceStore(requestedStore);

  if (!store) {
    return (
      <StorePicker
        title="المخزون"
        description="لحسابك أكثر من متجر. اختر متجرًا لعرض مخزونه المحفوظ محليًا."
        stores={stores}
        href="/app/inventory"
      />
    );
  }

  const db = getDb();
  const requestedPage = Number(typeof query.page === "string" ? query.page : "1");
  const page = Number.isFinite(requestedPage) && requestedPage >= 1 ? Math.floor(requestedPage) : 1;
  const search = typeof query.q === "string" ? query.q : "";

  const [inventory, overview, connection] = await Promise.all([
    listStoredInventory(db, context, store.id, { page, pageSize: PAGE_SIZE, query: search }),
    getStoreDataOverview(db, context, store.id),
    getStoreConnection(db, context, store.id),
  ]);

  const canSync = context.permissions.includes("store:sync");
  const connected = connection.status === "connected";
  const requiredScopes = [
    ...new Set([...SALLA_ORDER_SCOPES, ...SALLA_CUSTOMER_SCOPES, ...SALLA_INVENTORY_SCOPES]),
  ];
  const missingScopes = requiredScopes.filter((scope) => !connection.scopes.includes(scope));
  const syncState = overview.sync.inventory;

  const pageHref = (target: number) => {
    const suffix = search ? `&q=${encodeURIComponent(search)}` : "";
    return `/app/inventory?store=${store.id}&page=${target}${suffix}`;
  };

  return (
    <div className="space-y-8">
      <CommerceStoreHeader
        title="المخزون"
        description="حالة المخزون الحالية كما وثّقها Salla في نقطة كميات المنتجات. تُحفظ آخر قيمة معروفة، ولا تُبنى توقعات."
        store={store}
        stores={stores}
        current="/app/inventory"
      />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="بنود المخزون" value={formatCount(overview.counts.inventory)} />
        <Stat label="إجمالي الكمية" value={formatCount(overview.inventory.totalQuantity)} />
        <Stat label="كمية غير محدودة" value={formatCount(overview.inventory.unlimited)} />
        <Stat label="آخر مزامنة" value={formatWallClock(overview.inventory.lastSyncedAt)} />
      </section>

      <SimulatorNotice />

      <DataSyncControls
        storeId={store.id}
        canSync={canSync}
        connected={connected}
        missingScopes={missingScopes}
      />

      <section className="rounded-2xl border border-line bg-surface/70">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <h2 className="text-sm font-semibold text-ink">كميات المنتجات</h2>
          <form action="/app/inventory" method="get" className="flex items-center gap-2">
            <input type="hidden" name="store" value={store.id} />
            <input
              type="search"
              name="q"
              defaultValue={search}
              placeholder="ابحث بالمنتج أو SKU"
              aria-label="بحث في المخزون"
              className="w-52 rounded-lg border border-line bg-canvas/40 px-3 py-1.5 text-[12px] text-ink placeholder:text-muted"
            />
            <button
              type="submit"
              className="rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-[12px] text-ink"
            >
              بحث
            </button>
          </form>
        </div>

        {inventory.items.length === 0 ? (
          <div className="px-5 py-8 text-[12.5px] leading-7 text-muted">
            {connected
              ? "لا توجد كميات محفوظة محليًا بعد. ابدأ مزامنة المخزون لجلبها من Salla."
              : "لا يوجد متجر Salla متصل. اربط المتجر أولًا لتتمكن من جلب المخزون."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-start text-[12.5px]">
              <thead className="text-[11px] text-muted">
                <tr className="border-b border-line/70">
                  <th scope="col" className="px-5 py-3 text-start font-medium">
                    المنتج
                  </th>
                  <th scope="col" className="px-3 py-3 text-start font-medium">
                    SKU
                  </th>
                  <th scope="col" className="px-3 py-3 text-start font-medium">
                    الكمية
                  </th>
                  <th scope="col" className="px-3 py-3 text-start font-medium">
                    المُباع
                  </th>
                  <th scope="col" className="px-3 py-3 text-start font-medium">
                    غير محدود
                  </th>
                  <th scope="col" className="px-3 py-3 text-start font-medium">
                    السعر
                  </th>
                  <th scope="col" className="px-5 py-3 text-start font-medium">
                    آخر مزامنة
                  </th>
                </tr>
              </thead>
              <tbody>
                {inventory.items.map((item) => (
                  <tr key={item.id} className="border-b border-line/40 last:border-0">
                    <td className="px-5 py-3 text-ink">
                      {item.productName}
                      {item.variant ? (
                        <span className="ms-2 text-[10.5px] text-muted">{item.variant}</span>
                      ) : null}
                      {item.productId === null ? (
                        <span className="ms-2 text-[10.5px] text-amber">غير مرتبط بمنتج محلي</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 text-muted">
                      <span className="ltr">{item.sku ?? "—"}</span>
                    </td>
                    <td className="px-3 py-3 text-ink">
                      <span className="ltr">{formatCount(item.quantity)}</span>
                    </td>
                    <td className="px-3 py-3 text-muted">
                      <span className="ltr">{formatCount(item.soldQuantity)}</span>
                    </td>
                    <td className="px-3 py-3 text-muted">
                      {item.unlimitedQuantity ? "نعم" : "لا"}
                    </td>
                    <td className="px-3 py-3 text-muted">
                      <span className="ltr">{formatMoney(item.priceAmount, null)}</span>
                    </td>
                    <td className="px-5 py-3 text-muted">
                      <span className="ltr">{formatWallClock(item.lastSyncedAt)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {inventory.totalPages > 1 ? (
          <nav
            aria-label="ترقيم الصفحات"
            className="flex items-center justify-between gap-3 border-t border-line px-5 py-3 text-[11.5px] text-muted"
          >
            <span>
              صفحة {formatCount(page)} من {formatCount(inventory.totalPages)}
            </span>
            <div className="flex items-center gap-2">
              {page > 1 ? (
                <Link
                  href={pageHref(page - 1)}
                  className="rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-ink"
                >
                  السابق
                </Link>
              ) : null}
              {page < inventory.totalPages ? (
                <Link
                  href={pageHref(page + 1)}
                  className="rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-ink"
                >
                  التالي
                </Link>
              ) : null}
            </div>
          </nav>
        ) : null}
      </section>

      <p className="rounded-2xl border border-line/70 bg-surface/40 px-4 py-3 text-[11.5px] leading-6 text-muted">
        جدول المخزون يعكس آخر قيمة معروفة لكل منتج/متغيّر، وليس سجلًا تاريخيًا. حالة المزامنة:{" "}
        {syncState.status === "never"
          ? "لم تتم المزامنة بعد."
          : syncState.status === "running"
            ? "جارٍ التنفيذ الآن."
            : syncState.status === "succeeded"
              ? `ناجحة — ${formatWallClock(syncState.lastSuccessAt)}.`
              : `فاشلة — آخر نسخة ناجحة ${formatWallClock(syncState.lastSuccessAt)}.`}
      </p>
    </div>
  );
}

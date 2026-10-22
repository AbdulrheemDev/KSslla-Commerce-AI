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
import { StatusPill } from "@/components/status-pill";
import { getDb } from "@/db/client";
import { getStoreConnection } from "@/modules/integrations/salla/application/connection-service";
import {
  SALLA_CUSTOMER_SCOPES,
  SALLA_INVENTORY_SCOPES,
  SALLA_ORDER_SCOPES,
} from "@/modules/integrations/salla/domain/scopes";
import { listStoredOrders } from "@/modules/orders/application/order-sync-service";
import { getStoreDataOverview } from "@/modules/sync/application/store-data-sync-service";
import { resolveCommerceStore } from "@/server/store-selection";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "الطلبات" };

const PAGE_SIZE = 20;

const STATUS_LABEL: Record<string, string> = {
  completed: "مكتمل",
  delivered: "تم التوصيل",
  in_progress: "قيد التنفيذ",
  pending: "بانتظار الدفع",
  canceled: "ملغي",
  refunded: "مُسترد",
};

export default async function OrdersPage({
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
        title="الطلبات"
        description="لحسابك أكثر من متجر. اختر متجرًا لعرض طلباته المحفوظة محليًا."
        stores={stores}
        href="/app/orders"
      />
    );
  }

  const db = getDb();
  const requestedPage = Number(typeof query.page === "string" ? query.page : "1");
  const page = Number.isFinite(requestedPage) && requestedPage >= 1 ? Math.floor(requestedPage) : 1;

  const [orders, overview, connection] = await Promise.all([
    listStoredOrders(db, context, store.id, { page, pageSize: PAGE_SIZE }),
    getStoreDataOverview(db, context, store.id),
    getStoreConnection(db, context, store.id),
  ]);

  const canSync = context.permissions.includes("store:sync");
  const connected = connection.status === "connected";
  const requiredScopes = [
    ...new Set([...SALLA_ORDER_SCOPES, ...SALLA_CUSTOMER_SCOPES, ...SALLA_INVENTORY_SCOPES]),
  ];
  const missingScopes = requiredScopes.filter((scope) => !connection.scopes.includes(scope));
  const syncState = overview.sync.orders;

  const totalPages = orders.totalPages;
  const pageHref = (target: number) => `/app/orders?store=${store.id}&page=${target}`;

  return (
    <div className="space-y-8">
      <CommerceStoreHeader
        title="الطلبات"
        description="نسخة محلية للقراءة فقط من طلبات المتجر. تُحدَّث بالمزامنة اليدوية، ولا يُعدَّل أي طلب في Salla."
        store={store}
        stores={stores}
        current="/app/orders"
      />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="إجمالي الطلبات" value={formatCount(orders.total)} />
        <Stat
          label="آخر طلب"
          value={overview.orders.lastOrderAt ? formatWallClock(overview.orders.lastOrderAt) : "—"}
        />
        <Stat label="مسودات" value={formatCount(overview.orders.drafts)} />
        <Stat label="بانتظار الدفع" value={formatCount(overview.orders.pendingPayment)} />
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
          <h2 className="text-sm font-semibold text-ink">أحدث الطلبات</h2>
          <div className="flex items-center gap-2">
            <StatusPill
              tone={
                syncState.status === "succeeded"
                  ? "teal"
                  : syncState.status === "failed"
                    ? "rose"
                    : syncState.status === "running"
                      ? "amber"
                      : "muted"
              }
            >
              {syncState.status === "never" ? "لم تتم المزامنة" : null}
              {syncState.status === "running" ? "جارٍ التنفيذ" : null}
              {syncState.status === "succeeded" ? "مزامنة ناجحة" : null}
              {syncState.status === "failed" ? "مزامنة فاشلة" : null}
            </StatusPill>
            {overview.counts.orderItems > 0 ? (
              <StatusPill tone="muted">
                {formatCount(overview.counts.orderItems)} سطر طلب
              </StatusPill>
            ) : null}
          </div>
        </div>

        {orders.items.length === 0 ? (
          <div className="px-5 py-8 text-[12.5px] leading-7 text-muted">
            {connected
              ? "لا توجد طلبات محفوظة محليًا بعد. ابدأ مزامنة الطلبات لجلبها من Salla."
              : "لا يوجد متجر Salla متصل. اربط المتجر أولًا لتتمكن من جلب الطلبات."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-start text-[12.5px]">
              <thead className="text-[11px] text-muted">
                <tr className="border-b border-line/70">
                  <th scope="col" className="px-5 py-3 text-start font-medium">
                    رقم الطلب
                  </th>
                  <th scope="col" className="px-3 py-3 text-start font-medium">
                    العميل
                  </th>
                  <th scope="col" className="px-3 py-3 text-start font-medium">
                    الحالة
                  </th>
                  <th scope="col" className="px-3 py-3 text-start font-medium">
                    الإجمالي
                  </th>
                  <th scope="col" className="px-3 py-3 text-start font-medium">
                    العملة
                  </th>
                  <th scope="col" className="px-5 py-3 text-start font-medium">
                    تاريخ الطلب
                  </th>
                </tr>
              </thead>
              <tbody>
                {orders.items.map((order) => (
                  <tr key={order.id} className="border-b border-line/40 last:border-0">
                    <td className="px-5 py-3">
                      <span className="ltr text-ink">#{order.externalOrderId}</span>
                      {order.draft ? (
                        <span className="ms-2 text-[10.5px] text-amber">مسودة</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 text-muted">{order.customerName ?? "—"}</td>
                    <td className="px-3 py-3">
                      {order.statusName ? (
                        <span className="rounded-lg border border-line bg-surface-2 px-2 py-0.5 text-[11px] text-ink">
                          {STATUS_LABEL[order.statusSlug ?? ""] ?? order.statusName}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <span className="ltr text-ink">
                        {formatMoney(order.totalAmount, order.currency)}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-muted">
                      <span className="ltr">{order.currency ?? "—"}</span>
                    </td>
                    <td className="px-5 py-3 text-muted">
                      <span className="ltr">{order.orderDate ?? "—"}</span>
                      {order.orderTimezone ? (
                        <span className="ms-2 text-[10.5px] text-muted">{order.orderTimezone}</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 ? (
          <nav
            aria-label="ترقيم الصفحات"
            className="flex items-center justify-between gap-3 border-t border-line px-5 py-3 text-[11.5px] text-muted"
          >
            <span>
              صفحة {formatCount(page)} من {formatCount(totalPages)}
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
              {page < totalPages ? (
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
        بنود الطلب تُحفظ كما توثّقها Salla في قائمة الطلبات (الاسم والكمية فقط). لا يتضمن هذا الردّ
        معرّف المنتج أو رمز SKU أو سعر السطر، لذا تظهر البنود بحالة «لا مرجع منتج» ولا تُربط بمنتجات
        محلية. الأرقام المعروضة من قاعدة البيانات المحلية فقط.
      </p>
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";

import { CommerceStoreHeader } from "@/components/app/commerce-store-header";
import { SimulatorNotice } from "@/components/app/simulator-notice";
import { formatCount, formatDate, Stat, StorePicker } from "@/components/app/commerce-widgets";
import { DataSyncControls } from "@/components/app/data-sync-controls";
import { getDb } from "@/db/client";
import { listStoredCustomers } from "@/modules/customers/application/customer-sync-service";
import { normalizeMobileForDisplay } from "@/modules/customers/domain/mappers";
import { getStoreConnection } from "@/modules/integrations/salla/application/connection-service";
import {
  SALLA_CUSTOMER_SCOPES,
  SALLA_INVENTORY_SCOPES,
  SALLA_ORDER_SCOPES,
} from "@/modules/integrations/salla/domain/scopes";
import { getStoreDataOverview } from "@/modules/sync/application/store-data-sync-service";
import { resolveCommerceStore } from "@/server/store-selection";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "العملاء" };

const PAGE_SIZE = 20;

export default async function CustomersPage({
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
        title="العملاء"
        description="لحسابك أكثر من متجر. اختر متجرًا لعرض عملائه المحفوظين محليًا."
        stores={stores}
        href="/app/customers"
      />
    );
  }

  const db = getDb();
  const requestedPage = Number(typeof query.page === "string" ? query.page : "1");
  const page = Number.isFinite(requestedPage) && requestedPage >= 1 ? Math.floor(requestedPage) : 1;
  const search = typeof query.q === "string" ? query.q : "";

  const [customers, overview, connection] = await Promise.all([
    listStoredCustomers(db, context, store.id, { page, pageSize: PAGE_SIZE, query: search }),
    getStoreDataOverview(db, context, store.id),
    getStoreConnection(db, context, store.id),
  ]);

  const canSync = context.permissions.includes("store:sync");
  const connected = connection.status === "connected";
  const requiredScopes = [
    ...new Set([...SALLA_ORDER_SCOPES, ...SALLA_CUSTOMER_SCOPES, ...SALLA_INVENTORY_SCOPES]),
  ];
  const missingScopes = requiredScopes.filter((scope) => !connection.scopes.includes(scope));
  const syncState = overview.sync.customers;

  const pageHref = (target: number) => {
    const suffix = search ? `&q=${encodeURIComponent(search)}` : "";
    return `/app/customers?store=${store.id}&page=${target}${suffix}`;
  };

  return (
    <div className="space-y-8">
      <CommerceStoreHeader
        title="العملاء"
        description="نسخة محلية للقراءة فقط من عملاء المتجر. لا تُحفظ كلمات مرور أو رموز دفع أو أي بيانات حساسة."
        store={store}
        stores={stores}
        current="/app/customers"
      />

      <section className="grid gap-3 sm:grid-cols-3">
        <Stat label="إجمالي العملاء" value={formatCount(customers.total)} />
        <Stat label="آخر مزامنة ناجحة" value={formatDate(syncState.lastSuccessAt)} />
        <Stat
          label="حالة المزامنة"
          value={
            syncState.status === "never"
              ? "لم تتم"
              : syncState.status === "running"
                ? "جارٍ التنفيذ"
                : syncState.status === "succeeded"
                  ? "ناجحة"
                  : "فاشلة"
          }
        />
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
          <h2 className="text-sm font-semibold text-ink">العملاء</h2>
          <form action="/app/customers" method="get" className="flex items-center gap-2">
            <input type="hidden" name="store" value={store.id} />
            <input
              type="search"
              name="q"
              defaultValue={search}
              placeholder="ابحث بالاسم أو البريد أو الجوال"
              aria-label="بحث في العملاء"
              className="w-56 rounded-lg border border-line bg-canvas/40 px-3 py-1.5 text-[12px] text-ink placeholder:text-muted"
            />
            <button
              type="submit"
              className="rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-[12px] text-ink"
            >
              بحث
            </button>
          </form>
        </div>

        {customers.items.length === 0 ? (
          <div className="px-5 py-8 text-[12.5px] leading-7 text-muted">
            {connected
              ? "لا يوجد عملاء محفوظون محليًا بعد. ابدأ مزامنة العملاء لجلبهم من Salla."
              : "لا يوجد متجر Salla متصل. اربط المتجر أولًا لتتمكن من جلب العملاء."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-start text-[12.5px]">
              <thead className="text-[11px] text-muted">
                <tr className="border-b border-line/70">
                  <th scope="col" className="px-5 py-3 text-start font-medium">
                    الاسم
                  </th>
                  <th scope="col" className="px-3 py-3 text-start font-medium">
                    البريد / الجوال
                  </th>
                  <th scope="col" className="px-3 py-3 text-start font-medium">
                    الدولة
                  </th>
                  <th scope="col" className="px-3 py-3 text-start font-medium">
                    المدينة
                  </th>
                  <th scope="col" className="px-3 py-3 text-start font-medium">
                    تاريخ الإنشاء في Salla
                  </th>
                  <th scope="col" className="px-5 py-3 text-start font-medium">
                    طلبات محفوظة
                  </th>
                </tr>
              </thead>
              <tbody>
                {customers.items.map((customer) => {
                  const phone = normalizeMobileForDisplay(customer.mobile, customer.mobileCode);
                  return (
                    <tr key={customer.id} className="border-b border-line/40 last:border-0">
                      <td className="px-5 py-3 text-ink">{customer.fullName ?? "—"}</td>
                      <td className="px-3 py-3 text-muted">
                        <span className="ltr block">{customer.email ?? "—"}</span>
                        <span className="ltr block text-[11px]">{phone ?? "—"}</span>
                      </td>
                      <td className="px-3 py-3 text-muted">
                        {customer.country ?? "—"}
                        {customer.countryCode ? (
                          <span className="ms-1 text-[10.5px] text-muted ltr">
                            ({customer.countryCode})
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 text-muted">{customer.city ?? "—"}</td>
                      <td className="px-3 py-3 text-muted">
                        {formatDate(customer.sourceCreatedAt)}
                      </td>
                      <td className="px-5 py-3 text-muted">
                        {customer.orderCount === null ? "—" : formatCount(customer.orderCount)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {customers.totalPages > 1 ? (
          <nav
            aria-label="ترقيم الصفحات"
            className="flex items-center justify-between gap-3 border-t border-line px-5 py-3 text-[11.5px] text-muted"
          >
            <span>
              صفحة {formatCount(page)} من {formatCount(customers.totalPages)}
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
              {page < customers.totalPages ? (
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
        عدد الطلبات يُحسب من الطلبات المحفوظة محليًا لذلك العميل فقط، وليس من Salla مباشرة. لا تتضمن
        قائمة عملاء Salla تاريخ الإنشاء، لذا يظهر «—» حتى يصبح معروفًا من مصدر موثّق.
      </p>
    </div>
  );
}

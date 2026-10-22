import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { StatusPill } from "@/components/status-pill";
import { getDb } from "@/db/client";
import { isAppError } from "@/lib/errors";
import { listStoredProducts } from "@/modules/catalog/application/catalog-service";
import { requireStoreAccess } from "@/modules/stores/application/store-service";
import { requirePageTenant } from "@/server/pages";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "المنتجات" };

const PAGE_SIZE = 20;

const STATUS_LABEL: Record<string, string> = {
  sale: "معروض",
  sold: "نفدت الكمية",
  out: "غير متوفر",
  hidden: "مخفي",
};

function formatPrice(amount: string | null, currency: string | null): string {
  if (amount === null) return "—";
  const value = Number(amount);
  const formatted = new Intl.NumberFormat("ar-SA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    numberingSystem: "latn",
  }).format(Number.isFinite(value) ? value : 0);

  return currency ? `${formatted} ${currency}` : formatted;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ar-SA", {
    dateStyle: "medium",
    timeStyle: "short",
    calendar: "gregory",
    numberingSystem: "latn",
  }).format(new Date(value));
}

export default async function ProductsPage({
  params,
  searchParams,
}: {
  params: Promise<{ storeId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { storeId } = await params;
  const query = await searchParams;
  const { context } = await requirePageTenant();
  const db = getDb();

  const store = await (async () => {
    try {
      return await requireStoreAccess(db, context, storeId);
    } catch (error) {
      if (isAppError(error) && error.httpStatus === 404) notFound();
      throw error;
    }
  })();

  const search = typeof query.q === "string" ? query.q : "";
  const requestedPage = Number(typeof query.page === "string" ? query.page : "1");
  const page = Number.isFinite(requestedPage) && requestedPage >= 1 ? Math.floor(requestedPage) : 1;

  const result = await listStoredProducts(db, context, storeId, {
    query: search,
    page,
    pageSize: PAGE_SIZE,
  });

  function pageHref(target: number): string {
    const suffix = search ? `&q=${encodeURIComponent(search)}` : "";
    return `/app/stores/${storeId}/products?page=${target}${suffix}`;
  }

  return (
    <div className="space-y-8">
      <nav aria-label="مسار التنقل" className="text-[11.5px] text-muted">
        <Link href="/app/stores" className="hover:text-ink">
          المتاجر
        </Link>
        <span aria-hidden="true" className="mx-2">
          /
        </span>
        <Link href={`/app/stores/${storeId}`} className="hover:text-ink">
          {store.name}
        </Link>
        <span aria-hidden="true" className="mx-2">
          /
        </span>
        <span className="text-ink">المنتجات</span>
      </nav>

      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">المنتجات</h1>
          <p className="mt-2 text-[13px] leading-7 text-muted">
            نسخة محلية للقراءة فقط. تُحدَّث عند تشغيل المزامنة، ولا تُعدَّل في Salla من هنا.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill tone="muted">
            {new Intl.NumberFormat("ar-SA", { numberingSystem: "latn" }).format(result.total)}{" "}
            منتجًا
          </StatusPill>
          <Link
            href={`/app/stores/${storeId}`}
            className="rounded-xl border border-line bg-surface-2 px-3 py-2 text-[12px] text-ink hover:border-line-strong"
          >
            العودة للمتجر
          </Link>
        </div>
      </section>

      <form action={`/app/stores/${storeId}/products`} className="flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="product-search">
          بحث بالاسم أو رمز المنتج أو المعرّف
        </label>
        <input
          id="product-search"
          name="q"
          defaultValue={search}
          placeholder="ابحث بالاسم أو SKU أو معرّف Salla"
          className="min-w-[240px] flex-1 rounded-xl border border-line bg-canvas/60 px-3 py-2 text-[12.5px] text-ink placeholder:text-muted focus:border-gold/50 focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-xl bg-gold px-4 py-2 text-[12.5px] font-semibold text-canvas hover:bg-gold-soft"
        >
          بحث
        </button>
        {search ? (
          <Link
            href={`/app/stores/${storeId}/products`}
            className="rounded-xl border border-line bg-surface-2 px-4 py-2 text-[12.5px] text-muted hover:text-ink"
          >
            إلغاء
          </Link>
        ) : null}
      </form>

      <section className="overflow-hidden rounded-2xl border border-line bg-surface/60">
        {result.items.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-[13px] font-medium text-ink">
              {search ? "لا توجد نتائج مطابقة." : "لا توجد منتجات مخزّنة بعد."}
            </p>
            <p className="mt-2 text-[12px] leading-6 text-muted">
              {search
                ? "جرّب اسمًا أو رمزًا آخر، أو امسح البحث لعرض كل المنتجات."
                : "شغّل «مزامنة الآن» من صفحة المتجر لجلب المنتجات والتصنيفات."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-right text-[12px]">
              <thead className="bg-surface-2 text-[11px] text-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">المنتج</th>
                  <th className="px-4 py-3 font-medium">SKU</th>
                  <th className="px-4 py-3 font-medium">الحالة</th>
                  <th className="px-4 py-3 font-medium">السعر</th>
                  <th className="px-4 py-3 font-medium">التصنيف</th>
                  <th className="px-4 py-3 font-medium">آخر تحديث</th>
                  <th className="px-4 py-3 font-medium">معرّف Salla</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((product) => (
                  <tr key={product.id} className="border-t border-line/60 hover:bg-surface-2/40">
                    <td className="px-4 py-3">
                      <Link
                        href={`/app/stores/${storeId}/products/${product.id}`}
                        className="font-medium text-ink hover:text-gold-soft"
                      >
                        {product.name}
                      </Link>
                    </td>
                    <td className="ltr px-4 py-3 text-muted">{product.sku ?? "—"}</td>
                    <td className="px-4 py-3">
                      <StatusPill tone={product.status === "sale" ? "teal" : "muted"}>
                        {STATUS_LABEL[product.status] ?? product.status}
                      </StatusPill>
                    </td>
                    <td className="ltr px-4 py-3 text-ink">
                      {formatPrice(product.priceAmount, product.currency)}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {product.categories.length > 0
                        ? product.categories.map((category) => category.name).join("، ")
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-muted">{formatDate(product.updatedAt)}</td>
                    <td className="ltr px-4 py-3 text-muted">{product.externalProductId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {result.totalPages > 1 ? (
        <nav aria-label="ترقيم الصفحات" className="flex items-center justify-between text-[12px]">
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className="text-muted hover:text-ink">
              السابق
            </Link>
          ) : (
            <span className="text-muted/50">السابق</span>
          )}
          <span className="text-muted">
            صفحة <span className="ltr">{page}</span> من{" "}
            <span className="ltr">{result.totalPages}</span>
          </span>
          {page < result.totalPages ? (
            <Link href={pageHref(page + 1)} className="text-muted hover:text-ink">
              التالي
            </Link>
          ) : (
            <span className="text-muted/50">التالي</span>
          )}
        </nav>
      ) : null}
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { StatusPill } from "@/components/status-pill";
import { getDb } from "@/db/client";
import { isAppError } from "@/lib/errors";
import { listStoredCategories } from "@/modules/catalog/application/catalog-service";
import { requireStoreAccess } from "@/modules/stores/application/store-service";
import { requirePageTenant } from "@/server/pages";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "التصنيفات" };

const PAGE_SIZE = 50;

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ar-SA", {
    dateStyle: "medium",
    timeStyle: "short",
    calendar: "gregory",
    numberingSystem: "latn",
  }).format(new Date(value));
}

export default async function CategoriesPage({
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

  const requestedPage = Number(typeof query.page === "string" ? query.page : "1");
  const page = Number.isFinite(requestedPage) && requestedPage >= 1 ? Math.floor(requestedPage) : 1;

  const result = await listStoredCategories(db, context, storeId, {
    page,
    pageSize: PAGE_SIZE,
  });

  function pageHref(target: number): string {
    return `/app/stores/${storeId}/categories?page=${target}`;
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
        <span className="text-ink">التصنيفات</span>
      </nav>

      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">التصنيفات</h1>
          <p className="mt-2 text-[13px] leading-7 text-muted">
            شجرة التصنيفات كما تعيدها Salla. عدد المنتجات محسوب من العلاقات المخزّنة فعليًا، ولا
            يُخترع حقل slug لأن Salla لا توثّقه في مسار التصنيفات.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill tone="muted">
            {new Intl.NumberFormat("ar-SA", { numberingSystem: "latn" }).format(result.total)}{" "}
            تصنيفًا
          </StatusPill>
          <Link
            href={`/app/stores/${storeId}`}
            className="rounded-xl border border-line bg-surface-2 px-3 py-2 text-[12px] text-ink hover:border-line-strong"
          >
            العودة للمتجر
          </Link>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-line bg-surface/60">
        {result.items.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-[13px] font-medium text-ink">لا توجد تصنيفات مخزّنة بعد.</p>
            <p className="mt-2 text-[12px] leading-6 text-muted">
              شغّل «مزامنة الآن» من صفحة المتجر لجلب التصنيفات والمنتجات.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-right text-[12px]">
              <thead className="bg-surface-2 text-[11px] text-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">التصنيف</th>
                  <th className="px-4 py-3 font-medium">التصنيف الأب</th>
                  <th className="px-4 py-3 font-medium">الحالة</th>
                  <th className="px-4 py-3 font-medium">عدد المنتجات</th>
                  <th className="px-4 py-3 font-medium">آخر تحديث</th>
                  <th className="px-4 py-3 font-medium">معرّف Salla</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((category) => (
                  <tr key={category.id} className="border-t border-line/60 hover:bg-surface-2/40">
                    <td className="px-4 py-3 font-medium text-ink">{category.name}</td>
                    <td className="px-4 py-3 text-muted">
                      {category.parentExternalId === null ? (
                        <span className="text-muted/70">تصنيف رئيسي</span>
                      ) : (
                        (category.parentName ?? (
                          <span className="ltr">#{category.parentExternalId}</span>
                        ))
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill tone={category.status === "active" ? "teal" : "muted"}>
                        {category.status === "active" ? "نشط" : category.status}
                      </StatusPill>
                    </td>
                    <td className="ltr px-4 py-3 text-ink">{category.productCount}</td>
                    <td className="px-4 py-3 text-muted">{formatDate(category.updatedAt)}</td>
                    <td className="ltr px-4 py-3 text-muted">{category.externalCategoryId}</td>
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

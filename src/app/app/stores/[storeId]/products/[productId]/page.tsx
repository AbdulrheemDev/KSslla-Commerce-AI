import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { StatusPill } from "@/components/status-pill";
import { getDb } from "@/db/client";
import { isAppError } from "@/lib/errors";
import { getStoredProduct } from "@/modules/catalog/application/catalog-service";
import { requirePageTenant } from "@/server/pages";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "تفاصيل المنتج" };

const STATUS_LABEL: Record<string, string> = {
  sale: "معروض",
  sold: "نفدت الكمية",
  out: "غير متوفر",
  hidden: "مخفي",
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ar-SA", {
    dateStyle: "medium",
    timeStyle: "short",
    calendar: "gregory",
    numberingSystem: "latn",
  }).format(new Date(value));
}

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ storeId: string; productId: string }>;
}) {
  const { storeId, productId } = await params;
  const { context } = await requirePageTenant();

  const product = await (async () => {
    try {
      return await getStoredProduct(getDb(), context, storeId, productId);
    } catch (error) {
      if (isAppError(error) && error.httpStatus === 404) notFound();
      throw error;
    }
  })();

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
          المتجر
        </Link>
        <span aria-hidden="true" className="mx-2">
          /
        </span>
        <Link href={`/app/stores/${storeId}/products`} className="hover:text-ink">
          المنتجات
        </Link>
        <span aria-hidden="true" className="mx-2">
          /
        </span>
        <span className="text-ink">تفاصيل</span>
      </nav>

      <section className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          {product.imageUrl ? (
            // Provider-hosted image, rendered as a plain <img> to avoid remote-domain config.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={product.imageUrl}
              alt=""
              className="h-20 w-20 rounded-xl border border-line object-cover"
            />
          ) : null}
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink">{product.name}</h1>
            <p className="ltr mt-1 text-[12px] text-muted">{product.externalProductId}</p>
          </div>
        </div>
        <StatusPill tone={product.status === "sale" ? "teal" : "muted"}>
          {STATUS_LABEL[product.status] ?? product.status}
        </StatusPill>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-line bg-surface/70 p-5">
          <p className="text-[11px] text-muted">السعر</p>
          <p className="ltr mt-2 text-lg font-semibold text-ink">
            {product.priceAmount
              ? `${Number(product.priceAmount).toFixed(2)} ${product.currency ?? ""}`.trim()
              : "—"}
          </p>
        </div>
        <div className="rounded-2xl border border-line bg-surface/70 p-5">
          <p className="text-[11px] text-muted">متاح للبيع</p>
          <p className="mt-2 text-sm font-semibold text-ink">
            {product.isAvailable ? "نعم" : "لا"}
          </p>
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-surface/70 p-5">
        <h2 className="text-sm font-semibold text-ink">بيانات المتجر</h2>
        <dl className="mt-4 grid gap-3 text-[12px] sm:grid-cols-2">
          <div>
            <dt className="text-[11px] text-muted">SKU</dt>
            <dd className="ltr mt-1 text-ink">{product.sku ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted">النوع</dt>
            <dd className="ltr mt-1 text-ink">{product.productType ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted">التصنيفات</dt>
            <dd className="mt-1 text-ink">
              {product.categories.length > 0
                ? product.categories.map((category) => category.name).join("، ")
                : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted">آخر تحديث محلي</dt>
            <dd className="mt-1 text-ink">{formatDate(product.updatedAt)}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted">آخر ظهور في Salla</dt>
            <dd className="mt-1 text-ink">{formatDate(product.lastSeenAt)}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted">معرّف المنتج في Salla</dt>
            <dd className="ltr mt-1 break-all text-ink">{product.externalProductId}</dd>
          </div>
        </dl>

        {product.description ? (
          <div className="mt-5 border-t border-line/60 pt-4">
            <p className="text-[11px] text-muted">الوصف</p>
            <p className="mt-2 whitespace-pre-line text-[12.5px] leading-7 text-ink">
              {product.description}
            </p>
          </div>
        ) : null}

        {product.url ? (
          <p className="mt-4 text-[12px]">
            <a
              href={product.url}
              target="_blank"
              rel="noreferrer noopener"
              className="text-gold-soft underline underline-offset-4"
            >
              صفحة المنتج في Salla
            </a>
          </p>
        ) : null}
      </section>

      <p className="text-[11px] leading-6 text-muted">
        هذه البيانات نسخة محلية من آخر مزامنة. لا يمكن تعديل المنتج أو حذفه من هنا، ولا يُرسل أي
        تغيير إلى Salla.
      </p>
    </div>
  );
}

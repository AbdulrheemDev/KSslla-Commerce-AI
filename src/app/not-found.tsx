import Link from "next/link";

import { BrandMark } from "@/components/brand-mark";
import { PRODUCT } from "@/config/product";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center px-6 text-center">
      <BrandMark />
      <p className="ltr mt-6 text-xs font-semibold tracking-[0.3em] text-gold">404</p>
      <h1 className="mt-3 text-2xl font-semibold">الصفحة غير موجودة</h1>
      <p className="mt-3 text-sm leading-7 text-muted">
        هذا المسار غير متاح في {PRODUCT.nameAr}. المرحلة الحالية تعرض حالة المشروع فقط.
      </p>
      <Link
        href="/"
        className="mt-6 rounded-full border border-line-strong bg-surface px-5 py-2.5 text-sm text-ink transition-colors hover:border-gold/40 hover:text-gold-soft"
      >
        العودة إلى الصفحة الرئيسية
      </Link>
    </main>
  );
}

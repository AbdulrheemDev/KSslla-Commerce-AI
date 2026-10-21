import Link from "next/link";
import type { ReactNode } from "react";

import { BrandMark } from "@/components/brand-mark";
import { PRODUCT } from "@/config/product";

/**
 * Shared frame for the authentication screens. Arabic-first, RTL, and explicit
 * that no store is connected yet.
 */
export function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden">
      <div
        aria-hidden="true"
        className="backdrop-grid pointer-events-none absolute inset-x-0 top-0 h-[420px]"
      />

      <header className="relative mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-6 py-6">
        <Link href="/" className="flex items-center gap-3">
          <BrandMark />
          <span>
            <span className="block text-sm font-semibold text-ink">{PRODUCT.nameAr}</span>
            <span className="block text-[11px] text-muted">{PRODUCT.taglineAr}</span>
          </span>
        </Link>
        <Link href="/" className="text-[12px] text-muted transition-colors hover:text-ink">
          العودة إلى الرئيسية
        </Link>
      </header>

      <main className="relative mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 pb-16">
        <div className="rounded-3xl border border-line bg-surface/85 p-6 shadow-[0_40px_120px_-80px_rgba(216,180,106,0.75)] backdrop-blur sm:p-8">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
          <p className="mt-2 text-[13px] leading-7 text-muted">{description}</p>
          <div className="mt-6">{children}</div>
        </div>

        <p className="mt-4 rounded-xl border border-line/70 bg-canvas/40 px-4 py-3 text-[11.5px] leading-6 text-muted">
          لا يوجد اتصال بـ <span className="ltr">Salla</span> في هذه المرحلة، ولن تُطلب بيانات متجر.
          الحساب والمؤسسة فقط.
        </p>

        {footer ? <div className="mt-4 text-center text-[12px] text-muted">{footer}</div> : null}
      </main>
    </div>
  );
}

import Link from "next/link";

import { StatusPill } from "@/components/status-pill";
import type { StoreView } from "@/modules/stores/application/store-service";

/**
 * Shared header for `/app/orders`, `/app/customers`, `/app/inventory`,
 * `/app/webhooks`.
 *
 * The store switcher lists only stores the session's organization can see, and
 * each link carries the id in the query so the page can re-verify it.
 */

const SECTIONS = [
  { href: "/app/orders", label: "الطلبات" },
  { href: "/app/customers", label: "العملاء" },
  { href: "/app/inventory", label: "المخزون" },
  { href: "/app/webhooks", label: "الويبهوك" },
] as const;

export function CommerceStoreHeader({
  title,
  description,
  store,
  stores,
  current,
}: {
  title: string;
  description: string;
  store: StoreView;
  stores: StoreView[];
  current: (typeof SECTIONS)[number]["href"];
}) {
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
          <p className="mt-2 max-w-2xl text-[13px] leading-7 text-muted">{description}</p>
        </div>

        <nav aria-label="أقسام بيانات المتجر" className="flex flex-wrap items-center gap-1">
          {SECTIONS.map((section) => {
            const href = `${section.href}?store=${store.id}`;
            const active = section.href === current;
            return (
              <Link
                key={section.href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={
                  active
                    ? "rounded-lg bg-surface-2 px-3 py-1.5 text-[12px] font-semibold text-ink"
                    : "rounded-lg px-3 py-1.5 text-[12px] text-muted transition-colors hover:bg-surface-2 hover:text-ink"
                }
              >
                {section.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface/50 px-4 py-3">
        <span className="text-[11px] text-muted">المتجر</span>
        <StatusPill tone="teal">{store.name}</StatusPill>

        {stores.length > 1 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-muted">تبديل:</span>
            {stores
              .filter((item) => item.id !== store.id)
              .map((item) => (
                <Link
                  key={item.id}
                  href={`${current}?store=${item.id}`}
                  className="rounded-lg border border-line bg-canvas/40 px-2.5 py-1 text-[11.5px] text-ink hover:border-line-strong"
                >
                  {item.name}
                </Link>
              ))}
          </div>
        ) : null}

        <Link
          href={`/app/stores/${store.id}`}
          className="ms-auto text-[11.5px] text-muted underline underline-offset-4 hover:text-ink"
        >
          إعدادات المتجر
        </Link>
      </div>
    </section>
  );
}

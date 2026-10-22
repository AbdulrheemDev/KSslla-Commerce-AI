import Link from "next/link";

/** Small shared pieces for the orders / customers / inventory pages. */

export function formatCount(value: number): string {
  return new Intl.NumberFormat("ar-SA", { numberingSystem: "latn" }).format(value);
}

export function formatMoney(amount: string | null, currency: string | null): string {
  if (amount === null) return "—";
  const value = Number(amount);
  const formatted = new Intl.NumberFormat("ar-SA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    numberingSystem: "latn",
  }).format(Number.isFinite(value) ? value : 0);

  return currency ? `${formatted} ${currency}` : formatted;
}

/** Renders a stored wall-clock value (`YYYY-MM-DD HH:mm`) verbatim. */
export function formatWallClock(value: string | null): string {
  if (!value) return "—";
  return value.replace("T", " ").slice(0, 16);
}

export function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ar-SA", {
    dateStyle: "medium",
    calendar: "gregory",
    numberingSystem: "latn",
  }).format(new Date(value));
}

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface/60 px-4 py-3">
      <p className="text-[11px] text-muted">{label}</p>
      <p className="ltr mt-1 text-lg font-semibold text-ink">{value}</p>
    </div>
  );
}

export function StorePicker({
  title,
  description,
  stores,
  href,
}: {
  title: string;
  description: string;
  stores: Array<{ id: string; name: string }>;
  href: string;
}) {
  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        <p className="mt-2 text-[13px] leading-7 text-muted">{description}</p>
      </section>

      {stores.length === 0 ? (
        <p className="rounded-2xl border border-line bg-surface/60 px-4 py-6 text-[12.5px] leading-7 text-muted">
          لا توجد متاجر داخلية بعد.{" "}
          <Link href="/app/stores" className="text-gold underline underline-offset-4">
            أضف متجرًا
          </Link>{" "}
          ثم اربطه بـ Salla.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {stores.map((store) => (
            <li key={store.id}>
              <Link
                href={`${href}?store=${store.id}`}
                className="block rounded-2xl border border-line bg-surface/60 px-4 py-4 text-[13px] text-ink hover:border-line-strong"
              >
                {store.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

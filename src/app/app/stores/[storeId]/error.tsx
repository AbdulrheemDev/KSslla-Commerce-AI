"use client";

/**
 * Store-scoped error boundary.
 *
 * The server never sends error details to the browser, so this boundary shows a
 * neutral message and offers a retry. The correlation id stays in server logs.
 */
export default function StoreError({ reset }: { error: Error; reset: () => void }) {
  return (
    <section className="rounded-2xl border border-rose/25 bg-rose/10 px-5 py-8 text-center">
      <h2 className="text-sm font-semibold text-ink">تعذّر عرض بيانات المتجر حاليًا.</h2>
      <p className="mx-auto mt-2 max-w-md text-[12px] leading-6 text-muted">
        لم تُفقد البيانات المخزّنة. أعد المحاولة، وإن استمر الخطأ فراجع حالة الاتصال بالمتجر.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-4 rounded-xl bg-gold px-4 py-2 text-[12.5px] font-semibold text-canvas hover:bg-gold-soft"
      >
        إعادة المحاولة
      </button>
    </section>
  );
}

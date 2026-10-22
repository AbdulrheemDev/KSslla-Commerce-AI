export default function ProductsLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <div className="h-8 w-40 animate-pulse rounded-lg bg-surface-2" />
      <div className="h-10 w-full animate-pulse rounded-xl bg-surface-2" />
      <div className="h-72 w-full animate-pulse rounded-2xl bg-surface-2" />
      <span className="sr-only">جارٍ تحميل المنتجات…</span>
    </div>
  );
}

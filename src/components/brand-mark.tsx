export function BrandMark({ size = "md" }: { size?: "md" | "sm" }) {
  const dimensions =
    size === "sm" ? "h-9 w-9 rounded-xl text-base" : "h-11 w-11 rounded-2xl text-lg";

  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center bg-gradient-to-br from-gold-soft via-gold to-[#a97f38] font-bold text-canvas shadow-[0_8px_30px_-12px_rgba(216,180,106,0.7)] ${dimensions}`}
    >
      ك
    </span>
  );
}

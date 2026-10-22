import type { ReactNode } from "react";

export type PillTone = "gold" | "teal" | "muted" | "rose" | "amber";

const TONE_CLASSES: Record<PillTone, string> = {
  gold: "border-gold/25 bg-gold/10 text-gold-soft",
  teal: "border-teal/25 bg-teal/10 text-teal",
  muted: "border-line bg-surface-2 text-muted",
  rose: "border-rose/25 bg-rose/10 text-rose",
  amber: "border-amber-400/25 bg-amber-400/10 text-amber-200",
};

export function StatusPill({
  children,
  tone = "muted",
  className = "",
}: {
  children: ReactNode;
  tone?: PillTone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium leading-5 ${TONE_CLASSES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

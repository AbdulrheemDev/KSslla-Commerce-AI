import type { OperationLevel, PlannedModule } from "@/config/product";

import { StatusPill, type PillTone } from "@/components/status-pill";

const OPERATION_LABELS: Record<OperationLevel, { label: string; tone: PillTone }> = {
  read: { label: "قراءة فقط", tone: "muted" },
  recommend: { label: "اقتراح فقط", tone: "teal" },
  "low-risk-write": { label: "كتابة منخفضة المخاطر", tone: "amber" },
  "high-risk-write": { label: "كتابة عالية المخاطر", tone: "rose" },
};

export function ModuleCard({ module }: { module: PlannedModule }) {
  const operation = OPERATION_LABELS[module.operationLevel];

  return (
    <article className="group flex h-full flex-col rounded-2xl border border-line bg-surface/70 p-5 transition-colors duration-200 hover:border-line-strong hover:bg-surface">
      <div className="mb-4 flex items-center justify-between gap-3">
        <span className="text-[11px] text-muted">{module.areaAr}</span>
        <span className="ltr text-[10px] font-medium tracking-wide text-gold/80">
          {module.phaseLabel}
        </span>
      </div>

      <h3 className="text-base font-semibold leading-7 text-ink">{module.nameAr}</h3>
      <p className="ltr mt-0.5 w-fit text-[11px] text-muted/70">{module.nameEn}</p>
      <p className="mt-3 flex-1 text-[13px] leading-6 text-muted">{module.summaryAr}</p>

      <div className="mt-5 border-t border-line pt-4">
        <StatusPill tone={operation.tone}>{operation.label}</StatusPill>
      </div>
    </article>
  );
}

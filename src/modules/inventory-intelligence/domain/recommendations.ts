import type { Severity } from "@/modules/intelligence/domain/opportunities";

import type { InventoryIssueId } from "./issues";
import type { InventoryIssueSummary, InventoryRecommendation } from "./types";

/**
 * Rule-based inventory recommendations.
 *
 * One recommendation per issue that actually fired, and none otherwise. Each
 * carries the rule, the affected count, the affected share, and up to three
 * product names, so a merchant can open the products and verify the claim before
 * doing anything.
 *
 * The copy states only what the data supports. There is no "order N units", no
 * "will sell out in N days", and no "this is dead stock": those need a demand
 * rate (`demand.ts`), and a sentence is not allowed to imply a model that is not
 * running. `advisoryOnly` is the literal `true` — no write endpoint, no Salla
 * client, no action engine in this module.
 */

interface Copy {
  readonly title: string;
  readonly rationale: string;
}

const COPY: Record<InventoryIssueId, Copy> = {
  missing_inventory_record: {
    title: "استكمال بيانات مخزون المنتجات غير المعروفة",
    rationale:
      "منتجات موجودة في الكتالوج بلا سجل مخزون محفوظ. سبب ذلك عادةً أن مزامنة المخزون لم تشملها أو لم تكتمل؛ لا تُعدّ نافدة لأننا لا نعرف كميتها.",
  },
  inventory_entry_unlinked: {
    title: "مراجعة سجلات المخزون غير المرتبطة بمنتج",
    rationale:
      "سجلات مخزون تشير إلى منتجات غير موجودة في الكتالوج المحلي. تُترك كما وصلت ولا تُحذف؛ إعادة مزامنة الكتالوج ثم المخزون تربطها.",
  },
  out_of_stock: {
    title: "مراجعة المنتجات النافدة",
    rationale: "الكمية الحالية صفر أو أقل والمنتج ليس بكمية غير محدودة، فلا يمكن بيعه الآن.",
  },
  low_stock: {
    title: "مراجعة المنتجات منخفضة المخزون",
    rationale:
      "الكمية الحالية عند الحد المطلق المعلن أو دونه. هذا تنبيه كمية، وليس توقعًا لموعد النفاد: لا يوجد معدل طلب موثّق لكل منتج.",
  },
  negative_quantity: {
    title: "تصحيح الكميات السالبة",
    rationale:
      "كمية سالبة محفوظة لا تمثّل مخزونًا صالحًا، وقد تكون نتيجة بيع أكثر من المتاح أو تسوية في المتجر. تحتاج مراجعة يدوية.",
  },
};

const PRIORITY: Record<Severity, InventoryRecommendation["priority"]> = {
  high: "P1",
  medium: "P2",
  low: "P3",
};

export function buildRecommendations(
  issues: readonly InventoryIssueSummary[],
  productsTotal: number,
): InventoryRecommendation[] {
  return issues.map((issue) => {
    const copy = COPY[issue.id as InventoryIssueId];

    return {
      id: `rec.inventory.${issue.id}`,
      issueId: issue.id,
      title: copy.title,
      rationale: `${copy.rationale} ينطبق على ${issue.affectedCount} من ${productsTotal} منتجًا (${issue.affectedPercent}%).`,
      priority: PRIORITY[issue.severity],
      severity: issue.severity,
      rule: `${issue.id}_count > 0`,
      affectedCount: issue.affectedCount,
      affectedPercent: issue.affectedPercent,
      evidence: issue.evidence,
      advisoryOnly: true,
    };
  });
}

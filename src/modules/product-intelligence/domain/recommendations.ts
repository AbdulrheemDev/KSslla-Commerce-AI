import type { Severity } from "@/modules/intelligence/domain/opportunities";

import type { IssueId } from "./issues";
import type { IssueSummary } from "./types";
import type { Recommendation } from "./types";

/**
 * Rule-based recommendations.
 *
 * One recommendation per issue that actually fired, and none otherwise: if the
 * count is zero the rule is silent, not "all good" and not a generic tip. Every
 * card carries the rule, the affected count, the affected share, and up to
 * three product names — the same evidence the issue row shows, so a merchant
 * can verify the claim before acting.
 *
 * `advisoryOnly` is the literal `true`. This module produces text and evidence
 * only: no write endpoint, no Salla client, no mutation, and no model.
 */

interface Copy {
  readonly title: string;
  readonly rationale: string;
}

const COPY: Record<IssueId, Copy> = {
  missing_name: {
    title: "إضافة اسم لكل منتج بلا اسم",
    rationale: "الاسم هو ما يظهر في القوائم والبحث؛ منتج بلا اسم لا يمكن التعرف عليه.",
  },
  short_name: {
    title: "توضيح أسماء المنتجات القصيرة",
    rationale: "الاسم القصير لا يشرح المنتج ولا يميّزه عن منتج مشابه في نتائج البحث.",
  },
  missing_description: {
    title: "كتابة وصف للمنتجات الناقصة",
    rationale: "الوصف هو ما يجيب عن سؤال المشتري الأول: ما هذا المنتج وما يشمله.",
  },
  short_description: {
    title: "توسيع أوصاف المنتجات القصيرة",
    rationale: "الوصف الحالي أقصر من الحد المعلن، ولا يغطي تفاصيل المنتج الأساسية.",
  },
  missing_metadata_title: {
    title: "إضافة عنوان metadata للمنتجات",
    rationale: "حقل metadata.title موثّق في استجابة Salla، وغيابه يعني بيانات وصفية ناقصة.",
  },
  missing_metadata_description: {
    title: "إضافة وصف metadata للمنتجات",
    rationale: "حقل metadata.description موثّق في استجابة Salla، وغيابه يعني بيانات وصفية ناقصة.",
  },
  missing_image: {
    title: "إضافة صورة رئيسية للمنتجات بلا صورة",
    rationale: "المنتج بلا صورة محفوظة لا يظهر بشكل مفهوم في القوائم.",
  },
  invalid_image_url: {
    title: "تصحيح روابط الصور غير الصالحة",
    rationale: "الرابط المحفوظ لا يُحلَّل كرابط http(s)، وقد لا تُعرض الصورة للزائر.",
  },
  missing_sku: {
    title: "إضافة رمز SKU للمنتجات",
    rationale: "SKU هو المعرّف التشغيلي للمنتج في المخزون والطلبات.",
  },
  missing_url: {
    title: "إضافة رابط المنتج",
    rationale: "بدون رابط محفوظ لا يمكن فتح صفحة المنتج من هذه اللوحة.",
  },
  missing_category: {
    title: "ربط المنتجات غير المصنّفة بتصنيف",
    rationale: "المنتج خارج أي تصنيف يصعب الوصول إليه من تصفح المتجر.",
  },
  hidden_category_link: {
    title: "مراجعة المنتجات المرتبطة بتصنيفات مخفية",
    rationale: "التصنيف المرتبط حالته hidden حسب الحقل الموثّق، فقد لا يظهر المنتج عبره.",
  },
  hidden_product: {
    title: "مراجعة المنتجات المخفية",
    rationale: "المنتج حالته hidden حسب حقل status الموثّق، فهو غير معروض للزوار.",
  },
  stale_content: {
    title: "تحديث المحتوى القديم",
    rationale: "آخر تحديث للمنتج في Salla أقدم من حد القِدَم المعلن.",
  },
  missing_price: {
    title: "تحديد سعر للمنتجات بلا سعر",
    rationale: "منتج بلا سعر محفوظ لا يمكن بيعه ولا حسابه.",
  },
  non_positive_price: {
    title: "تصحيح الأسعار الصفرية أو السالبة",
    rationale: "السعر المحفوظ صفر أو سالب، وهو ما لا يمثل سعر بيع صالحًا.",
  },
  missing_currency: {
    title: "استكمال عملة الأسعار",
    rationale: "بدون عملة محفوظة لا يمكن عرض المبلغ بشكل صحيح.",
  },
  out_of_stock: {
    title: "مراجعة المنتجات النافدة",
    rationale: "الكمية الحالية صفر أو أقل، والمنتج ليس بكمية غير محدودة.",
  },
};

const PRIORITY: Record<Severity, Recommendation["priority"]> = {
  high: "P1",
  medium: "P2",
  low: "P3",
};

export function buildRecommendations(
  issues: readonly IssueSummary[],
  totalProducts: number,
): Recommendation[] {
  return issues.map((issue) => {
    const copy = COPY[issue.id as IssueId];

    return {
      id: `rec.${issue.id}`,
      issueId: issue.id,
      title: copy.title,
      rationale: `${copy.rationale} ينطبق على ${issue.affectedCount} من ${totalProducts} منتجًا (${issue.affectedPercent}%).`,
      priority: PRIORITY[issue.severity],
      severity: issue.severity,
      rule: `${issue.id}_count > 0`,
      affectedCount: issue.affectedCount,
      affectedPercent: issue.affectedPercent,
      examples: issue.evidence,
      advisoryOnly: true,
    };
  });
}

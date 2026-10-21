/**
 * Static product metadata.
 *
 * This module is client-safe: it contains no secrets and no tenant data.
 * It is the single source for product naming and the visible roadmap status, so
 * the UI cannot drift from the documented phases.
 */

export const PRODUCT = {
  slug: "kshakha-commerce-ai",
  name: "KSHakha Commerce AI",
  nameAr: "كشخة Commerce AI",
  taglineAr: "نظام تشغيل ذكي للتجارة الإلكترونية",
  taglineEn: "AI Commerce Operating System",
  descriptionAr:
    "منصة تفهم متجر Salla بالكامل، تحلّل أداءه، تكتشف الفرص والمشكلات، تقترح الإجراءات، ثم تنفّذها بعد موافقتك وتقيس أثرها.",
  version: "0.1.0",
  designPartnerAr: "متجر كشخة",
  phase: {
    number: 3,
    label: "03",
    titleAr: "ربط متجر Salla",
    titleEn: "Salla OAuth & Store Connection",
  },
} as const;

export type OperationLevel = "read" | "recommend" | "low-risk-write" | "high-risk-write";

export interface PlannedModule {
  key: string;
  nameAr: string;
  nameEn: string;
  areaAr: string;
  phaseLabel: string;
  summaryAr: string;
  operationLevel: OperationLevel;
}

/**
 * Modules from the target architecture. Everything here is PLANNED; no module
 * below is implemented in Phase 01 and none is presented as available.
 */
export const PLANNED_MODULES: readonly PlannedModule[] = [
  {
    key: "identity",
    nameAr: "الهوية والصلاحيات",
    nameEn: "Identity & Access",
    areaAr: "المنصة",
    phaseLabel: "Phase 02",
    summaryAr: "تسجيل الدخول، المؤسسات، الأدوار، والدعوات — مع عزل صارم لبيانات كل متجر.",
    operationLevel: "read",
  },
  {
    key: "salla-connection",
    nameAr: "ربط متجر Salla",
    nameEn: "Salla Connection",
    areaAr: "التكامل",
    phaseLabel: "Phase 03",
    summaryAr: "تفويض OAuth رسمي، تخزين مشفّر للرموز، وإدارة دورة حياة الاتصال.",
    operationLevel: "read",
  },
  {
    key: "catalog",
    nameAr: "مزامنة الكتالوج",
    nameEn: "Catalog Sync",
    areaAr: "التجارة",
    phaseLabel: "Phase 04",
    summaryAr: "المنتجات والتصنيفات والصور والوسوم، عبر مزامنة أولية وتحديثات لاحقة.",
    operationLevel: "read",
  },
  {
    key: "orders",
    nameAr: "الطلبات والعملاء والمخزون",
    nameEn: "Orders, Customers & Inventory",
    areaAr: "التجارة",
    phaseLabel: "Phase 05",
    summaryAr: "نموذج موحّد للطلبات والعملاء والمخزون يغذّي كل طبقات التحليل.",
    operationLevel: "read",
  },
  {
    key: "events",
    nameAr: "محرك الأحداث والمزامنة",
    nameEn: "Event & Sync Engine",
    areaAr: "المنصة",
    phaseLabel: "Phase 06",
    summaryAr: "استقبال Webhooks موثّقة، منع التكرار، وإعادة المعالجة عند الفشل.",
    operationLevel: "read",
  },
  {
    key: "store-intelligence",
    nameAr: "ذكاء المتجر",
    nameEn: "Store Intelligence",
    areaAr: "الذكاء",
    phaseLabel: "Phase 07",
    summaryAr: "مؤشرات صحة المتجر وملخص تنفيذي يشرح الوضع قبل أي توصية.",
    operationLevel: "recommend",
  },
  {
    key: "sales-intelligence",
    nameAr: "ذكاء المبيعات والمنتجات",
    nameEn: "Sales & Product Intelligence",
    areaAr: "الذكاء",
    phaseLabel: "Phase 08–10",
    summaryAr: "تحليل النمو والمنتجات والمخزون لاكتشاف الفرص والمخاطر مبكرًا.",
    operationLevel: "recommend",
  },
  {
    key: "seo",
    nameAr: "محرك SEO",
    nameEn: "SEO Engine",
    areaAr: "النمو",
    phaseLabel: "Phase 11–13",
    summaryAr: "تدقيق تقني ومحتوى، ربط الكلمات المفتاحية، وفرص الظهور في البحث.",
    operationLevel: "low-risk-write",
  },
  {
    key: "competitors",
    nameAr: "ذكاء المنافسين",
    nameEn: "Competitor Intelligence",
    areaAr: "النمو",
    phaseLabel: "Phase 13",
    summaryAr: "مقارنات من مصادر عامة ومسموحة فقط، دون تجاوز أي حماية أو شروط استخدام.",
    operationLevel: "read",
  },
  {
    key: "recommendations",
    nameAr: "محرك التوصيات",
    nameEn: "Recommendation Engine",
    areaAr: "الذكاء الاصطناعي",
    phaseLabel: "Phase 14",
    summaryAr: "توصيات مبنية على بيانات المتجر، مع تفسير واضح وأثر متوقّع لكل توصية.",
    operationLevel: "recommend",
  },
  {
    key: "actions",
    nameAr: "الموافقة ومحرك الإجراءات",
    nameEn: "Approval & Action Engine",
    areaAr: "الحوكمة",
    phaseLabel: "Phase 15",
    summaryAr: "لا تنفيذ بدون موافقة صريحة، مع تحقق بعد التنفيذ وقياس للأثر وسجل تدقيق.",
    operationLevel: "high-risk-write",
  },
  {
    key: "automation",
    nameAr: "التسويق والأتمتة",
    nameEn: "Marketing & Automation",
    areaAr: "النمو",
    phaseLabel: "Phase 17 · 23",
    summaryAr: "حملات ومهام مجدولة وتقارير آلية — بعد اكتمال طبقة الحوكمة.",
    operationLevel: "high-risk-write",
  },
] as const;

export interface CapabilityStatus {
  labelAr: string;
  detailAr: string;
}

/** What actually exists after Phase 01. Used by the UI; keep it factual. */
export const CURRENT_CAPABILITIES: readonly CapabilityStatus[] = [
  {
    labelAr: "توثيق معماري وقرارات",
    detailAr: "معمارية، أمان، بيانات، تعدد مستأجرين، وخارطة طريق موثّقة في المستودع.",
  },
  {
    labelAr: "هوية وعزل مستأجرين",
    detailAr: "تسجيل ودخول بجلسات مخزّنة في PostgreSQL، كلمات مرور scrypt، وRLS على جداول المؤسسة.",
  },
  {
    labelAr: "إعدادات متحقَّق منها",
    detailAr: "كل متغيّرات البيئة تُفحص عبر Zod دون تسجيل أي قيمة سرية.",
  },
  {
    labelAr: "تسجيل منظّم",
    detailAr: "سجلات JSON مع سياق الطلب والمتجر وتنقية للرموز والبيانات الحساسة.",
  },
  {
    labelAr: "عقد طبقة الذكاء الاصطناعي",
    detailAr: "واجهة مزوّد موحّدة مع تحقق من المخرجات وإعادة محاولة — بلا مزوّد مربوط.",
  },
  {
    labelAr: "واجهة تأسيسية عربية",
    detailAr: "واجهة RTL متجاوبة تعرض الحالة الفعلية فقط، دون أي بيانات وهمية.",
  },
] as const;

/** Data/integration state. Everything is explicitly not connected today. */
export const DATA_STATE: readonly {
  componentAr: string;
  stateAr: string;
  tone: "off" | "pending";
}[] = [
  { componentAr: "بيانات المتجر", stateAr: "لا توجد بيانات بعد", tone: "off" },
  {
    componentAr: "قاعدة البيانات",
    stateAr: "PostgreSQL — تُفعّل بضبط DATABASE_URL",
    tone: "pending",
  },
  { componentAr: "اتصال Salla", stateAr: "غير متصل — Phase 03", tone: "pending" },
  { componentAr: "مزوّد الذكاء الاصطناعي", stateAr: "غير مهيأ — Phase 14", tone: "pending" },
] as const;

export interface Principle {
  titleAr: string;
  bodyAr: string;
}

export const PRINCIPLES: readonly Principle[] = [
  {
    titleAr: "الذكاء الاصطناعي لا ينفّذ مباشرة",
    bodyAr:
      "كل تغيير يمرّ عبر توصية، ثم تحقق، ثم موافقة بشرية، ثم تنفيذ، ثم قياس. لا يملك أي نموذج صلاحية الكتابة على المتجر.",
  },
  {
    titleAr: "عزل كامل بين المتاجر",
    bodyAr:
      "تُحدَّد هوية المتجر من جلسة المستخدم وعضويته في المؤسسة، لا من قيمة يرسلها المتصفح. كل استعلام مقيّد بالسياق.",
  },
  {
    titleAr: "تفسير قبل التوصية",
    bodyAr:
      "كل توصية تعرض السبب والبيانات المستخدمة والأثر المتوقّع ومستوى المخاطر، حتى يستطيع صاحب المتجر اتخاذ القرار.",
  },
  {
    titleAr: "قابلية الاستبدال",
    bodyAr:
      "تكامل Salla وطبقة الذكاء الاصطناعي يعيشان خلف عقود واضحة، حتى لا يرتبط النظام بمزوّد أو إصدار واحد.",
  },
  {
    titleAr: "العربية أولًا",
    bodyAr:
      "الاتجاه RTL واللغة العربية جزء من التصميم من البداية، مع قابلية إضافة الإنجليزية لاحقًا.",
  },
  {
    titleAr: "كل أثر يُقاس",
    bodyAr:
      "لا تُعدّ التوصية ناجحة لمجرد تنفيذها. يُسجَّل التغيير، وتُقارن النتائج قبل وبعد، ويتعلّم النظام من النتيجة.",
  },
] as const;

export const PHASE_03_SCOPE: readonly string[] = [
  "تطبيق Salla على Partners Portal مع Scopes دنيا.",
  "Custom Mode مع state، وتبادل الرمز عبر النطاقات الرسمية فقط.",
  "تشفير الرموز AES-256-GCM مع AAD لمعرّف المتجر.",
  "تجديد single-flight، وفصل/إعادة ربط، وعرض حالة حقيقية بلا كتابة بيانات.",
] as const;

export const DOCUMENTS: readonly { file: string; labelAr: string }[] = [
  { file: "docs/architecture.md", labelAr: "المعمارية الكاملة" },
  { file: "docs/product-spec.md", labelAr: "تعريف المنتج" },
  { file: "docs/roadmap.md", labelAr: "خارطة الطريق" },
  { file: "docs/decisions.md", labelAr: "القرارات المعمارية" },
  { file: "docs/salla-reference.md", labelAr: "مرجع تكامل Salla" },
  { file: "docs/phase-02.md", labelAr: "خطة المرحلة القادمة" },
] as const;

# KSHakha Commerce AI — Architecture

> **النسخة:** 1.0 · **التاريخ:** 2026-10-21 · **الحالة:** معتمدة لمرحلة Phase 01  
> **النطاق:** وثيقة تصميم. لا تصف أي ميزة غير منفّذة على أنها متاحة.  
> **المرجع الرسمي للتكامل:** [docs.salla.dev](https://docs.salla.dev/) — كل معلومة عن Salla في هذه الوثيقة موثّقة في [`salla-reference.md`](./salla-reference.md) مع رابط المصدر وتاريخ التحقق.

---

## 0. ملخص تنفيذي

KSHakha Commerce AI هو **AI Commerce Operating System** لمتاجر Salla، يبدأ بمتجر كشخة كشريك تصميم أول. الهدف ليس لوحة معلومات ولا أداة SEO منفصلة، بل نظام موحّد:

**يفهم المتجر → يكتشف المشكلات والفرص → يشرح → يقترح → يتوقّع → يطلب موافقة → ينفّذ → يتحقق → يقيس → يتعلّم.**

قرارات المعمارية الجوهرية في هذه المرحلة:

| القرار | الاختيار | السبب المختصر |
|---|---|---|
| شكل النظام | **Modular Monolith** + عامل خلفي منفصل | فريق صغير، معاملات متسقة، قابلية فصل الوحدات لاحقًا |
| الإطار | **Next.js 16 (App Router) + React 19** | واجهة عربية RTL وواجهات API في نشر واحد |
| اللغة | **TypeScript 5.9 strict** | أمان الأنواع عبر حدود الوحدات والتكاملات |
| قاعدة البيانات | **PostgreSQL 16** (من Phase 02) | علاقات، JSONB، RLS، نافذات تحليلية |
| ORM | **Drizzle ORM** | SQL صريح، هجرات مفهومة، دعم RLS، بلا محرّك أصلي |
| الذكاء الاصطناعي | **AIProvider + AiGateway** بلا مزوّد مربوط | لا ارتباط بمزوّد، تحقق مخرجات، تحكم بالتكلفة |
| تعدد المستأجرين | **User → Organization → Store → SallaConnection** | عزل من اليوم الأول، لا `store_id` من العميل |
| التنفيذ | **لا كتابة مباشرة من AI** | Recommendation → Approval → Action → Verification |
| اللغة والاتجاه | **Arabic-first / RTL** | الجمهور الأساسي سعودي/خليجي، الإنجليزية لاحقًا |

---

## A. Current State

### A.1 حالة المستودع قبل Phase 01

| العنصر | الحالة |
|---|---|
| Git | مستودع جديد، فرع `Website`، كوميت واحد `ecbe761 Initial commit` |
| الملفات | `README.md` فقط (20 بايت) |
| الكود | **لا يوجد** — لا `package.json`، لا تطبيق، لا قاعدة بيانات |
| التاريخ | لا تاريخ هندسي سابق يمكن الحفاظ عليه |
| الفروع | `Website` فقط |

**الاستنتاج:** المشروع Greenfield. لا يوجد كود قائم يستحق الحفاظ عليه، لذلك بُني حد أدنى من الأساس بدل إعادة بناء نظام غير موجود.

### A.2 ما تم إنشاؤه في Phase 01

| الطبقة | التقنية / الحالة |
|---|---|
| Framework | Next.js **16.4.2** (App Router, Turbopack build) |
| UI | React **19.3.1**، Tailwind CSS **4.3.3** (CSS-first tokens)، صفحة تأسيسية RTL |
| Language | TypeScript **5.9.3**، `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax` |
| Backend | Route Handler واحد: `GET /api/health` |
| Database | **لا توجد** — PostgreSQL وDrizzle مخططان لـ Phase 02 |
| ORM / Migrations | **لا توجد** |
| Authentication | **لا توجد** — مخططة لـ Phase 02 |
| Authorization | **لا توجد** — التصميم موثّق فقط |
| AI | عقد `AiProvider` + `AiGateway` + سجل مزوّدين **فارغ** (بلا مزوّد) |
| Salla integration | **لا توجد** — Phase 03 |
| Queue / Workers | **لا توجد** — Phase 06 |
| Logging | pino **10.4.0** مع تنقية مسارات حساسة |
| Validation | Zod **4.6.7** (بيئة + مدخلات AI + مخرجات منظمة) |
| Testing | Vitest **5.0.5** — اختبارات وحدة فقط |
| Lint / Format | ESLint **9.39.5** (flat config) + Prettier **3.9.10** |
| CI | GitHub Actions (lint → typecheck → test → secrets → build) |
| Deployment | **غير مهيأ** — التصميم موثّق فقط |
| Docs | `architecture`, `product-spec`, `roadmap`, `decisions`, `salla-reference`, `phase-02` |

### A.3 ما هو موجود فعليًا في الكود

- `src/lib/env.ts` — تحقق Zod من متغيّرات البيئة، كسول، لا يطبع القيم.
- `src/lib/errors.ts` — تصنيف أخطاء موحّد مع ربط HTTP وحجب التفاصيل العامة.
- `src/lib/logger.ts` — سجلات JSON مع `redact` للرموز وكلمات المرور.
- `src/lib/ai/types.ts` — عقد المزوّد والطلب والنتيجة ونطاق المستأجر.
- `src/lib/ai/registry.ts` — تسجيل المزوّدين ومنع الالتباس.
- `src/lib/ai/gateway.ts` — محاولات، مهلة، تحقق JSON، إصلاح محدود، تسجيل بلا محتوى.
- `src/config/product.ts` — بيانات المنتج والوحدات المخططة وحالة البيانات (client-safe).
- `src/app/*` — واجهة تأسيسية عربية تعرض الحالة الفعلية فقط.
- 43 اختبار وحدة تغطي البيئة، الأخطاء، السجل، سجل المزوّدين، وبوابة AI.

### A.4 ما هو غير موجود بشكل مقصود

لا قاعدة بيانات، لا OAuth، لا مزامنة، لا Webhooks، لا Dashboard، لا SEO، لا Marketing، لا Agent، لا بيانات متجر، لا أي مزوّد AI. هذه ليست نقصًا؛ بل **حدود المرحلة**.

---

## B. Problems & Risks

| # | المشكلة / الخطر | الأثر | التخفيف المخطط |
|---|---|---|---|
| B1 | Greenfield بلا بيانات أو مستخدمين | لا يمكن التحقق من جودة القرارات بالبيانات | شريك تصميم واحد (كشخة) + بيانات Demo Store رسمية للاختبار |
| B2 | رموز Salla عمرها **14 يومًا** والـ refresh **أحادي الاستخدام** | أي تزامن خاطئ يبطل الاتصال ويطلب إعادة تثبيت | قفل موزّع/صفري عند التجديد + تجديد استباقي + مسار إعادة ربط |
| B3 | Webhooks تصل at-least-once مع 3 محاولات ومهلة 30 ثانية | تكرار الأحداث وفقدان معالجة عند البطء | تخزين خام فورًا + رد 2xx سريع + dedupe + معالجة غير متزامنة |
| B4 | حدود معدل Salla تختلف حسب خطة المتجر (120/360/720 في الدقيقة) | فشل المزامنة الأولية أو حجب مؤقت | Rate limiter لكل متجر حسب الخطة + قراءة headers + جدولة backfill |
| B5 | وثائق Salla تتغيّر (مثال: `product.updated` مشطوب في جدول Webhooks لكنه مدعوم في صفحات أخرى) | بناء على افتراض خاطئ | سجل Endpoints موثّق بتاريخ تحقق + إعادة تحقق قبل كل مرحلة + اختبار على Demo Store |
| B6 | تعدد المستأجرين يُنفَّذ لاحقًا لكن يُنسى في استعلام واحد = تسريب كامل | كارثة ثقة/قانونية | `TenantContext` إلزامي + RLS + اختبارات عزل في كل مرحلة كتابة |
| B7 | AI قد يهلوس أو يُستغل بـ prompt injection من محتوى المتجر | توصيات مضللة أو تسريب سياق | سياق مقيّد بالمستأجر، تعليمات منفصلة، تحقق Zod، لا أدوات كتابة، موافقة بشرية |
| B8 | تكلفة AI غير محدودة | خسارة مالية | ميزانية لكل مؤسسة، تسجيل tokens، cache، نماذج حسب المهمة |
| B9 | عزل RTL/العربية قد يُعالج متأخرًا | إعادة بناء UI | توكنز CSS منطقية + `dir="rtl"` من البداية + اختبار بصري لاحقًا |
| B10 | لا Postgres/Redis/Docker في بيئة التطوير الحالية | لا اختبارات تكامل محليًا الآن | Testcontainers أو قاعدة مُدارة في CI (Phase 02) |
| B11 | لا وجهة نشر ولا مراقبة محددة | مخاطر تشغيلية مؤجلة | قرار نشر موثّق + healthcheck + خطة مراقبة قبل Phase 25 |
| B12 | بيانات المنافسين قد تُجمع بطرق غير قانونية | مخاطر قانونية وسمعة | سياسة مصادر عامة/مسموحة + robots/ToS + منع تجاوز الحماية |
| B13 | ESLint 9 أصبح غير مدعوم upstream لكنه مقيّد بـ `eslint-config-next` | دين تقني بسيط | ترقية عند دعم ESLint 10؛ مثبّت في ADR |
| B14 | لا يوجد مصادقة/تفويض للـ health route أو حد معدل عام | سطح هجوم صغير الآن لكنه سيكبر | Rate limit وAuth من Phase 02، مراجعة أمنية Phase 24 |
| B15 | PDPL وحماية بيانات العملاء | مخاطر امتثال | تقليل البيانات، تشفير، احتفاظ محدود، مراجعة قانونية قبل الإنتاج |

---

## C. Architecture Decision

### C.1 الشكل المعماري

**Modular Monolith** داخل تطبيق Next.js واحد، مع **Worker process منفصل** لنفس الكود عند الحاجة (Phase 06). الوحدات تُفصل بحدود واضحة لا بحدود شبكية.

```
┌──────────────────────────────────────────────────────────────────┐
│                       Web Application (Next.js)                  │
│                                                                  │
│  Presentation        app/ (RSC, route handlers, UI)              │
│       │                                                          │
│  Application         modules/*/application (use cases)           │
│       │                                                          │
│  Domain              modules/*/domain (pure rules, types)        │
│       │                                                          │
│  Infrastructure      modules/*/infrastructure + platform/        │
│                      (Postgres, Salla, AI, queue, crypto)        │
└──────────────────────────────────────────────────────────────────┘
             │                                   │
             │ SQL                               │ HTTPS
             ▼                                   ▼
      PostgreSQL 16                      Salla Merchant API v2
             ▲                                   ▲
             │                                   │ webhooks (signed)
┌────────────┴───────────────────────────────────┴─────────────────┐
│                    Worker (Phase 06, same codebase)              │
│             sync jobs · webhook processing · scheduled tasks     │
└──────────────────────────────────────────────────────────────────┘
```

### C.2 قاعدة الاعتماد

- `domain` لا يعتمد على Next.js، ولا قاعدة بيانات، ولا SDK مزوّد، ولا `fetch`. قواعد عمل نقية.
- `application` ينسّق حالات الاستخدام ويستدعي **ports** (واجهات) لا تطبيقاتها.
- `infrastructure` ينفّذ الـ ports (Drizzle، Salla HTTP، AI adapters، queue).
- `app/` طبقة عرض رقيقة: تحقق مدخلات، استدعاء use case، تشكيل استجابة.
- الوحدة لا تستورد `infrastructure` وحدة أخرى؛ التواصل عبر `application` العامة أو أحداث نطاق.

### C.3 هيكل المجلدات المستهدف

```text
src/
  app/                        # مسارات Next.js
    (marketing)/              # عام — لاحقًا
    (app)/                    # محمي بجلسة — لاحقًا
    api/
      health/route.ts         # موجود
      webhooks/salla/route.ts # Phase 06
  components/                 # مكوّنات عرض مشتركة
  config/                     # بيانات منتج/ثوابت آمنة للعميل
  lib/
    ai/                       # طبقة AI مستقلة عن المزوّد (موجودة)
    env.ts  errors.ts  logger.ts
  modules/                    # Phase 02+
    identity/
      domain/ application/ infrastructure/ ui/
    commerce/
    intelligence/
    growth/
    seo/
    competitors/
    marketing/
    content/
    automation/
    governance/
  platform/                   # db, crypto, http, rate-limit, queue, ids
  worker/                     # نقطة تشغيل العامل — Phase 06
scripts/
docs/
```

### C.4 لماذا Modular Monolith وليس Microservices؟

| المعيار | Modular Monolith | Microservices |
|---|---|---|
| فريق صغير | ✅ وحدة نشر واحدة | ❌ تكلفة تشغيل عالية |
| اتساق البيانات | ✅ معاملات ACID | ❌ Sagas وتعويضات |
| سرعة Phase 02–07 | ✅ عالية | ❌ منخفضة |
| فصل الوحدات | ✅ عبر الحدود البرمجية | ✅ |
| التوسّع الانتقائي | ⚠️ لاحقًا عبر Worker | ✅ مباشر |

قابلية التوسّع ليست الحد الأقصى للطلبات اليوم، بل **سلامة القرارات**. عند الحاجة، تُستخرج الوحدات الثقيلة (AI/SEO crawlers) إلى خدمات مستقلة لأن حدودها سليمة أصلًا.

### C.5 لماذا Next.js؟

- واجهة RSC خفيفة + Route Handlers في مشروع واحد.
- دعم RTL وi18n مباشر.
- نشر بسيط، وبيئة مألوفة.
- لا حاجة إلى SPA منفصل في هذه المرحلة.

الاستثناء: العامل الخلفي لا يعتمد على Next.js runtime، لأن مهام المزامنة طويلة العمر.

### C.6 Stack Decisions (مفصّلة في ADRs)

| الطبقة | الاختيار | البدائل المدروسة | سبب الرفض/التأجيل |
|---|---|---|---|
| UI | Tailwind 4 + توكنز | shadcn/ui الآن | لا Dashboard بعد؛ shadcn عند Phase 07 |
| Validation | Zod 4 | Yup, io-ts | Zod 4 يولّد JSON Schema مباشرة لمخرجات AI |
| Logging | pino | winston, console | أداء، JSON، redaction أصلية |
| DB | PostgreSQL 16 | MySQL, MongoDB | JSONB + RLS + نافذات + علاقات |
| ORM | Drizzle | Prisma | Prisma يحتاج محرّكًا أصليًا/codegen؛ Drizzle SQL صريح وRLS أسهل |
| Auth | جلسات مخصّصة آمنة (Phase 02) | Auth.js credentials | قيود جلسات DB مع Credentials؛ يُعاد التقييم عند SSO |
| Hashing | `scrypt` من Node | Argon2id | لا اعتماد native في النشر الأول؛ Argon2id خيار لاحق |
| Queue | PostgreSQL-backed port | Redis/BullMQ | تجنّب بنية إضافية قبل الحاجة؛ abstraction يحمي القرار |
| Tests | Vitest | Jest | أسرع وأبسط مع TS/Vite |
| E2E | Playwright (Phase 02+) | Cypress | اختيار قياسي لاحقًا |

---

## D. Data Architecture

### D.1 المبدأ

> **Salla هي مصدر الحقيقة للبيانات التجارية. قاعدتنا هي read model معزول بالمستأجر + حالة المنصة + سجل تاريخي.**

لا ننسخ كل شيء «لأننا نستطيع»، بل ما تحتاجه التحليلات والتوصيات والإجراءات، مع الاحتفاظ بالـ payload الخام للأحداث الحرجة.

### D.2 خط الأنابيب

```
Salla API / Webhooks
        │
        ▼
[1] Integration Layer      OAuth · rate limit · retry · pagination · signature verify
        │
        ▼
[2] Raw Capture            webhook_events (immutable, hash, received_at)  ──► DLQ
        │
        ▼
[3] Normalization          Zod schemas → canonical entities (money, time, status)
        │
        ▼
[4] Database               tenant-scoped upserts, unique external IDs
        │
        ▼
[5] Analytics              SQL views · daily metric snapshots
        │
        ▼
[6] Rules Engine           deterministic checks (stock cover, SEO gaps, price guardrails)
        │
        ▼
[7] AI Intelligence        grounded context · structured proposals
        │
        ▼
[8] Recommendations        explainable, scored, risk-classified
        │
        ▼
[9] Approval               human decision (low/high risk)
        │
        ▼
[10] Action                allowlisted write via adapter + idempotency key
        │
        ▼
[11] Verification          read-after-write, retries, mismatch alert
        │
        ▼
[12] Measurement           before/after, window 7/28 days, confidence
        │
        ▼
[13] Learning              outcome labels · prompt/eval/rule updates
```

### D.3 تطبيع البيانات (Normalization)

| الموضوع | القاعدة |
|---|---|
| المال | أعداد صحيحة بأصغر وحدة نقدية + رمز العملة (`amount_minor`, `currency`) — لا `float` |
| الوقت | UTC في القاعدة، توقيت المتجر للعرض فقط |
| المعرّفات | UUID داخلي + `provider_id` خارجي؛ فريد `(store_id, provider_id)` |
| النصوص العربية | تُحفظ كما هي، بلا تطبيع إجباري؛ البحث يستخدم إعدادات مناسبة |
| الحالات | Enum داخلي + الحالة الخام (`raw_status`) للتدقيق |
| JSON | `jsonb` للـ payload الخام والحقول غير المستقرة فقط، لا للأعمدة الأساسية |
| الحذف | Soft delete افتراضيًا للكيانات التجارية؛ الحذف الفعلي عبر job |

### D.4 استراتيجية المزامنة

1. **Backfill أولي** عند ربط المتجر: صفحات متسلسلة، `per_page` أقصى موثّق، احترام حدود الخطة، checkpoint قابل للاستئناف.
2. **Incremental** عبر Webhooks بعد Phase 06، مع تحديثات نقطية.
3. **Reconciliation** يوميًا: مقارنة عدّادات/تواريخ التحديث، وسدّ الفجوات.
4. **Idempotency**: كل upsert مفتاحه `(store_id, external_id)`؛ الأحداث dedupe.
5. **Partial failure**: job يُسجّل الموارد الناجحة والفاشلة، ويعيد المحاولة دون إعادة كل شيء.

قيود Salla الموثّقة: ترتيب الصفحات تسلسليًا، و`per_page=30` للطلبات، وإكمال الترقيم خلال 15 دقيقة، واستخدام `from_date`/`to_date`. التفاصيل في [`salla-reference.md`](./salla-reference.md).

### D.5 نموذج البيانات المستقبلي (لا يُنشأ الآن)

**Phase 02 فقط:** `users`, `organizations`, `organization_members`, `stores`, `sessions`, `audit_logs` (+ `invitations` إن لزم).

لاحقًا، حسب المرحلة:

| المجموعة | الجداول | المرحلة |
|---|---|---|
| الربط | `salla_connections`, `oauth_tokens` | 03 |
| الكتالوج | `products`, `product_variants`, `categories`, `product_images` | 04 |
| التجارة | `orders`, `order_items`, `customers`, `inventory_levels`, `reviews` | 05 |
| الأحداث | `webhook_events`, `sync_jobs`, `sync_cursors` | 06 |
| التحليلات | `metric_snapshots`, `store_health_scores` | 07+ |
| SEO | `seo_audits`, `seo_issues`, `keywords`, `keyword_rankings`, `keyword_mappings` | 11–13 |
| المنافسون | `competitors`, `competitor_pages`, `competitor_products` | 13 |
| المحتوى | `content_projects`, `content_documents` | 16 |
| AI | `ai_generations`, `recommendations` | 14 |
| الحوكمة | `change_requests`, `change_logs`, `action_runs` | 15 |
| التسويق | `campaigns`, `campaign_metrics` | 17 |
| الأتمتة | `automations`, `notifications`, `reports` | 21–23 |

> لا يُنشأ جدول قبل أن يحتاجه Use Case فعلي. الجداول أعلاه خريطة لا أمر تنفيذ.

### D.6 عزل المستأجرين في البيانات

- كل جدول تجاري يحمل `organization_id` و`store_id` (حيث ينطبق).
- المفتاح الأساسي UUID، لكن **الفهارس تبدأ دائمًا بمعرّف المتجر**.
- مفاتيح أجنبية مركّبة تمنع ربط كيان بمتجر آخر.
- Row-Level Security كطبقة دفاع ثانية (Phase 02)، مع سياق معاملة `app.current_org`.
- لا استعلام «كل المتاجر» خارج مهام المنصة المصرّح بها.

### D.7 Analytics وData Warehouse

المرحلة الأولى: **PostgreSQL فقط** — views/materialized views + snapshots يومية. لا ClickHouse/warehouse قبل إثبات الحجم. الفصل يحدث إذا تجاوزت الاستعلامات التحليلية قدرة OLTP.

### D.8 الاحتفاظ والخصوصية

| البيانات | الاحتفاظ الافتراضي |
|---|---|
| Webhook payload خام | 90 يومًا، ثم hash + metadata |
| سجلات التدقيق | سنتان |
| سجلات AI (metadata) | سنة |
| مخرجات AI | حسب نوع المحتوى وسياسة العميل |
| PII للعملاء | الحد الأدنى + حذف عند الطلب |

---

## E. Security Architecture

### E.1 نموذج التهديد المختصر

| الأصل | المهاجم المحتمل | التهديد | الضابط الأساسي |
|---|---|---|---|
| رموز Salla | مستخدم مصادق خبيث / تسريب | سرقة، إساءة استخدام | تشفير at-rest، إخفاء في السجلات، عمر قصير |
| بيانات متجر | مستأجر آخر | IDOR/BOLA | TenantContext + RLS + اختبارات |
| PII عملاء | داخلي/خارجي | كشف غير مصرح | تقليل، تشفير، صلاحيات، احتفاظ |
| حسابات المستخدمين | مهاجم خارجي | تخمين/credential stuffing | scrypt، rate limit، كشف تسريب لاحقًا |
| طبقة AI | محتوى متجر خبيث | prompt injection | فصل التعليمات، لا أدوات كتابة، تحقق مخرجات |
| Webhooks | طرف ثالث | تزوير أحداث | توقيع HMAC + timing-safe + dedupe |

### E.2 المصادقة (Authentication)

- بريد + كلمة مرور، مع تحقق بريد قبل تفعيل الوصول للمتجر.
- `scrypt` (Node built-in) مع salt عشوائي لكل مستخدم ومعاملات موثّقة. Argon2id خيار بعد إثبات بيئة النشر.
- جلسة **opaque** 256-bit، تُخزَّن **مُجزّأة SHA-256** في `sessions`.
- الكوكي: `__Host-ksh_session`، `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`.
- انتهاء خمول 7 أيام، وحد أقصى 30 يومًا، وتدوير عند تغيير كلمة المرور/الصلاحيات.
- تسجيل الخروج لكل الأجهزة، وإبطال فوري من قاعدة البيانات.
- Rate limiting على تسجيل الدخول (IP + الحساب)، وتأخير تدريجي.
- MFA (TOTP) وWebAuthn لاحقًا ضمن Phase 24.

> **لا نستخدم** JWT طويل العمر في الكوكي ولا جلسات غير قابلة للإبطال.

### E.3 التفويض (Authorization)

أدوار أولية:

| الدور | قراءة | اقتراح | كتابة منخفضة | كتابة عالية | إدارة أعضاء |
|---|---|---|---|---|---|
| Owner | ✅ | ✅ | ✅ | ✅ | ✅ |
| Admin | ✅ | ✅ | ✅ | ✅ | ✅ |
| Manager | ✅ | ✅ | ✅ | ⚠️ باقتراح Owner للعمليات الحساسة | ❌ |
| Analyst | ✅ | ✅ | ❌ | ❌ | ❌ |
| Viewer | ✅ | ❌ | ❌ | ❌ | ❌ |

- الصلاحيات أسماء صريحة (`store:read`, `action:approve:high`, `member:invite`) لا فحص أدوار متفرّق.
- الفحص **دائمًا على الخادم** داخل use case، لا في الواجهة فقط.
- Deny by default.
- مستويات العمليات متوافقة مع المصفوفة أعلاه وتُطبّق في Action Engine.

### E.4 تعدد المستأجرين والعزل

سلسلة التحديد الإلزامية:

```
Authenticated User
      ↓
Organization Membership (Role)
      ↓
Authorized Store (membership scope)
      ↓
Internal Store UUID  ← يُستخدم في كل استعلام
```

- **ممنوع** استخدام `store_id` القادم من العميل كدليل صلاحية. يُقبل كـ«طلب» فقط، ويُتحقق منه.
- `TenantContext { userId, organizationId, storeId, role, requestId }` يُمرَّر صراحةً إلى use cases.
- الاستعلامات تأخذ `organizationId`/`storeId` كوسائط إلزامية، لا كمتغيّر عالمي خفي.
- Row-Level Security:
  ```sql
  ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
  CREATE POLICY orders_tenant_isolation ON orders
    USING (organization_id = current_setting('app.current_org')::uuid);
  ```
  تُضبط `app.current_org` داخل كل معاملة.
- اختبارات أمان إلزامية لكل مسار: قراءة/كتابة عبر متجر آخر يجب أن تفشل بـ 404 (لا 403، لتجنّب كشف الوجود).
- الوظائف الخلفية تحمل سياق المستأجر في الـ job وتُعيد التحقق منه.

### E.5 الأسرار والتشفير

| البند | القرار |
|---|---|
| الأسرار | Environment فقط. `.env.example` بلا قيم. لا أسرار في Git أو الواجهة أو السجلات |
| إدارة الأسرار في الإنتاج | Secret Manager/KMS (يُختار مع منصة النشر) + دوران |
| رموز Salla | AES-256-GCM، IV فريد، AAD = `store_id`، `key_version` للتخزين |
| دوران مفتاح التشفير | إعادة تشفير تدريجية بـ job + احتفاظ بالإصدارات |
| كلمات المرور | scrypt + salt، لا تشفير قابل للعكس |
| النقل | HTTPS فقط، HSTS |
| السجلات | تنقية `access_token`, `refresh_token`, `client_secret`, `api_key`, `password`, `authorization`, `cookie` |

### E.6 أمان الـ API

- Zod على كل مدخل (body/query/params) قبل الاستخدام.
- حدود حجم الطلب وtimeout.
- Rate limit متعدد المستويات: IP، مستخدم، مؤسسة، متجر.
- كتابة idempotent عبر `Idempotency-Key` عند الحاجة.
- Same-origin فقط؛ لا CORS مفتوح.
- فحص `Origin` على طلبات cookie-state-changing، مع `SameSite=Lax`.
- رؤوس أمان مفعّلة في `next.config.ts`؛ **CSP مؤجلة إلى Phase 24** لأنها تحتاج nonce middleware.
- لا تُعاد تفاصيل داخلية في الأخطاء العامة (`toPublicError`).

### E.7 التحقق من Webhooks

وفق وثائق Salla:

1. التحقق من رأس `X-Salla-Security-Strategy` وقيمة `X-Salla-Signature` باستخدام HMAC-SHA256 على **الجسم الخام** وبالسر المشترك.
2. مقارنة **timing-safe**.
3. رفض الطلب قبل أي parsing إذا فشل التحقق.
4. قراءة الجسم الخام مرة واحدة، وتخزينه كما وصل.
5. الرد خلال نافذة Salla (30 ثانية) بعد حفظ الحدث، والمعالجة غير متزامنة.
6. dedupe بمفتاح `(store_id, payload_hash/event_identity)`.
7. سجل محاولات + مراقبة معدل فشل التوقيع.

> Salla تُعيد المحاولة حتى 3 مرات بفواصل ~5 دقائق عند عدم نجاح الاستجابة. لا نعتمد على «مرة واحدة».

### E.8 سجل التدقيق

`audit_logs` (append-only) يحتوي: actor، org/store، action، entity، before/after hash، request_id، IP مجزّأ، user agent، timestamp، outcome. لا أسرار ولا محتوى PII كامل. لا حذف من التطبيق؛ أرشفة فقط. Hash chain اختياري في Phase 24.

### E.9 أمان AI

- كل سياق مربوط بـ `organizationId` + `storeId`؛ لا استرجاع عابر للمستأجرين.
- محتوى المتجر **بيانات غير موثوقة**: يُغلّف ويُعلَّم، ولا يُنفَّذ كتعليمات.
- ممنوع إدخال أسرار أو رموز أو PII غير لازمة في prompts.
- مخرجات النموذج تُتحقق بـ Zod قبل أي استخدام.
- لا أدوات كتابة للنموذج. الأدوات المتاحة قراءة فقط وبقائمة مسموحة.
- سجل `ai_generations` يحفظ metadata لا المحتوى الكامل افتراضيًا.

### E.10 نقاط إضافية

- SSRF: أي جلب خارجي (منافسون/SEO) عبر egress proxy يمنع الشبكات الخاصة ويحترم robots/ToS.
- الملفات (لاحقًا): تحقق نوع/حجم، فحص فيروسات، تخزين خاص.
- سلسلة التوريد: lockfile، `npm ci`، فحص أسرار، Dependabot، تثبيت Actions بـ SHA في Phase 24.
- PDPL: تقليل البيانات، أساس قانوني، اتفاقية معالجة مع التاجر، احتفاظ محدود، مراجعة قانونية قبل الإنتاج.

---

## F. AI Architecture

### F.1 المبادئ

1. **مستقل عن المزوّد**: لا `openai.chat()` في أي مكان خارج adapter.
2. **مربوط بالمستأجر**: `AiCallContext.tenant` إلزامي في النوع والتحقق.
3. **مُقيَّد بالمخرجات**: نتيجة منظمة تُتحقق بـ Zod أو تُرفض.
4. **لا كتابة مباشرة**: AI ينتج اقتراحًا، وAction Engine هو المنفّذ الوحيد.
5. **قابل للتفسير**: كل توصية تحمل الأدلة والمصدر والأثر المتوقع ومستوى الثقة.
6. **قابل للقياس**: tokens، تكلفة، كمون، latency، نجاح التحقق، نتيجة القرار.

### F.2 العقد المنفّذ (Phase 01)

```ts
export interface AiProvider {
  readonly id: string;
  readonly capabilities: readonly AiCapability[];
  readonly defaultModel: string;
  generate(
    request: AiCompletionRequest,
    context: AiCallContext,
  ): Promise<AiProviderResponse>;
}
```

- `AiProviderRegistry` يمنع التكرار والالتباس ويرفض مزوّدًا لا يدعم `text`.
- `AiGateway` يملك: التحقق، المهلة، retries مع backoff+jitter، تسجيل metadata، وإصلاح المخرجات المنظمة.
- `AiCallContext` يشمل `requestId`, `operation`, `tenant`, `promptId`, `promptVersion`, `timeoutMs`, `signal`.
- **لا مزوّد فعلي** في Phase 01؛ محاولة الاستدعاء تُرجع `AI_NOT_CONFIGURED`.

### F.3 تدفق الاستدعاء

```
Use Case
  │  (رسائل + schema + سياق مستأجر)
  ▼
AiGateway ──► Registry.require(providerId?)
  │              │
  │              ├─ 0 مزوّد → AI_NOT_CONFIGURED
  │              └─ >1 بلا تحديد → AI_PROVIDER_REQUIRED
  ▼
Provider Adapter ──► HTTP SDK
  │
  ├─ success → validate → log metadata → return
  ├─ retryable (429/5xx/timeout) → backoff → retry
  └─ invalid JSON/schema → repair message (bounded) → re-validate
```

### F.4 اختيار النموذج

طبقات مستقبلية:

| الطبقة | الاستخدام | مثال خصائص |
|---|---|---|
| `fast` | تصنيف، وسوم، استخراج | كلفة منخفضة، كمون عالٍ |
| `balanced` | تحليل وتوصيات | افتراضي |
| `deep` | تحليل استراتيجي/طويل | كلفة أعلى، استخدام محدود |

الاختيار عبر `model registry` داخلي (لا أسماء مزوّد في الكود التجاري). لكل مهمة schema وprompt وحدود tokens.

### F.5 Prompt Registry

- ملفات prompts بإصدارات (`id@version`) داخل المستودع.
- تغيير prompt = مراجعة + تقييم offline + إمكانية rollback.
- لا prompts قابلة للتحرير من المستخدم في المراحل الأولى.
- كل استدعاء يسجّل `promptId` + `promptVersion`.

### F.6 تجميع السياق (Grounding)

- Context builder يجلب من قاعدة البيانات ضمن نطاق المتجر فقط.
- حقائق رقمية تُمرَّر كبيانات منظمة (JSON) لا كنص حر.
- كل ادعاء في التوصية يشير إلى معرف بيانات/مقياس.
- ميزانية tokens محددة؛ عند التجاوز: تلخيص/ترتيب أولوية، لا اقتطاع عشوائي.
- لا SQL يولّده النموذج.

### F.7 توليد المخرجات المنظمة

- Zod schema لكل مهمة، ويُحوَّل إلى JSON Schema عبر `z.toJSONSchema`.
- المحاولة الأولى: تعليمات صارمة.
- عند الفشل: رسالة إصلاح تحتوي أخطاء التحقق فقط (بلا بيانات حساسة).
- حد أقصى للإصلاح (افتراضي 1)، ثم `AI_INVALID_OUTPUT`.
- لا تُمرَّر مخرجات غير متحققة إلى أي منطق عمل.

### F.8 التكلفة والتتبع

`ai_generations` (Phase 14): `organization_id`, `store_id`, `operation`, `prompt_id`, `prompt_version`, `provider`, `model`, `input_tokens`, `output_tokens`, `cost_minor`, `latency_ms`, `validation_status`, `request_id`, `created_at`. ميزانية شهرية لكل مؤسسة + تنبيهات + cache على hash المدخلات.

### F.9 التقييم (Evaluation)

- Golden sets لكل مهمة (من بيانات Demo Store أو بيانات اصطناعية).
- Offline eval: schema validity، دقة الحقائق، جودة التفسير، الأمان.
- Shadow mode قبل التفعيل: التوصيات تُحسب ولا تُعرض.
- قياس الأثر الحقيقي بعد الموافقة والتنفيذ (7/28 يومًا).
- أي تغيير prompt/model يمر ببوابة eval.

### F.10 الفشل والتدهور

- Timeout/429 → retries محدودة.
- فشل المزوّد → تعطيل مؤقت للـ AI مع استمرار التحليلات والقواعد.
- لا تعتمد الوظائف الأساسية (المزامنة، التقارير) على AI.
- Kill switch لكل مؤسسة ولكل نوع إجراء.

---

## G. الوحدات المستقبلية (Capability Map)

> كل الوحدات مخططة. الأعمدة توضح ما ستحتاجه، لا ما هو موجود.

| المجال | الوحدة | المدخلات | المخرجات | المرحلة |
|---|---|---|---|---|
| Core | Identity & Access | جلسات، عضويات | سياق مستأجر، صلاحيات | 02 |
| Core | Stores | بيانات المتجر | Store Context | 02–03 |
| Store | Store Intelligence | مبيعات، منتجات، SEO، مخزون، عملاء | Health Score + تفسير | 07 |
| Commerce | Catalog / Orders / Customers / Inventory | Salla APIs + Webhooks | نموذج موحّد | 04–05 |
| Intelligence | Sales | طلبات، تواريخ، عروض | نمو، موسمية، AOV، منتجات رابحة | 08 |
| Intelligence | Product | كتالوج + مبيعات + محتوى | أداء، جودة، دورة حياة | 09 |
| Intelligence | Inventory | كميات، مبيعات | تغطية، نفاد، راكد، إعادة طلب | 10 |
| Intelligence | Pricing | تكلفة/سعر، منافسون، طلب | نطاقات سعرية واقتراحات | 19 |
| Intelligence | Offers | عروض، كوبونات، AOV | حزم وعروض محتملة | 19 |
| Intelligence | Reviews | مراجعات | مشاعر، مواضيع، محركات تقييم | 20 |
| Growth | Growth / Conversion / AOV / Retention | تحليلات + طلبات | فرص إيراد | 18 |
| SEO | Audit / Issues | صفحات عامة، بيانات منتجات | قائمة مشكلات مرتبة | 11 |
| SEO | Keywords / Search Console | Search Console API + صفحات | خريطة كلمات، فرص ظهور | 12–13 |
| Competitors | Competitor Intelligence | مصادر عامة/مسموحة | مقارنات أسعار ومحتوى | 13 |
| Marketing | Campaigns / Meta / TikTok / Google / Email / SMS / WhatsApp | APIs لكل قناة + موافقات | حملات وتقارير | 17 |
| Content | Descriptions / Titles / ALT / Blog / Social / Ads | بيانات منتج + brand voice | مسودات قابلة للمراجعة | 16 |
| AI | Recommendation Engine | كل ما سبق | توصيات مرتبة وقابلة للتنفيذ | 14 |
| AI | Store Manager | توصيات + محادثة مقيدة | موجز يومي وقائمة إجراءات | 22 |
| AI | Gift Finder | كتالوج + مخزون + مناسبة | اقتراحات هدايا | 21 |
| Automation | Jobs / Alerts / Reports / Forecasting | أحداث + جداول | مهام وتقارير وتنبيهات | 23 |
| Governance | Approval / Action / Audit | توصيات + صلاحيات | تنفيذ موثّق + أثر | 15 |

### G.1 Store Health Score (تصميم فقط)

- مقياس 0–100 لكل مجال، ثم مرجّح ومُصدَّر بإصدار (`score_version`).
- مجالات مقترحة: Sales, Growth, Conversion, SEO, Inventory, Customers, Marketing.
- لا درجة بدون حد أدنى من البيانات؛ تُعرض «ثقة» منفصلة.
- التفسير يعرض مساهمة كل مجال، لا الدرجة فقط.
- الأوزان قابلة للضبط ولا تُعرض كحقيقة مطلقة.

### G.2 Recommendation Contract (تصميم)

```ts
interface Recommendation {
  id: string;
  storeId: string;
  problem: string;          // ماذا يحدث
  evidence: Array<{ metric: string; value: number; period: string }>;
  explanation: string;      // لماذا يهم
  proposedAction: ActionDraft;
  expectedImpact: { metric: string; direction: "up" | "down"; estimate: number; confidence: number };
  riskLevel: "low" | "high";
  reversible: boolean;
  createdAt: string;
}
```

### G.3 قياس التحويل — قيد واجب التحقق

معدل التحويل يحتاج بيانات زيارات/جلسات. وثائق Salla التجارية التي راجعناها لا تؤكد تعرّضًا لبيانات traffic كافية. لذلك:

- في Phase 07–08 تُحسب المؤشرات الممكنة من الطلبات/السلال المتروكة فقط.
- أي مؤشر يحتاج traffic يُعلَّم «غير متاح» حتى التحقق من المصدر الرسمي.
- لا تُخترع أرقام تحويل.

---

## H. Multi-Tenancy Strategy

### H.1 العلاقات

```
User ──< OrganizationMember >── Organization ──< Store ──1 SallaConnection
```

- المستخدم قد ينتمي لعدة مؤسسات.
- المؤسسة تملك متجرًا واحدًا الآن، وتصميمها يسمح بعدة متاجر لاحقًا.
- `Store` داخلي UUID؛ `SallaConnection` تحمل معرّف المتجر الخارجي والرموز المشفّرة.
- متجر Salla واحد لا يمكن ربطه بمؤسستين (فريد `(provider, external_store_id)`).

### H.2 خطوات تحديد السياق

1. قراءة الجلسة من كوكي آمن والتحقق من `sessions` (غير منتهية، غير ملغاة).
2. تحميل العضويات النشطة.
3. تحديد المؤسسة النشطة (من الجلسة) والتحقق من العضوية.
4. تحديد المتجر المطلوب (إن وُجد) والتحقق من أنه ضمن المؤسسة ومن صلاحية المستخدم.
5. بناء `TenantContext` وإمراره إلى use case.
6. ضبط `app.current_org` للمعاملة وRLS.

### H.3 الثوابت غير القابلة للكسر

- لا استعلام بلا `organization_id`/`store_id`.
- لا قبول بـ `store_id` كدليل صلاحية.
- لا كاش مشترك بين متاجر.
- لا job خلفي بلا سياق مستأجر.
- لا مخرجات AI مبنية على أكثر من متجر.

---

## I. Event-Driven Architecture

### I.1 مغلّف الحدث

| الحقل | الوصف |
|---|---|
| `id` | UUID داخلي |
| `source` | `salla` (قابل للتوسع) |
| `store_id` | UUID داخلي |
| `event_type` | مثل `order.created` (موثّق) |
| `external_event_id` | إن وفّره المصدر (غير مؤكد حاليًا) |
| `dedupe_key` | `sha256(source + store + event + hash(payload))` |
| `payload` | JSONB خام |
| `payload_hash` | SHA-256 |
| `received_at` | UTC |
| `status` | `received → verified → queued → processing → processed / failed / dead` |
| `attempts` | عدد المحاولات |
| `processed_at` | UTC |
| `last_error_code` | رمز داخلي، لا رسالة مزوّد خام |

### I.2 الخصائص

- **At-least-once** وليس exactly-once. كل handler idempotent.
- Dedupe فريد `(store_id, dedupe_key)`.
- إعادة محاولة بتباعد أسّي + dead-letter بعد الحد.
- ترتيب مضمون لكل متجر عبر seq/queue، لا عالميًا.
- Outbox للأحداث الداخلية (بعد commit) لتفادي lost updates.
- سجل أحداث غير قابل للتعديل (ما عدا حالة المعالجة).

### I.3 كتالوج أولي موثّق

أحداث Salla المتاحة (مختارة): `order.created`, `order.updated`, `order.status.updated`, `order.cancelled`, `order.refunded`, `order.deleted`, `order.products.updated`, `order.payment.updated`, `order.coupon.updated`, `order.total.price.updated`, `product.created`, `product.deleted`, `product.quantity.low`, `product.price.updated`, `product.status.updated`, `product.image.updated`, `product.category.updated`, `product.brand.updated`, `product.tags.updated`, `customer.created`, `customer.updated`, `customer.login`, `customer.otp.request`, `category.created`, `category.updated`, `brand.created`, `brand.updated`, `brand.deleted`, `store.branch.*`, `abandoned.cart`, `coupon.applied`, `invoice.created`, `specialoffer.created`, `specialoffer.updated`, `review.added`.

> `product.updated` يظهر مشطوبًا في جدول Webhooks الرسمي لكنه مذكور كمدعوم في صفحات أخرى. **يجب التحقق قبل Phase 06**؛ لا يُعتمد الآن.

### I.4 ما لا يُنفَّذ الآن

لا جدول أحداث، لا مستهلكين، لا queue. التصميم فقط.

---

## J. Operation Levels & Governance

### J.1 المستويات

| المستوى | أمثلة | موافقة | تحقق | Rollback |
|---|---|---|---|---|
| READ | تحليل، تقارير، مؤشرات | لا | — | — |
| RECOMMEND | توصية سعر/محتوى/مخزون | لا (عرض فقط) | — | — |
| LOW_RISK_WRITE | عنوان SEO، وصف، ALT، وسم | عضو مخوّل | قراءة بعد الكتابة | نعم |
| HIGH_RISK_WRITE | سعر، مخزون، حذف منتج، حالة طلب، رسالة عميل، حملة | Owner/Admin + تأكيد صريح | تحقق كامل | حسب الإجراء |

### J.2 دورة حياة الإجراء

```
proposed → validated → approval_required → approved → executing → executed
         → verified → measuring → measured → learned
                                  ↘ failed / rolled_back
```

### J.3 قواعد إلزامية

- **Action Engine هو الكاتب الوحيد** إلى Salla. لا AI ولا UI يتصلان بالـ API للكتابة مباشرة.
- كل إجراء له allowlist من العمليات + تحقق preflight (صلاحية، وجود الكيان، الحالة، الحدود).
- كل كتابة تحمل idempotency key وتُسجّل في `change_logs` قبل/بعد.
- التغييرات الجماعية فوق حد معيّن تحتاج موافقة مزدوجة (Phase 24).
- لا إرسال رسائل أو إطلاق حملات في المراحل الأولى؛ تُصمّم فقط.
- القياس يستخدم نافذة 7/28 يومًا ومقارنة مرجعية، ويذكر العوامل المربكة.

### J.4 لماذا لا يتعلم النظام من مخرجاته تلقائيًا؟

لأن «التعلم» بلا ضوابط قد يبرّر أخطاء. التعلّم المنضبط = بيانات نتائج موسومة + تقييم offline + مراجعة بشرية + إصدار جديد من القواعد/Prompts. لا تعديل ذاتي مباشر.

---

## K. Salla Integration Strategy

> التفاصيل الموثّقة بالروابط في [`salla-reference.md`](./salla-reference.md).

### K.1 القرارات

- **Custom Mode OAuth** كمسار أساسي: المستخدم يسجّل دخوله إلينا، يبدأ الربط، نولّد `state` مربوطًا بالجلسة والمؤسسة، ثم نستبدل `code` برموز.
- تخزين الرموز مشفّرة، وتجديد استباقي آمن (single-flight) قبل الانتهاء.
- جلب بيانات المتجر عبر `GET /store/info` بعد الربط، وتخزين `merchant.id`/`store.id`.
- كل Endpoint يُستخدم يُسجَّل أولًا في `salla-reference.md` (method + path + scope + تاريخ تحقق + رابط).
- لا كتابة إلى متجر حقيقي قبل اكتمال Action Engine والموافقات (Phase 15+).
- الاختبار على Demo Store رسمي، لا على متجر إنتاج.

### K.2 العميل (Design)

```
SallaClient
  ├─ auth: token provider (decrypt + refresh + lock)
  ├─ rateLimiter: per store, per plan, header-aware
  ├─ retry: 429/5xx/timeout only, jitter, max attempts
  ├─ pagination: sequential, per_page budget, cursor
  ├─ schemas: Zod per endpoint
  └─ errors: map to AppError, never log payloads/tokens
```

### K.3 نقاط مفتوحة

- الشكل الدقيق لطلب/استجابة `/oauth2/token`.
- دورة حياة سر توقيع Webhooks وإدارته.
- اعتماد Custom Mode لتطبيق App Store.
- تعارض توثيق `product.updated`.
- توفر بيانات traffic/conversion.
- واجهات Marketing APIs وScopes الخاصة بها.
- متطلبات Search Console.
- منطقة الاستضافة وPDPL.

---

## L. Observability & Operations

- **Logs**: JSON عبر pino، `requestId`/`storeId`/`organizationId`/`operation`/`status`/`durationMs`/`errorCode`. لا محتوى حساس.
- **Metrics** (لاحقًا): معدل أخطاء، كمون، عمق queue، تأخر مزامنة، فشل تجديد tokens، تكلفة AI، معدل فشل التحقق.
- **Tracing** (لاحقًا): OpenTelemetry عبر HTTP/DB/queue.
- **Alerts**: فشل Webhook متكرر، sync stuck، token invalid، AI error spike، budget 80%.
- **Runbooks**: إعادة ربط متجر، تجديد token فاشل، dead-letter، rollback إجراء.
- **Backups**: PITR، RPO 15 دقيقة، RTO 4 ساعات (أهداف أولية).
- **Migrations**: forward-only، expand/contract، لا migration عند إقلاع التطبيق.

---

## M. Testing Architecture

| النوع | النطاق | متى |
|---|---|---|
| Unit | domain، حوكمة، env، AI gateway | الآن (43 اختبارًا) |
| Integration | Postgres + repositories + use cases | Phase 02 |
| Contract | Salla client مقابل fixtures/Demo Store | Phase 03 |
| Webhook security | توقيع، dedupe، replay، retries | Phase 06 |
| E2E | تسجيل → ربط → موافقة → إجراء | Phase 15 |
| Security | عزل مستأجرين، IDOR، CSRF، input | من Phase 02 |
| AI eval | مخرجات منظمة، جودة، حقائق | Phase 14 |
| Load | مزامنة، Webhooks | Phase 24 |

سياسة البيانات: **لا بيانات إنتاج**، لا نسخ PII، كل fixtures اصطناعية أو من Demo Store.

---

## N. Deployment & Environments

| البيئة | الغرض | البيانات |
|---|---|---|
| Local | تطوير | Demo Store / بيانات اصطناعية |
| Preview | مراجعة PR | قاعدة معزولة |
| Staging | اختبار تكامل | Demo Store |
| Production | عملاء | بيانات حقيقية بموافقات |

الحاوية: تطبيق Next.js + Worker منفصل (نفس الصورة/الكود). قاعدة بيانات مُدارة. لا نشر قبل Phase 25.

---

## O. Non-Goals (Phase 01)

- لا OAuth ولا Salla API ولا Webhooks.
- لا قاعدة بيانات ولا جداول.
- لا مصادقة ولا تعدد مستأجرين مُنفَّذ.
- لا Dashboard ولا تحليلات ولا SEO ولا Marketing.
- لا مزوّد AI ولا استدعاءات فعلية.
- لا مزامنة ولا مهام خلفية.
- لا أي كتابة على متجر حقيقي.

---

## P. Open Questions

1. Custom vs Easy Mode لتطبيق Salla، ومتطلبات النشر في App Store.
2. الشكل الدقيق لتبادل الرمز `/oauth2/token`.
3. إدارة سر توقيع Webhooks ودورانه.
4. `product.updated`: مدعوم أم مهمل فعليًا؟
5. توفر بيانات الزيارات/التحويل.
6. نطاق Marketing APIs والموافقات المطلوبة.
7. متطلبات Search Console والتحقق من الملكية.
8. منطقة الاستضافة ومتطلبات PDPL.
9. نموذج التسعير والفوترة عبر Salla.
10. هل يملك التاجر عدة متاجر؟ (حقل `scopes` في Store Scopes يشير لاحتمال ذلك).

---

## Q. References

- Salla Platform Docs — <https://docs.salla.dev/>
- Salla Authorization (OAuth 2.0) — <https://docs.salla.dev/authorization>
- Salla Webhooks — <https://docs.salla.dev/webhooks>
- Salla Rate Limiting — <https://docs.salla.dev/rate-limiting>
- Salla Pagination — <https://docs.salla.dev/pagination>
- Salla Store Information — <https://docs.salla.dev/merchants/store-info>
- Salla User Information — <https://docs.salla.dev/merchants/user-info>
- سجل التحقق الكامل — [`salla-reference.md`](./salla-reference.md)

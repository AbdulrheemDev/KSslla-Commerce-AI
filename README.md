# KSHakha Commerce AI — كشخة Commerce AI

> **نظام تشغيل ذكي للتجارة الإلكترونية** لمتاجر Salla. يفهم المتجر، يحلّل أداءه، يكتشف الفرص والمشكلات، يقترح الإجراءات، ثم ينفّذها بعد موافقة صريحة ويقيس أثرها.

**الحالة الحالية:** `Phase 01 — Foundation & Architecture` مكتملة تقنيًا وبانتظار المراجعة.  
**لا يوجد اتصال بـ Salla، ولا بيانات متجر، ولا مزوّد ذكاء اصطناعي مربوط، ولا تنفيذ أي إجراءات.**

---

## ما تم في هذه المرحلة

- فحص المستودع (كان فارغًا) وتوثيق الحالة الحقيقية.
- معمارية كاملة: بيانات، أمان، تعدد مستأجرين، أحداث، AI، تكامل Salla، نشر واختبارات.
- تعريف المنتج وخارطة طريق من 25 مرحلة + مراجعة نهائية.
- سجل قرارات معمارية (ADRs) مع الأسباب والبدائل.
- أساس تقني بحد أدنى: Next.js 16 + TypeScript strict + Tailwind 4.
- طبقة إعدادات/أخطاء/سجلات مُتحقَّق منها.
- عقد طبقة AI مستقل عن المزوّد + بوابة توليد مع تحقق مخرجات وإعادة محاولة — **بلا أي مزوّد**.
- واجهة تأسيسية عربية RTL تعرض الحالة الفعلية فقط.
- اختبارات وحدة، بوابة فحص أسرار، وCI.

## ما لم يُبنَ (مقصود)

قاعدة البيانات، المصادقة، Salla OAuth، المزامنة، Webhooks، التحليلات، SEO، التسويق، الوكيل الذكي، Dashboard، وأي كتابة على متجر. تبدأ في المراحل 02+ وفق [`docs/roadmap.md`](docs/roadmap.md).

---

## البدء السريع

```bash
# Node.js 22 مطلوب (.nvmrc)
npm install
cp .env.example .env.local
npm run dev
```

- الواجهة: <http://localhost:3000>
- الصحة: <http://localhost:3000/api/health>

> لا تحتاج أي مفاتيح في Phase 01. المتغيّرات السرية معلّقة في `.env.example` حتى مراحلها.  
> **لا تضع قيمًا حقيقية في `.env.example` أو Git.**

---

## الأوامر

| الأمر | الوظيفة |
|---|---|
| `npm run dev` | تشغيل التطوير |
| `npm run build` | بناء إنتاجي |
| `npm start` | تشغيل البناء |
| `npm run lint` | ESLint (flat config) |
| `npm run typecheck` | TypeScript بلا إصدار |
| `npm test` | اختبارات Vitest |
| `npm run check:secrets` | فحص الأسرار في الملفات المتعقّبة |
| `npm run format` / `format:check` | Prettier |
| `npm run verify` | lint → typecheck → tests → secrets → build |

---

## التقنيات

| الطبقة | الاختيار |
|---|---|
| Framework | Next.js 16 (App Router) / React 19 |
| Language | TypeScript 5.9 (strict) |
| Styling | Tailwind CSS 4 (CSS-first tokens) |
| Validation | Zod 4 |
| Logging | pino (JSON + redaction) |
| Testing | Vitest 5 |
| Lint/Format | ESLint 9 + Prettier 3 |
| CI | GitHub Actions |
| Database / ORM | PostgreSQL + Drizzle — **Phase 02** |
| Auth | جلسات opaque مخصّصة — **Phase 02** |

**ملاحظة:** TypeScript 5.9 مثبّت لأن `typescript-eslint` الحالي لا يدعم 7.x. التفاصيل في ADR-003.

---

## هيكل المستودع

```text
src/
  app/                 # مسارات Next.js + /api/health
  components/          # مكوّنات عرض RTL
  config/              # بيانات المنتج والوحدات (آمنة للعميل)
  lib/
    ai/                # عقد المزوّد + السجل + البوابة (بلا مزوّد)
    env.ts             # تحقق البيئة
    errors.ts          # تصنيف الأخطاء
    logger.ts          # سجلات منظمة مع تنقية
  test/stubs/          # بديل server-only للاختبارات
docs/
  architecture.md      # المعمارية الكاملة (A–Q)
  product-spec.md      # تعريف المنتج
  roadmap.md           # 25 مرحلة + بوابات
  decisions.md         # ADRs
  salla-reference.md   # حقائق Salla الموثّقة فقط
  phase-02.md          # خطة المرحلة التالية
scripts/check-secrets.mjs
```

---

## الوثائق

- [المعمارية](docs/architecture.md) — الحالة، الأخطاء، القرارات، البيانات، الأمان، AI، الأحداث، الحوكمة.
- [تعريف المنتج](docs/product-spec.md) — المشكلة، المستخدم، الوحدات، المقاييس، الحدود القانونية.
- [خارطة الطريق](docs/roadmap.md) — 25 مرحلة بمعايير خروج.
- [القرارات](docs/decisions.md) — 28 ADR.
- [مرجع Salla](docs/salla-reference.md) — كل Endpoint/Scope مع مصدره وتاريخ التحقق.
- [Phase 02](docs/phase-02.md) — النطاق، المخطط، الأمن، الاختبارات، معايير الخروج.

---

## مبادئ غير قابلة للتفاوض

1. **AI لا ينفّذ مباشرة.** توصية → تحقق → موافقة → تنفيذ → قياس.
2. **عزل المستأجرين.** لا `store_id` من العميل كدليل صلاحية.
3. **لا Endpoint مخترع.** كل تكامل Salla موثّق ومُسجَّل.
4. **لا بيانات وهمية.** الأرقام إما حقيقية أو «غير متاحة».
5. **لا أسرار في Git.** `.env.example` فقط، وفحص آلي في CI.

---

## المساهمة والمراحل

المشروع يُبنى مرحلة بمرحلة. **Phase 01 متوقفة بانتظار المراجعة**؛ لا يبدأ OAuth أو المزامنة أو AI قبل اعتمادها. أي تغيير معماري يتطلب تحديث ADR.

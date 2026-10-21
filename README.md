# KSHakha Commerce AI — كشخة Commerce AI

> **نظام تشغيل ذكي للتجارة الإلكترونية** لمتاجر Salla. يفهم المتجر، يحلّل أداءه، يكتشف الفرص والمشكلات، يقترح الإجراءات، ثم ينفّذها بعد موافقة صريحة ويقيس أثرها.

**الحالة الحالية:** `Phase 02 — Authentication & Multi-Tenancy` منفّذة تقنيًا وبانتظار مراجعة المالك.  
**لا يوجد اتصال بـ Salla، ولا بيانات متجر، ولا تحليلات، ولا مزوّد ذكاء اصطناعي مربوط، ولا كتابة على أي متجر.**

---

## ما تم في Phase 02

- **PostgreSQL + Drizzle**: سبعة جداول (`users`, `organizations`, `organization_members`, `invitations`, `stores`, `sessions`, `audit_logs`) وهجرتان: بنية + سياسات RLS.
- **مصادقة**: تسجيل/دخول/خروج بجلسات مخزّنة في قاعدة البيانات، كلمات مرور `scrypt`، رموز عشوائية يُخزَّن HMAC-SHA256 منها فقط، وكوكي `__Host-ksh_session` (`HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`).
- **تعدد مستأجرين**: `TenantContext` مشتق من الجلسة فقط (Session → Organization → Membership → Role)، وRLS بـ `FORCE` على أربعة جداول، واختبارات عزل حقيقية.
- **RBAC**: خمسة أدوار (Owner/Admin/Manager/Analyst/Viewer) وخمسة عشر صلاحية، مع منع تصعيد الصلاحيات وإزالة آخر مالك.
- **دعوات**: رموز لمرة واحدة تنتهي بعد 7 أيام، مربوطة ببريد المدعو.
- **حماية الطلبات**: CSRF (Origin/Referer + double-submit token)، حدّ معدّل للدخول/التسجيل/الدعوات، وأخطاء موحّدة 401/403/404/409/422/429.
- **تدقيق**: أحداث `user.*`, `organization.*`, `member.*`, `store.created`, `session.revoked` بلا كلمات مرور أو رموز أو PII غير لازمة.
- **واجهة عربية RTL**: دخول، تسجيل، تهيئة، مساحة مؤسسة، أعضاء، متاجر، وقبول دعوة — بحالة صريحة `Salla: Not Connected`.
- **اختبارات**: 64 اختبار وحدة + 32 اختبار تكامل/أمن على PostgreSQL حقيقي.

## ما لم يُبنَ (مقصود)

Salla OAuth أو أي اتصال متجر، مزامنة بيانات، Webhooks، منتجات/طلبات/عملاء/مخزون، SEO، تسويق، وكيل ذكاء اصطناعي، تحليلات، Dashboard، أو أي كتابة على متجر. تبدأ في المراحل 03+ وفق [`docs/roadmap.md`](docs/roadmap.md).

---

## البدء السريع

```bash
# Node.js 22 مطلوب (.nvmrc)
npm install
cp .env.example .env.local

# في .env.local: عيّن DATABASE_URL و AUTH_SECRET (32 حرفًا على الأقل)
# مثال محلي (PostgreSQL 16 أو أحدث):
#   DATABASE_URL=postgresql://user:password@localhost:5432/kshakha_dev
#   AUTH_SECRET=<openssl rand -base64 32>

npm run db:migrate   # يطبّق drizzle/0000_init.sql ثم 0001_rls.sql
npm run dev
```

- الواجهة: <http://localhost:3000>
- الصحة: <http://localhost:3000/api/health>
- بدون `DATABASE_URL` تعمل الصفحة التعريفية و`/api/health` (بحالة `not_configured`)، لكن التسجيل والدخول يحتاجان قاعدة بيانات.

> لا تُضاف أي أسرار إلى المستودع. `.env.example` يسرد **أسماء** المتغيّرات فقط.

## الاختبارات

| الأمر | ماذا يفعل |
|---|---|
| `npm test` | 64 اختبار وحدة (كلمات مرور، رموز، صلاحيات، تحقق من المدخلات، حدود المعدّل) |
| `npm run test:integration` | 32 اختبار تكامل/أمن على **PostgreSQL حقيقي** (تشغيل تلقائي عبر `embedded-postgres` محليًا) |
| `npm run verify` | تنسيق + lint + أنواع + كل الاختبارات + فحص الأسرار + بناء إنتاجي |

`test:integration` يشغّل PostgreSQL 18 محليًا على المنفذ `55432` في `.pgdata-test/` (مُستثنى من Git)، وينشئ دورًا غير مالك `ksh_app` حتى تُفرض سياسات RLS فعليًا. في CI يُستخدم خدمة `postgres:16` عبر `TEST_DATABASE_URL`.

## الأمان (ملخّص)

- `scrypt` بمعاملات `N=16384, r=8, p=1, keylen=64`, salt عشوائي 16 بايت، ومقارنة `timingSafeEqual`.
- جلسة خمول 7 أيام وحد أقصى 30 يومًا، تحديث `last_seen_at` مخفّف، وإبطال فوري.
- كل كتابة تمرّ بفحص صلاحية داخل use case، وليس في الواجهة فقط.
- معرّف المتجر القادم من العميل يُعامل كطلب لا كدليل؛ المتجر العائد لمؤسسة أخرى = **404**.
- سجل التدقيق append-only (لا سياسات UPDATE/DELETE). السجلات لا تحتوي كلمات مرور أو رموزًا.
- السجلات تسجّل رموز أخطاء فقط عند 5xx، لا رسائل قاعدة البيانات التي قد تحوي قيمًا.

## بنية المستودع

```text
src/
├── app/                 # صفحات عربية RTL + 13 Route Handler
├── components/          # واجهة (auth, app, brand, status)
├── db/                  # schema, client, tenant transaction, migrations
├── modules/
│   ├── identity/        # scrypt, tokens, permissions, auth-service
│   ├── organizations/   # memberships, invitations
│   ├── stores/          # internal store records
│   └── audit/           # append-only audit log
├── server/              # CSRF, rate limit, session, API envelope
└── test/                # embedded PostgreSQL harness + integration tests
drizzle/                 # 0000_init.sql, 0001_rls.sql (مراجَعة يدويًا)
docs/                    # architecture, product-spec, roadmap, decisions, salla-reference, phase-02
```

## الوثائق

- [`docs/architecture.md`](docs/architecture.md) — المعمارية الكاملة (مصدر الحقيقة).
- [`docs/product-spec.md`](docs/product-spec.md) — تعريف المنتج.
- [`docs/roadmap.md`](docs/roadmap.md) — 25 مرحلة وبوابات G1–G5.
- [`docs/decisions.md`](docs/decisions.md) — 33 قرارًا معماريًا بالسبب والبدائل.
- [`docs/salla-reference.md`](docs/salla-reference.md) — حقائق Salla الموثّقة فقط.
- [`docs/phase-02.md`](docs/phase-02.md) — خطة Phase 02 وملاحظات التنفيذ.

## السكربتات

| السكربت | الوصف |
|---|---|
| `dev` / `build` / `start` | Next.js 16 |
| `lint` / `lint:fix` | ESLint 9 |
| `typecheck` | TypeScript strict |
| `format` / `format:check` | Prettier |
| `test` / `test:watch` | Vitest (وحدة) |
| `test:integration` | Vitest + PostgreSQL حقيقي |
| `check:secrets` | فحص الملفات المتعقّبة |
| `db:generate` / `db:migrate` / `db:studio` | Drizzle |
| `verify` | البوابة الكاملة قبل الاعتماد |

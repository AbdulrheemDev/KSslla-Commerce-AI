# KSHakha Commerce AI — كشخة Commerce AI

> **نظام تشغيل ذكي للتجارة الإلكترونية** لمتاجر Salla. يفهم المتجر، يحلّل أداءه، يكتشف الفرص والمشكلات، يقترح الإجراءات، ثم ينفّذها بعد موافقة صريحة ويقيس أثرها.

**الحالة الحالية:** `Phase 05 — Orders + Customers + Inventory Foundation` منفّذة تقنيًا وبانتظار مراجعة المالك.  
**لا Webhooks، ولا تحليلات أو توقعات، ولا مزوّد ذكاء اصطناعي مربوط، ولا كتابة على أي متجر.**  
**لم يُختبر الاستدعاء الحقيقي لـ Salla:** لا مفاتيح تطبيق ولا Demo Store في هذه البيئة؛ كل الاختبارات بروتوكولية على محاكي محلي.

---

## ما تم في Phase 05

- **مزامنة قراءة للطلبات والعملاء والمخزون:** `GET /admin/v2/orders`، `GET /admin/v2/customers`، `GET /admin/v2/products/quantities` — كلها GET فقط، بلا مسار كتابة وبلا Endpoint غير موثّق.
- **قاعدة بيانات:** `customers`, `orders`, `order_items`, `inventory_levels` مع RLS على الأربعة، مفاتيح فريدة `(store_id, external_customer_id)` و`(store_id, external_order_id)`، وسطور طلب بمفتاح `(order_id, line_number)`.
- **طرح الطلبات الموثّق:** صفحة 1→2→3 دون قفز، `per_page=30`، بلا `expanded`، وإيقاف عند نهاية `totalPages` أو عند انتهاء نافذة 15 دقيقة.
- **مشغّل مزامنة مشترك:** `paged-sync.ts` يحمل القفل والمعاملة لكل صفحة وإعادة المحاولة وتجديد الرمز، وكل مورد يمرّر «ماذا نقرأ وكيف نحفظ» فقط. الترتيب في «الكل»: عملاء ← طلبات ← مخزون.
- **قفل قاعدة بيانات لكل (متجر، مورد):** لا حالة في الذاكرة؛ «الكل» يحجز الثلاثة ويحرّرها كلها عند الفشل.
- **صدق البيانات:** بنود الطلبات تُحفظ بما هو موثّق (اسم + كمية) وتُعلَّم `no_product_reference`، وحقول العملاء غير الموجودة في القائمة تظهر «—» بدل اختراع قيمة.
- **PII:** لا حمولة خام لطلبات أو عملاء، ولا كلمات مرور/بطاقات/بيانات بنكية (ADR-043).
- **واجهة عربية RTL:** `/app/orders`, `/app/customers`, `/app/inventory` بأرقام من PostgreSQL فقط، وحالات فراغ/مزامنة/خطأ حقيقية، وأزرار مزامنة محكومة بـ`store:sync`.
- **الوثائق:** ADR-042 (السكوبات وإعادة الربط)، ADR-043 (ربط البنود، PII، سياسة المخزون)، ADR-044 (المشغّل المشترك)، وسجل أدلة §12 في `docs/salla-reference.md`.

## ما تم في Phase 04

- **مزامنة كتالوج للقراءة فقط:** `GET /admin/v2/products` و`GET /admin/v2/categories` عبر عميل مقيد بطريقتين فقط، لا مسار كتابة ولا Endpoint غير موثّق.
- **نموذج بيانات محلي:** `products`, `categories`, `product_categories`, `sync_runs`, `sync_locks` مع RLS، مفاتيح خارجية فريدة `(store_id, external_id)`، وعلاقة many-to-many بمركّب أساسي.
- **مزامنة آمنة وقابلة للتوسع:** ترتيب Categories → Products، معاملة لكل صفحة، upsert idempotent، ترقيم تسلسلي مع حراسة حلقات، وإعادة محاولة محدودة (شبكة/429/5xx فقط).
- **قفل واحد لكل متجر:** lease في قاعدة البيانات بمُهلة 120 ثانية؛ عشرة طلبات متزامنة تنتج تشغيلًا واحدًا وتسعة `409`.
- **لا حذف هدمي:** `last_seen_at` يُسجَّل، والصف يبقى عند غيابه من القائمة؛ لا استنتاج حذف بلا دليل موثّق.
- **حالة مزامنة صادقة:** `never/running/succeeded/failed` مع `last_success_at`, `last_error_code`, عدّادات الصفحات والعناصر، و`correlationId` لكل تشغيل.
- **سكوبات دنيا:** `offline_access`, `products.read`, `categories.read`؛ وكل اتصال قديم يحتاج إعادة ربط واحدة (يفحصه الخادم ويطلبه صراحةً).
- **واجهة عربية RTL:** بطاقة «بيانات التجارة» بأرقام من قاعدة البيانات، قائمة منتجات ببحث وترقيم، صفحة تفاصيل محلية، وقائمة تصنيفات بعدد منتجات محسوب فعليًا.
- **اختبارات:** 179 وحدة + 101 تكامل/أمن (منها 22 للكتالوج، 13 للطلبات/العملاء/المخزون: 67 طلبًا من 3 صفحات، ثلاث مزامنات بلا تكرار، عزل مستأجر، RBAC، 429، 500، و9 لـCSRF/العزل).
- **الوثائق:** ADR-038 (نموذج المزامنة)، ADR-039 (القفل والترقيم وإعادة المحاولة)، ADR-040 (توسيع السكوبات)، وسجل أدلة كامل في `docs/salla-reference.md` §10–§11.

## ما تم في Phase 03

- **ربط Salla عبر OAuth 2.0 (Custom Mode):** بدء تفويض مُقيّد بالجلسة والمؤسسة والمتجر والصلاحية، ثم callback يتحقق من `state` ويستهلكه مرة واحدة، ويبادل الرمز خادميًا.
- **نموذج اتصال منفصل:** جدول `store_connections` (لا رموز في `stores`)، مع `UNIQUE(store_id, provider)` و`UNIQUE(provider, external_store_id)` لمنع تكرار أو ازدواج الربط.
- **تشفير الرموز:** AES-256-GCM، nonce جديد لكل قيمة، AAD يربط الصف بالمؤسسة والمتجر، مفتاح من `ENCRYPTION_KEY` بلا بديل.
- **تجديد آمن:** refresh tokens في Salla أحادية الاستخدام، لذا يوجد قفل تجديد في قاعدة البيانات يضمن **تجديدًا واحدًا فقط** حتى مع عشرة طلبات متزامنة، مع تدوير الزوج وتصنيف الفشل (مؤقت مقابل `invalid_grant`).
- **واجهة عربية RTL:** بطاقة ربط داخل صفحة المتجر تعرض الحالة الحقيقية، وتتيح الربط/إعادة الربط/الفصل حسب الصلاحية، بلا أي رموز أو أسرار.
- **تدقيق:** `salla.authorization.*`, `salla.connection.*`, `salla.token.*` بلا رموز أو أكواد.
- **اختبارات:** 106 وحدة + 62 تكامل/أمن على PostgreSQL حقيقي (منها 30 لـ Salla، بمحاكي بروتوكول محلي).
- **الوثائق:** ADR-034 (Easy/Custom)، ADR-035 (النموذج والتشفير والقفل)، وسجل أدلة كامل في `docs/salla-reference.md` §8–§9.

**قرار الوضع:** Custom Mode هو المنفَّذ الآن لأنه المسار القابل للتحقق الآلي؛ ووثائق Salla تنص على أن **Easy Mode وحده مسموح للتطبيقات المنشورة** وأن Custom Mode «للاختبار». النشر في App Store يستلزم استقبال Webhook `app.store.authorize`، وهو خارج نطاق هذه المرحلة، والمعمارية لا تتطلب إعادة بناء للانتقال إليه.

## ما تم في Phase 02

- **PostgreSQL + Drizzle**: سبعة جداول (`users`, `organizations`, `organization_members`, `invitations`, `stores`, `sessions`, `audit_logs`) وهجرتان: بنية + سياسات RLS.
- **مصادقة**: تسجيل/دخول/خروج بجلسات مخزّنة في قاعدة البيانات، كلمات مرور `scrypt`، رموز عشوائية يُخزَّن HMAC-SHA256 منها فقط، وكوكي `__Host-ksh_session` (`HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`).
- **تعدد مستأجرين**: `TenantContext` مشتق من الجلسة فقط (Session → Organization → Membership → Role)، وRLS بـ `FORCE` على أربعة جداول، واختبارات عزل حقيقية.
- **RBAC**: خمسة أدوار (Owner/Admin/Manager/Analyst/Viewer) وستة عشر صلاحية (منها `store:sync` منذ Phase 04)، مع منع تصعيد الصلاحيات وإزالة آخر مالك.
- **دعوات**: رموز لمرة واحدة تنتهي بعد 7 أيام، مربوطة ببريد المدعو.
- **حماية الطلبات**: CSRF (Origin/Referer + double-submit token)، حدّ معدّل للدخول/التسجيل/الدعوات، وأخطاء موحّدة 401/403/404/409/422/429.
- **تدقيق**: أحداث `user.*`, `organization.*`, `member.*`, `store.created`, `session.revoked` بلا كلمات مرور أو رموز أو PII غير لازمة.
- **واجهة عربية RTL**: دخول، تسجيل، تهيئة، مساحة مؤسسة، أعضاء، متاجر، وقبول دعوة — بحالة صريحة `Salla: Not Connected`.
- **اختبارات**: 64 اختبار وحدة + 32 اختبار تكامل/أمن على PostgreSQL حقيقي.

## ما لم يُبنَ (مقصود)

مزامنة طلبات/عملاء/مخزون، Webhooks عامة أو `app.store.authorize`، SEO، تسويق، وكيل ذكاء اصطناعي، تحليلات، Dashboard، أو أي كتابة على متجر. تبدأ في المراحل 05+ وفق [`docs/roadmap.md`](docs/roadmap.md).

---

## البدء السريع

```bash
# Node.js 22 مطلوب (.nvmrc)
npm install
cp .env.example .env.local

# في .env.local: عيّن DATABASE_URL و AUTH_SECRET و ENCRYPTION_KEY
# مثال محلي (PostgreSQL 16 أو أحدث):
#   DATABASE_URL=postgresql://user:password@localhost:5432/kshakha_dev
#   AUTH_SECRET=<openssl rand -base64 32>
#   ENCRYPTION_KEY=<openssl rand -hex 32>

npm run db:migrate   # يطبّق 0000_init ثم 0001_rls ثم 0002_store_connections ثم 0003_salla_rls
npm run dev
```

- الواجهة: <http://localhost:3000>
- الصحة: <http://localhost:3000/api/health>
- بدون `DATABASE_URL` تعمل الصفحة التعريفية و`/api/health` (بحالة `not_configured`)، لكن التسجيل والدخول يحتاجان قاعدة بيانات.

> لا تُضاف أي أسرار إلى المستودع. `.env.example` يسرد **أسماء** المتغيّرات فقط.

## الاختبارات

| الأمر | ماذا يفعل |
|---|---|
| `npm test` | 146 اختبار وحدة (كلمات مرور، رموز، صلاحيات، تشفير، حالة OAuth، صلاحية الرموز، إعداد Salla، DTO، مappers، ترقيم، إعادة محاولة) |
| `npm run test:integration` | 101 اختبار تكامل/أمن على **PostgreSQL حقيقي** (منها 67 لـ Salla بمحاكي بروتوكول محلي) |
| `npm run verify` | تنسيق + lint + أنواع + كل الاختبارات + فحص الأسرار + بناء إنتاجي |

`test:integration` يشغّل PostgreSQL 18 محليًا على المنفذ `55432` في `.pgdata-test/` (مُستثنى من Git)، وينشئ دورًا غير مالك `ksh_app` حتى تُفرض سياسات RLS فعليًا. في CI يُستخدم خدمة `postgres:16` عبر `TEST_DATABASE_URL`.

## الأمان (ملخّص)

- `scrypt` بمعاملات `N=16384, r=8, p=1, keylen=64`, salt عشوائي 16 بايت، ومقارنة `timingSafeEqual`.
- جلسة خمول 7 أيام وحد أقصى 30 يومًا، تحديث `last_seen_at` مخفّف، وإبطال فوري.
- كل كتابة تمرّ بفحص صلاحية داخل use case، وليس في الواجهة فقط.
- معرّف المتجر القادم من العميل يُعامل كطلب لا كدليل؛ المتجر العائد لمؤسسة أخرى = **404**.
- سجل التدقيق append-only (لا سياسات UPDATE/DELETE). السجلات لا تحتوي كلمات مرور أو رموزًا.
- رموز Salla مشفّرة بـ AES-256-GCM مع AAD للمستأجر، ولا تظهر في أي استجابة أو سجل. `state` يُخزَّن كـ HMAC فقط ويُستهلك مرة واحدة.
- التجديد محمي بقفل صف في قاعدة البيانات؛ refresh token لا يُستخدم مرتين أبدًا.
- السجلات تسجّل رموز أخطاء فقط عند 5xx، لا رسائل قاعدة البيانات التي قد تحوي قيمًا.

## بنية المستودع

```text
src/
├── app/                 # صفحات عربية RTL + Route Handlers
├── components/          # واجهة (auth, app, brand, status)
├── db/                  # schema, client, tenant transaction, migrations
├── modules/
│   ├── identity/        # scrypt, tokens, permissions, auth-service
│   ├── organizations/   # memberships, invitations
│   ├── stores/          # internal store records
│   ├── catalog/         # DTO, mappers, repositories, read + sync services
│   ├── integrations/    # Salla: domain / application / infrastructure
│   └── audit/           # append-only audit log
├── server/              # CSRF, rate limit, session, API envelope
└── test/                # embedded PostgreSQL harness + integration tests
drizzle/                 # 0000_init … 0005_catalog_rls (6 migrations)
docs/                    # architecture, product-spec, roadmap, decisions, salla-reference, phase-02…04
```

## الوثائق

- [`docs/architecture.md`](docs/architecture.md) — المعمارية الكاملة (مصدر الحقيقة).
- [`docs/product-spec.md`](docs/product-spec.md) — تعريف المنتج.
- [`docs/roadmap.md`](docs/roadmap.md) — 25 مرحلة وبوابات G1–G5.
- [`docs/decisions.md`](docs/decisions.md) — 40 قرارًا معماريًا بالسبب والبدائل.
- [`docs/salla-reference.md`](docs/salla-reference.md) — حقائق Salla الموثّقة فقط.
- [`docs/phase-03.md`](docs/phase-03.md) — تنفيذ Phase 03: وضع OAuth، الرموز، القفل، الاختبارات، القيود.
- [`docs/phase-04.md`](docs/phase-04.md) — تنفيذ Phase 04: نموذج الكتالوج، المزامنة، الترقيم، القفل، الواجهة، الاختبارات.
- [`docs/phase-05.md`](docs/phase-05.md) — تنفيذ Phase 05: الطلبات والعملاء والمخزون، المشغّل المشترك، الخصوصية، القيود، الاختبارات.
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

# Phase 04 — Products + Categories Sync

> **الحالة:** منفّذة ومُختبرة بروتوكوليًا على محاكي Salla محلي + PostgreSQL حقيقي. **لم يُختبر الاستدعاء الحقيقي لـ Salla** لعدم توفر مفاتيح تطبيق أو متجر تجريبي.
>
> **الجملة المعتمدة:** Product/Category protocol behavior is tested against a local Salla contract simulator; live Salla verification is pending credentials.

---

## 1. الهدف

بناء **أساس بيانات التجارة** المحلي: قراءة المنتجات والتصنيفات من متجر Salla المرتبط، وتطبيعها، وتخزينها بشكل آمن وقابل للتوسع، مع حالة مزامنة صادقة تصلح للاعتماد عليها في المراحل التالية.

```
Organization → Store → Salla Connection → Access Token Manager
            → Merchant API → Products / Categories → Normalization
            → PostgreSQL → Sync State
```

**خارج النطاق صراحةً:** الطلبات، العملاء، المخزون، المراجعات، SEO، الكلمات المفتاحية، المنافسون، التسعير، العروض، الحملات، الإعلانات، الذكاء الاصطناعي، وأي كتابة إلى Salla.

---

## 2. حدود المرحلة

| مبدأ | التنفيذ |
|---|---|
| قراءة فقط | لا يوجد أي `POST/PUT/PATCH/DELETE` إلى Merchant API. العميل يحوي طريقتين GET فقط |
| لا وصول مباشر للرموز | المزامنة تستدعي `getAccessToken()` حصرًا؛ لا `decryptAccessToken` في أي مسار |
| لا ثقة بمعرّفات العميل | المتجر يُحل من الجلسة ← العضوية ← المؤسسة؛ معرّف أجنبي = 404 |
| لا بيانات وهمية | الأرقام من PostgreSQL؛ متجر غير مُزامن يقول «لم تتم المزامنة» ولا يعرض صفرًا موهمًا |
| لا ادعاء اختبار حقيقي | كل الاختبارات على محاكي بروتوكول محلي |

---

## 3. المراجع الرسمية

سجل الأدلة الكامل (Endpoint / Purpose / Method / Scope / Pagination / Response / Rate limit / Source / Verified At / Impact) في [`salla-reference.md` §10](./salla-reference.md).

| المرجع | ما أُخذ منه |
|---|---|
| https://docs.salla.dev/5394168e0 | `GET /admin/v2/products`، `products.read`، شكل الاستجابة، `format=light` |
| https://docs.salla.dev/api-5394207 | `GET /admin/v2/categories`، `categories.read`، `parent_id=0`، `update_at` |
| https://docs.salla.dev/pagination | كتلة `pagination`، حد `per_page` = 60 |
| https://docs.salla.dev/rate-limiting | Plus 120 / Pro 360 / Special 720 لكل دقيقة، `Retry-After` |
| https://docs.salla.dev/responses | 401 حتى مع سكوب غير ممنوح؛ 429؛ 5xx |
| https://docs.salla.dev/ | `https://api.salla.dev/admin/v2` كأساس لكل المسارات |

التعارضات (per_page مقابل count، المنطقة الزمنية، غياب `slug`، حالة المنتج غير المغلقة) موثّقة في `salla-reference.md` §11، وقراراتها محافظة.

---

## 4. السكوبات

| Scope | السبب | كتابة؟ |
|---|---|---|
| `offline_access` | تجديد الرمز (Phase 03) | لا |
| `products.read` | `GET /products` | لا |
| `categories.read` | `GET /categories` | لا |

لم يُطلب أي سكوب كتابة أو سكوب لمرحلة لاحقة. الاتصال المُنشأ قبل Phase 04 لا يحمل سكوبي القراءة، لذلك:

- تُفحص `connection.scopes` محليًا **قبل** أي نداء،
- يُعاد `409 INTEGRATION_AUTH_REQUIRED` مع `reason: missing_scope`،
- والواجهة تطلب إعادة الربط برسالة صريحة.

---

## 5. قاعدة البيانات

### 5.1 الجداول الجديدة

| الجدول | الغرض | قيود أساسية |
|---|---|---|
| `categories` | مرآة محلية للتصنيفات | `UNIQUE(store_id, external_category_id)`, FK أب داخل نفس المتجر |
| `products` | مرآة محلية للمنتجات | `UNIQUE(store_id, external_product_id)` |
| `product_categories` | علاقة many-to-many | `PRIMARY KEY(product_id, category_id)` |
| `sync_runs` | سجل كل تشغيل | فهرس `(store_id, resource, started_at)` |
| `sync_locks` | lease لمنع التزامن | `UNIQUE(store_id, resource)` + `expires_at` |

### 5.2 الحقول المشتركة

- `organization_id` و`store_id` على كل جدول — للعزل ولـ RLS بلا joins.
- `last_seen_at` — آخر ظهور ناجح في Salla (لا يعني الحذف).
- `metadata JSONB` صغير ومحدَّد (روابط، بيانات وصفية، `show_in`) — لا يعتمد عليه حقل في المجال.
- `created_at`/`updated_at` محليان، و`source_updated_at` من المزوّد.

### 5.3 الهجرات

- `0004_products_categories.sql` — الجداول والقيود والفهارس (مولّدة من Drizzle).
- `0005_catalog_rls.sql` — `ENABLE` + `FORCE ROW LEVEL SECURITY` وسياسات CRUD لكل جدول.
- الإجمالي الآن **6 هجرات** (0000–0005)، وتُطبَّق من قاعدة فارغة في كل تشغيل لاختبارات التكامل.
- **تحقق فعلي (2026-10-22):** قاعدة على مخطط Phase 03 (0000–0003) مع صف في كل من `stores` و`store_connections` و`oauth_states`، ثم تطبيق 0004–0005: بقيت الصفوف كما هي (1/1/1)، وأُنشئت الجداول الخمسة، وRLS مُفعَّل ومفروض على الخمسة.
- **تحقق فعلي (2026-10-22):** قاعدة فارغة + كل الهجرات ⇒ 6 هجرات مطبقة و14 جدولًا.
- لا تعديل على هجرات Phase 02/03؛ الاستراتيجية الأمامية فقط.

---

## 6. نموذج المنتج

| العمود | المصدر | ملاحظة |
|---|---|---|
| `external_product_id` | `id` | نصّي، معرّف Salla الرسمي |
| `name` | `name` | إلزامي |
| `sku` | `sku` | `""` → `NULL` |
| `product_type` | `type` | مثال موثّق: `product` |
| `status` | `status` | نصّي كما هو (`sale`, `hidden`, …) |
| `price_amount` | `price.amount` | `numeric(14,2)`؛ نص عشري لا float |
| `currency` | `price.currency` | `SAR` |
| `regular_price_amount` | `regular_price.amount` | `{}` → `NULL` |
| `sale_price_amount` | `sale_price.amount` | `{}` → `NULL` |
| `quantity` | `quantity` | `"50"` → `50` |
| `is_available` | `is_available` | افتراضي `false` |
| `url`, `image_url` | `url`, `main_image`/`thumbnail` | |
| `description` | `description` | `"  "` → `NULL` |
| `brand_name` | `brand.name` | `brand` قد يكون `{}` |
| `source_updated_at` | `updated_at` | طابع مزوّد، للكشف عن التغيّر فقط |

`options` و`skus` (مخزون/متغيّرات) **لا تُقرأ** في هذه المرحلة.

---

## 7. نموذج التصنيف

| العمود | المصدر |
|---|---|
| `external_category_id` | `id` |
| `name` | `name` |
| `parent_external_id` | `parent_id` (`0` → `NULL`) |
| `parent_category_id` | يُحل محليًا داخل نفس المتجر |
| `status` | `status` (`active`/`hidden`) |
| `sort_order` | `sort_order` |
| `image_url` | `image` |
| `source_updated_at` | `update_at` |

لا يوجد `slug` في الاستجابة؛ لم يُخترع حقل بديل.

---

## 8. العلاقات

- `product_categories` بمركّب أساسي `(product_id, category_id)`.
- تُستبدل روابط المنتجات الواردة في الصفحة فقط، لذا إزالة تصنيف من منتج في Salla تنعكس محليًا.
- معرّف تصنيف غير معروف محليًا (لم يُزامَن بعد) **لا يُنشئ صفًا وهميًا**؛ يُتجاهل ويُحصى في `items_skipped`.
- ترتيب Categories → Products إلزامي لأن الربط يحتاج الصفين.

---

## 9. الترقيم (Pagination)

- نطلب الصفحات **تسلسليًا** (`page=1,2,3…`) مع `per_page=30` (الحد الموثّق 60).
- نعتمد `pagination.currentPage`/`totalPages` من الاستجابة.
- حراسة صريحة تمنع الحلقات:
  - صفحة مطلوبة ≠ صفحة معادة → `out_of_order`
  - صفحة مكرّرة (بصمة المعرّفات) → `repeat`
  - صفحة فارغة قبل الأخيرة → `empty`
  - تجاوز 200 صفحة → `limit`
- أي حراسة تُطلق `SallaInvalidResponseError` وتُفشل التشغيل بدل التكرار إلى ما لا نهاية.

---

## 10. حدود المعدل

- لا رقم مضمّن في الكود؛ الحدود حسب خطة المتجر (120/360/720 في الدقيقة).
- `429` → قراءة `Retry-After` والانتظار **بالقيمة نفسها** ثم إعادة المحاولة ضمن سقف المحاولات؛ إذا طلب المزوّد انتظارًا أطول من 30 ثانية يتوقف التشغيل بدل إعادة المحاولة مبكرًا.
- الصفحات متسلسلة؛ لا طلبات متوازية على نفس المتجر.

---

## 11. إعادة المحاولة

| الحالة | إعادة المحاولة |
|---|---|
| شبكة/timeout | ✅ حتى 3 محاولات |
| 429 | ✅ بعد `Retry-After` بالضبط؛ يُرفض التشغيل إن تجاوز 30 ثانية |
| 5xx | ✅ تأخير أسّي 0.5s/1s |
| 400 / 401 / 403 / 404 / 422 | ❌ |
| مخالفة مخطط | ❌ (`invalid_response`) |

مسار 401 منفصل: تجديد واحد عبر `getAccessToken({forceRefresh:true})` ثم إعادة الطلب **مرة واحدة**. إن تكرر → `reauth_required` على الاتصال.

---

## 12. قفل المزامنة

- `sync_locks(store_id, resource)` مع `lock_id` و`expires_at`.
- الاستحواذ عبارة عن `INSERT … ON CONFLICT DO UPDATE … WHERE expires_at <= now()` — فائز واحد.
- المُهلة 120 ثانية وتُجدَّد بعد كل صفحة.
- **ممر واحد لكل متجر:** مورد القفل هو `catalog`، ويُستحوذ عليه مرة واحدة للطلب كله ويُحرَّر في `finally`. لذا لا يتزامن `categories` مع `products` ولا مع `all` لنفس المتجر، ولو جاءت الطلبات من تبويبات مختلفة.
- عامل متوقف: تنتهي المُهلة ويستطيع طلب لاحق الاستحواذ.
- خسارة المُهلة أثناء التشغيل تُوقف التشغيل (`lease_lost`) بدل الكتابة بلا قفل.
- 10 طلبات متزامنة لنفس المورد ⇒ تشغيل واحد + 9 × `409 CONFLICT (sync_in_progress)`. واختبار مستقل يثبت أن طلب `products` يُرفض بـ`409` أثناء تشغيل `categories` لنفس المتجر.

### 12.1 حالة المزامنة

`sync_runs` هو المصدر الوحيد للحالة، ولا جدول حالة موازٍ:

| الحقل | المعنى |
|---|---|
| `status` | `running` / `succeeded` / `failed`، والواجهة تضيف `never` قبل أول تشغيل |
| `started_at` | `lastStartedAt` |
| `finished_at` | `lastCompletedAt` |
| `last_success_at` | من آخر تشغيل `succeeded` (لا يتغيّر عند الفشل) |
| `last_failure_at` | من آخر تشغيل `failed` |
| `last_error_code` | رمز مختصر (`rate_limited`, `provider_error`, …) لا رسالة مزوّد |
| `items_processed`, `pages_processed` | عدّادات متراكمة تُحدَّث داخل معاملة كل صفحة |
| `correlation_id`, `sync_run_id` | في كل سجل وحدث تدقيق |

---

- كل كتابة `INSERT … ON CONFLICT (store_id, external_id) DO UPDATE`.
- إعادة المزامنة لا تُنشئ تكرارًا؛ التقرير يعرض `created=0`, `updated=N`.
- اختبار صريح: تشغيلان متتاليان ⇒ عدد صفوف ثابت.

---

## 14. تدفّق المزامنة

```
POST /catalog/sync {resource: all|products|categories}
  → session → store:sync → store within org
  → connection connected + scopes present
  → acquire lease → create sync_run → audit started
  → for each page (sequential):
        getAccessToken (refresh if needed)
        GET page → Zod validate → DTO → mapper
        transaction: upsert rows + replace links + increment counters
        renew lease
  → finish run (succeeded/failed) → audit → release lease
```

- `all` = categories ثم products.
- فشل categories يوقف الطلب قبل products (لا نقطع بيانات نصف مرتبطة).
- فشل صفحة لاحقة يُبقي الصفحات المكتملة، ويُسجّل التشغيل `failed`.
- جسم غير صالح (`resource` غير مدعوم) يعيد `422 VALIDATION_FAILED` بصيغة خطأ موحّدة `{error:{code,message}}`، لا غلاف نجاح.

### 14.1 واجهات HTTP

| الطريقة | المسار | الصلاحية | الاستجابة |
|---|---|---|---|
| `POST` | `/api/organizations/current/stores/{storeId}/catalog/sync` | `store:sync` + CSRF | ملخّص التشغيل (`status`, `pages`, `items`, عدّادات) |
| `GET` | نفس المسار | `store:read` | **حالة المزامنة**: عدّادات المنتجات/التصنيفات وآخر تشغيل لكل مورد (يخدم «GET sync status» في المواصفة) |
| `GET` | `…/catalog/products` | `store:read` | صفحة منتجات (بحث/ترقيم) |
| `GET` | `…/catalog/categories` | `store:read` | صفحة تصنيفات (ترقيم) |

لا يقبل أي مسار `organizationId` من العميل؛ المتجر يُحلّ من الجلسة، ومعرّف أجنبي يعيد 404.

---

## 15. الحذف

**لا حذف تلقائي.** لا توثّق Salla enumerator موثوقًا للمحذوف عبر هذين المسارين. يُسجَّل `last_seen_at` عند كل ظهور، ويبقى الصف إن اختفى. أي سياسة حذف مستقبلية تحتاج ADR ودليلًا رسميًا.

---

## 16. الأمان والعزل

- RLS على الجداول الخمسة (`FORCE`) بسياسة `organization_id = app.current_organization_id()`.
- كل استعلام داخل `withTenantTransaction` يحمل المؤسسة.
- معرّف متجر أجنبي → 404 (لا تمييز عن غير الموجود).
- الجداول المالية/الوصفية لا تُسجَّل في أي log.
- `metadata` لا يحوي رموزًا أو أسرارًا.
- الاختبارات تثبت أن مستأجرًا آخر يرى صفر صفوف.

---

## 17. الصلاحيات

| الصلاحية | Owner | Admin | Manager | Analyst | Viewer |
|---|:--:|:--:|:--:|:--:|:--:|
| `store:read` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `store:sync` | ✅ | ✅ | ✅ | ❌ | ❌ |

`store:sync` أُضيفت في Phase 04؛ Viewer وAnalyst لا يبدآن مزامنة. القراءة متاحة بدور `store:read`.

---

## 18. التدقيق والمراقبة

أحداث جديدة (بلا رموز ولا أكواد):

- `salla.categories.sync_started|completed|failed`
- `salla.products.sync_started|completed|failed`

كل حدث يحمل `syncRunId`, `correlationId`, `resource`, وعدّادات فقط؛ لا `access_token`, `code`, ولا جسم استجابة.

- مقاييس: `sync.failures`, `sync.items`, `sync.pages`, `sync.duration_ms` (إضافة إلى `sync.runs` للحالة و`salla.requests`/`salla.rate_limits`) عبر واجهة `metrics` قابلة للاستبدال.
- سجلات JSON: `event`, `correlationId`, `organizationId`, `storeId`, `connectionId`, `syncRunId`, `page`, `items`, `durationMs` — بلا أي رمز.

---

## 19. الواجهة

- **بطاقة بيانات التجارة** داخل `/app/stores/[id]`: عدد المنتجات والتصنيفات من قاعدة البيانات، آخر مزامنة ناجحة، حالة كل مورد، وزر «مزامنة الآن» (يظهر فقط لمن يملك `store:sync`).
- **`/app/stores/[id]/products`**: جدول بالاسم/SKU/الحالة/السعر/التصنيف/آخر تحديث/معرّف Salla، بحث بالاسم أو SKU أو المعرّف عبر SQL، ترقيم صفحات، حالات فراغ وخطأ.
- **`/app/stores/[id]/products/[productId]`**: تفاصيل محلية فقط، بلا تعديل.
- **`/app/stores/[id]/categories`**: الاسم، التصنيف الأب، الحالة، عدد المنتجات المحسوب من `product_categories` فعلًا، آخر تحديث، معرّف Salla؛ بترقيم صفحات 50 صفًا (لا اقتطاع صامت). لا يُعرض slug لأن Salla لا توثّقه.
- لا يظهر أي رمز أو سر أو جسم استجابة خام. الأخطاء تُعرض بالعربية، والتفاصيل تبقى على الخادم.

---

## 20. الاختبارات

| النوع | العدد | التغطية |
|---|---|---|
| وحدة | 146 إجمالًا (+33 جديدة) | DTO، mappers، ترقيم، سياسة إعادة المحاولة، سكوبات، صلاحيات، تشفير، رموز |
| تكامل PostgreSQL | 88 إجمالًا (+24 جديدة) | upsert، علاقات، عزل مستأجر/متجر، RLS، فشل جزئي، إعادة تشغيل، تدقيق |
| بروتوكول Salla (محاكي) | ضمن الـ22 | ترقيم 3 صفحات، 401→تجديد→إعادة، 403/404، 429+Retry-After، 500، جسم تالف، حلقة صفحات |
| أمان | ضمن الـ22 | مستأجر آخر 404، Viewer 403، RLS، لا رموز في التدقيق |
| تزامن | 1 | 10 طلبات ⇒ تشغيل واحد |

اختبارات Phase 03 (64) ما زالت تمر بعد توسيع السكوبات إلى ثلاثة.

---

## 21. القيود المعروفة

1. **لا اختبار حقيقي مع Salla** — كل شيء على محاكي بروتوكول محلي.
2. الاتصالات القديمة تحتاج إعادة ربط لسكوبي القراءة.
3. لا حذف/أرشفة تلقائية؛ `last_seen_at` فقط.
4. لا مزامنة مجدولة أو Webhooks؛ التشغيل يدوي.
5. البحث `ILIKE` بلا فهرس trigram — كافٍ لحجم المرحلة، يُحسَّن لاحقًا.
6. لا بحث/تصفية في صفحة التصنيفات (ترقيم فقط)؛ البحث مطلوب للمنتجات وحدها في هذه المرحلة.
7. لا تُقرأ المتغيّرات (`skus`/`options`) ولا الصور المتعددة؛ الصورة الرئيسية فقط.
8. `per_page=30` ثابت؛ لا ضبط لكل متجر.

---

## 22. تحضير Phase 05

- `products.external_product_id` و`categories.external_category_id` هما مفتاح الربط لأي بيانات قادمة (طلبات/عملاء/مخزون).
- `getAccessToken()` بوابة موحّدة، و`SallaCatalogClient` نمط عميل مقيد بنقاط موثّقة يجب اتباعه.
- `sync_runs`/`sync_locks` قابلان لإعادة الاستخدام لأي مورد جديد (`resource` نصّي).
- سياسة الحذف وسياسة الترقيم وسياسة إعادة المحاولة جاهزة للتوسيع، وتحتاج فقط تسجيل نقاط النهاية الجديدة في `salla-reference.md` §10 قبل استخدامها.

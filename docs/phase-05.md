# Phase 05 — Orders + Customers + Inventory Foundation

> **الحالة:** منفّذة ومُختبرة بروتوكوليًا على محاكي Salla محلي + PostgreSQL حقيقي. **لم يُختبر الاستدعاء الحقيقي لـ Salla** لعدم توفر مفاتيح تطبيق أو متجر تجريبي.
>
> **الجملة المعتمدة:** Orders/Customers/Inventory protocol behavior is tested against a local Salla contract simulator; live Salla verification is pending credentials.

---

## 1. الهدف

بناء **أساس بيانات** للطلبات وبنودها والعملاء والمخزون، ومزامنة قراءة آمنة يمكن الاعتماد عليها في Store/Sales/Product/Inventory/Customer Intelligence لاحقًا — **بلا بناء أي منها الآن**.

```
Organization → Store → Salla Connection → getAccessToken()
            → Merchant API (/orders, /customers, /products/quantities)
            → DTO (Zod) → Domain → Repository → PostgreSQL → RLS
            → Sync State (sync_runs) → Arabic RTL UI
```

**خارج النطاق صراحةً:** Webhooks (Phase 06)، التحليلات/الذكاء الاصطناعي، التنبؤ، التوصيات، التسويق، SEO، المنافسون، التسعير، الحملات، وأي كتابة إلى Salla. كل نداء إلى Salla في هذه المرحلة **قراءة فقط**.

---

## 2. حدود المرحلة

| مبدأ | التنفيذ |
|---|---|
| قراءة فقط | أربع نقاط GET موثّقة فقط؛ لا POST/PUT/DELETE إلى Salla في أي ملف |
| لا اختراع | كل حقل مخزَّن مأخوذ من وثيقة مسجّلة في `docs/salla-reference.md` §12 |
| عزل المستأجر | كل صف يحمل `organization_id` و`store_id` من الجلسة؛ RLS مفعّل على أربعة جداول |
| لا PII زائدة | حمولة الطلب محفوظة بقائمة سماح بلا `customer`/`bank`/`notes`/`urls`، والعملاء بلا حمولة، ولا كلمات مرور أو رموز دفع (ADR-043) |
| صدق الحالة | لا أرقام وهمية؛ الجداول تعرض ما في PostgreSQL فقط أو «—» |

---

## 3. المراجع الرسمية

| الموضوع | الصفحة | ما أُخذ منها |
|---|---|---|
| List Orders | https://docs.salla.dev/5394146e0 | المسار، `orders.read`، التسلسل الإلزامي، نافذة 15 دقيقة، إلغاء `expanded`، شكل سطر الطلب |
| Order Details | https://docs.salla.dev/orders/details | `format=light` افتراضي، إسقاط Items، إزالة الاستجابة الموسّعة |
| List Customers | https://docs.salla.dev/5394121e0 | المسار، `customers.read`، الحقول المتاحة وغير المتاحة |
| Customer Details | https://docs.salla.dev/5394122e0 | لم يُستخدم (لا حقل إضافي نحتاجه) |
| List Product Quantities | https://docs.salla.dev/9612796e0 | المسار، `products.read`، شكل الكمية، `sku_id`، `price` |
| Pagination | https://docs.salla.dev/pagination | `per_page` بحد أقصى 60، شكل `pagination` |
| Rate Limiting | https://docs.salla.dev/rate-limiting | حدود الخطة، `X-RateLimit-*`، `Retry-After`، 500/10 دقائق للعملاء |

سجل الأدلة الكامل (15 صفًا): `docs/salla-reference.md` §12.8. القيود: §13.

---

## 4. السكوبات

| Scope | الاستخدام | جديد؟ |
|---|---|---|
| `offline_access` | refresh token | لا |
| `products.read` | المنتجات + كميات المخزون | لا |
| `categories.read` | التصنيفات | لا |
| `orders.read` | الطلبات | **نعم** |
| `customers.read` | العملاء | **نعم** |

اتصال قديم لا يحمل السكوبين الجديدين يُرفض قبل أي طلب إلى Salla بـ `missing_scope` ويحتاج إعادة ربط واحدة من بطاقة «ربط Salla» (ADR-042). لا سكوب كتابة.

---

## 5. قاعدة البيانات

هجرة `0006_phase05_orders_customers_inventory.sql` (Drizzle) + هجرة RLS يدوية `0007_commerce_rls.sql`.

| الجدول | المفتاح الفريد | الغرض |
|---|---|---|
| `customers` | `(store_id, external_customer_id)` | عميل واحد لكل معرّف خارجي لكل متجر — **لا بالبريد** |
| `orders` | `(store_id, external_order_id)` | طلب واحد لكل معرّف خارجي لكل متجر |
| `order_items` | `(order_id, line_number)` | سطور الطلب؛ الاستبدال الكامل لكل طلب عند إعادة المزامنة |
| `inventory_levels` | `(store_id, quantity_key)` | حالة مخزون واحدة لكل منتج/متغيّر |

- كل الجداول تحمل `organization_id` (RLS) و`store_id` (العزل الوظيفي)، و`created_at`/`updated_at`.
- سياسات RLS: `select`/`insert`/`update`/`delete` على `app.current_organization_id()` لكل جدول، مع `FORCE ROW LEVEL SECURITY`.
- `sync_runs.resource` صار يقبل `customers` و`orders` و`inventory` إلى جانب `products`/`categories` — نفس الجدول، بلا جدول حالة ثانٍ.

### أعمدة «غير قابلة للملء» عن قصد

| الجدول | العمود | السبب |
|---|---|---|
| `order_items` | `external_product_id`, `external_sku_id`, `sku`, `unit_price`, `total_price` | غير موجودة في `List Orders`، والتفاصيل الموسّعة أُزيلت (§12.2) |
| `customers` | `source_created_at`, `language`, `currency`, `customer_type`, `country_code`, `birthday` | غير موجودة في `List Customers`؛ تُملأ فقط من كائن العميل داخل الطلب |
| `inventory_levels` | `price_currency` | نقطة الكميات لا تعيد عملة؛ تُؤخذ من المنتج المحلي إن وُجد |

---

## 6. النقاط (Endpoints) الداخلية

| Method | المسار | الصلاحية | الغرض |
|---|---|---|---|
| `POST` | `/api/organizations/current/stores/{storeId}/data/sync` | `store:sync` | مزامنة `customers` / `orders` / `inventory` / `all` |
| `GET` | نفس المسار | جلسة + `store:read` | عدّادات حقيقية + حالة الموارد الخمسة |
| `GET` | `.../data/orders` | `store:read` | قائمة محلية مُصفَّحة |
| `GET` | `.../data/customers` | `store:read` | قائمة محلية + بحث |
| `GET` | `.../data/inventory` | `store:read` | قائمة محلية + بحث |

كل المسارات تمرّ عبر `requireOrganizationAccess`/`requirePermission`، و`storeId` يُحلّ من الجلسة → العضوية → المتجر. متجر غير تابع للمؤسسة = 404.

---

## 7. الترقيم

| المورد | القاعدة | الحماية |
|---|---|---|
| Orders | تسلسلي 1→2→3، `per_page=30`، وقف عند `currentPage >= totalPages`، لا `expanded` | صفحة فارغة قبل الأخيرة = فشل (`pagination.empty`)؛ صفحة مكرّرة = فشل؛ سقف 200 صفحة؛ نافذة 15 دقيقة (`sequential_window_exceeded`) |
| Customers | `currentPage`/`totalPages` الموثّقة، `per_page=30` | نفس الحراسات عدا النافذة الزمنية |
| Inventory | `currentPage`/`totalPages` الموثّقة (النقطة مُصفَّحة) | نفس الحراسات |

`from_date`/`to_date` مدعومان في عميل الطلبات (`listOrders`) ويُمرَّران عند تضييق النطاق؛ الواجهة لا تعرضهما بعد لأن لا حاجة منتج لهما في هذه المرحلة.

---

## 8. تدفّق المزامنة

```
syncStoreData(resource)
  ├─ assertPermission("store:sync") + requireStoreAccess
  ├─ requireUsableConnection  (status + scopes لكل مورد)
  ├─ acquireDataSyncLock لكل (store, resource) — صف في sync_locks، TTL 120s
  └─ بالترتيب: customers → orders → inventory
       └─ runPagedSync
            ├─ sync_runs row (running) + audit started
            ├─ getAccessToken() — تجديد واحد عند 401
            ├─ لكل صفحة: fetch → Zod → mapper → upsert في معاملة واحدة
            ├─ renewSyncLock بعد كل صفحة
            └─ finishSyncRun + audit completed/failed + metrics + log
```

- **الترتيب إلزامي:** العملاء قبل الطلبات (الطلب يرتبط بعميل)، والطلبات قبل المخزون (لا اعتماد فعلي لكنه يثبّت السلوك).
- **قفل قاعدة البيانات:** `sync_locks` موجود من Phase 04؛ الموارد الجديدة تستخدم نفس الآلية بمفتاح `(store_id, resource)`. طلب متزامن = 409 `sync_in_progress`، و«الكل» يحجز الثلاثة ويحرّرها كلها عند الفشل.
- **معاملة لكل صفحة:** الصفحة وحدة ذرّية؛ فشل صفحة لا يمسّ الصفحات المثبّتة، وإعادة التشغيل آمنة لأن كل كتابة upsert.

---

## 9. الثبات (Idempotency)

| المورد | المفتاح | إعادة التشغيل |
|---|---|---|
| Customers | `(store_id, external_customer_id)` | upsert؛ `authoritative` يستبدل الحقول المتاحة، `enrich` يملأ الفراغات فقط |
| Orders | `(store_id, external_order_id)` | upsert + استبدال سطور ذلك الطلب (لا تكرار ولا سطور يتيمة) |
| Inventory | `(store_id, quantity_key)` | upsert في المكان؛ لا صف لكل تشغيل |

اختبار تكاملي: ثلاث مزامنات متتالية ⇒ 67 طلبًا، 134 سطرًا، 5 عملاء، 3 بنود مخزون — بلا تكرار. التشغيل الثاني والثالث يسجّلان `itemsCreated = 0`.

---

## 10. الفشل الجزئي مقابل فشل النظام

| النوع | أمثلة | السلوك |
|---|---|---|
| جزئي | سطر بلا مرجع منتج، سطر لا يجد منتجًا محليًا، عميل بلا حقل | يُسجَّل ويُحصى في `items_skipped`، والمزامنة تكمل |
| نظامي | 401 بعد تجديد، `invalid_grant`، شبكة، عقد مخالف (`invalid_response`)، 429 يتجاوز الميزانية، 5xx بعد المحاولات، انتهاء القفل، فشل معاملة، مستأجر غير مطابق | يُنهي المورد، يُسجّل `sync_runs.status = 'failed'` مع `error_code` ثابت، ويوقف بقية الموارد في «الكل» |

رموز الفشل الثابتة: `unauthorized`, `forbidden`, `not_found`, `validation_failed`, `rate_limited`, `provider_error`, `network_error`, `invalid_response`, `reauth_required`, `internal_error`.

---

## 11. حدود المعدل وإعادة المحاولة

- المصدر: https://docs.salla.dev/rate-limiting — حدود حسب الخطة، `X-RateLimit-Limit/Remaining/Reset`، و`Retry-After` عند 429، وحد خاص للعملاء **500/10 دقائق**.
- إعادة المحاولة: 3 محاولات كحد أقصى، تأخير أسّي 500ms → 30s، و`Retry-After` يُحترم **حرفيًا**؛ إن طلب المزوّد انتظارًا أطول من 30 ثانية يتوقف التشغيل بدل المخالفة.
- لا توازٍ: صفحة واحدة في كل مرة لكل مورد، والموارد متتابعة.
- 401: تجديد واحد (`forceRefresh`) ثم إعادة الصفحة مرة واحدة؛ عند الفشل `reauth_required` + تعليم الاتصال `reauth_required`.

---

## 12. الخصوصية وتقليل PII

- حمولة الطلب تُحفظ في `orders.raw_payload` بقائمة سماح موثّقة (بلا `customer`/`urls`/`notes`/`bank`/`payment_actions`)، ولا تُقرأ ولا تُعرض ولا تُسجَّل. العملاء بلا حمولة إطلاقًا (ADR-043).
- لا كلمات مرور، لا رموز دفع، لا CVV، لا بيانات بطاقة، لا `bank`/`source_details`/`ip`/`user_agent`رغم وجودها في استجابة تفاصيل الطلب.
- `order_items.thumbnail_url` رابط صورة فقط، بلا تنزيل أو تخزين.
- لا يُسجَّل أي حقل PII في السجلات: التسجيل يحمل معرّفات (`storeId`, `syncRunId`, `resource`) وأعدادًا فقط.
- الواجهة تعرض البريد والهاتف لأنها بيانات المتجر التي يملكها — لا تعرض أي رمز أو استجابة OAuth.

---

## 13. الأمان

- كل استعلام يمرّ عبر `withTenantTransaction` الذي يضبط `app.current_org`، وRLS يمنع أي صف من مؤسسة أخرى حتى لو أخطأ الكود.
- `storeId` القادم من المسار يُتحقق منه بـ `requireStoreAccess`، ومسار `?store=` في الصفحات يُطابق فقط ضد `listStores` الخاص بالمؤسسة؛ معرّف أجنبي = 404.
- `store:sync` للبدء، `store:read` للقراءة. لا صلاحية جديدة في هذه المرحلة.
- CSRF عبر `assertCsrf` (ADR-041) على POST، وتحديد معدل لكل مؤسسة+متجر على مسار المزامنة.
- اختبارات: مؤسسة B تحصل على 404 لطلبات مؤسسة A، وViewer يحصل على 403 عند بدء مزامنة.

---

## 14. الواجهة

| الصفحة | المحتوى |
|---|---|
| `/app/orders` | عدّادات حقيقية (إجمالي، آخر طلب، مسودات، بانتظار الدفع)، جدول (رقم، عميل، حالة، إجمالي، عملة، تاريخ)، ترقيم، حالة مزامنة |
| `/app/customers` | اسم، بريد/جوال، دولة، مدينة، تاريخ الإنشاء (أو «—»)، عدد الطلبات المحلية، بحث، ترقيم |
| `/app/inventory` | منتج، SKU، كمية، مُباع، غير محدود، سعر، آخر مزامنة، بحث، ترقيم |
| أزرار المزامنة | «مزامنة العملاء/الطلبات/المخزون/الكل» — تظهر بـ `store:sync` فقط، ومعطّلة عند عدم الاتصال أو نقص السكوب |

- عربية RTL بالكامل، متجاوبة، بلا رسوم بيانية أو أرقام مُختلقة.
- لا اتصال ⇒ «Salla غير متصل. اربط المتجر أولًا…». بيانات المحاكي تُعرض كبيانات محاكي في `docs` وفي شاشة المتجر، وليست بيانات Salla حقيقية.
- الصفحات على مستوى المؤسسة وتختار المتجر عبر `?store=`؛ حساب بأكثر من متجر يرى مُنتقيًا حقيقيًا، وحساب بمتجر واحد يفتحه مباشرة.

---

## 15. الاختبارات

| النوع | الملف | التغطية |
|---|---|---|
| وحدة | `orders/domain/mappers.test.ts` | DTO، تعيين الطلب، سطور بلا مرجع، الساعة الجدارية والمنطقة |
| وحدة | `customers/domain/mappers.test.ts` | `mobile` كائن/نص، `mobile_code`، `country_code`، الحقول الغائبة |
| وحدة | `inventory/domain/mappers.test.ts` | مفتاح المتغيّر، `price` رقم/نص، القيم الغائبة |
| وحدة | `sync/domain/failures.test.ts` | 401/403/404/422/429/500/503، فشل نظامي مقابل جزئي، التطبيع |
| تكامل | `data-sync.integration.test.ts` | 30/30/7 = 67، ثلاث مزامنات بلا تكرار، بنود غير مرتبطة، عملاء، مخزون، عزل مستأجر، RBAC، 429+`Retry-After`، 500، التدفق الكامل |

المحاكي الموسّع (`src/test/integration/mock-salla-server.ts` و`.tmp/mock-salla.mjs`) يفرض قاعدة **القراءة المتسلسلة للطلبات** ويعيد استجابة فارغة عند القفز، ويوفر حقن 401/429/500/503 — فيُختبر السلوك الموثّق لا سلوكًا مختلقًا.

---

## 16. القيود المعروفة

1. **بنود الطلب بلا منتج**: `List Orders` لا يعيد معرّف منتج/SKU/سعر سطر، والتفاصيل الموسّعة أُزيلت. كل سطر يُحفظ بـ `link_status = 'no_product_reference'`. لا مطابقة بالاسم (§12.2، ADR-043).
2. **حقول عميل ناقصة**: `created_at`, `full_name`, `lang`, `currency`, `type`, `country_code` غير موجودة في قائمة العملاء؛ تظهر «—» حتى تأتي من الطلب.
3. **لا سجل تاريخي للمخزون**: الجدول حالة حالية فقط (§ADR-043). أي تحليل زمني يحتاج لقطات — مرحلة لاحقة.
4. **لا فحص حقيقي على Salla**: كل الاختبارات على محاكي بروتوكول محلي؛ التحقق الحقيقي ينتظر بيانات اعتماد.
5. **لا تفاصيل طلب لكل طلب**: لم نضف نداء `GET /orders/{id}`؛ الوثائق تقول إنه `light` افتراضيًا ولا يضيف حقلًا نحتاجه، ونداء لكل طلب يضاعف استهلاك الحد.
6. **`from_date`/`to_date` غير معروضين في الواجهة**: مدعومان في العميل، ويُستخدمان عند الحاجة بكود لا بواجهة.

---

## 17. التحقق (Verification)

| البند | النتيجة |
|---|---|
| `format:check` | ✅ |
| `lint` | ✅ 0 مشاكل |
| `typecheck` | ✅ |
| `test` (وحدة) | ✅ 179 اختبارًا على 24 ملفًا |
| `test:integration` | ✅ 101 اختبارًا على 8 ملفات |
| `build` | ✅ |
| `check:secrets` | ✅ |
| قاعدة بيانات جديدة | ✅ 8 هجرات على قاعدة فارغة + بذور المحاكي + تشغيل التطبيق |
| معاينة | ✅ `/login`, `/app`, `/app/stores`, `/app/orders`, `/app/customers`, `/app/inventory` |

**معايير الخروج:** 67 طلبًا من 3 صفحات بلا تخطّي، إعادة المزامنة لا تكرر، لا Endpoint غير موثّق، لا PII في السجلات، عزل مستأجر مُختبر.

**التبعية:** Phase 04. **التالي:** Phase 06 (Webhooks + Sync Engine) — **لم يُنفَّذ**.

---

## 18. تحضير Phase 06

- `sync_runs` جاهز لاستقبال تشغيلات تزايدية بنفس الشكل.
- `paged-sync.ts` يفصل «ماذا نقرأ» عن «كيف نقرأ»؛ مزامنة تزايدية تُضيف نطاق تاريخ لا مسارًا جديدًا.
- لا Webhooks؛ وتخزين أي حمولة أخرى (أو الاحتفاظ بحمولة الطلب بعد تغيّر شكلها) يحتاج ADRًا مستقلًا مع سياسة احتفاظ وحدّ حجم.
- نقطة `GET /products/quantities/audit` موثّقة وغير مستخدمة — مرشح طبيعي لمرحلة التحليلات الزمنية، لا لهذه المرحلة.

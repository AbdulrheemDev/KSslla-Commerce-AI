# Phase 09 — ذكاء المنتجات (Product Intelligence)

> **الحالة:** جاهزة للمراجعة. **الفرع:** `arena/8ae97403-ksslla-commerce-ai`. **لا نداءات Salla جديدة، ولا كتابة، ولا ذكاء اصطناعي.**

## 1. الهدف

تُجيب هذه المرحلة عن سؤال واحد: **ما حال الكتالوج المحفوظ في النسخة المحلية الآن؟** — جودة المحتوى، البيانات الوصفية، الصور، دورة الحياة، صحة التصنيفات، والمشكلات المرتّبة، وتوصيات قواعدية مبنيّة عليها فقط.

معيار الخروج المطلوب: **«ترتيب المشكلات قابل للتفسير، لا توصية بلا دليل»**. لذلك كل صف مشكلة يحمل: القاعدة، الخطورة الثابتة، عدد المنتجات المتأثرة، النسبة، وأمثلة أسماء منتجات؛ وكل توصية تحمل نفس الأدلة، ولا توجد توصية لقاعدة لم تُطلق.

### 1.1 خارج النطاق (مقصود)

- **لا مبيعات أو إيراد لكل منتج.** بنود `List Orders` تحمل `name`/`quantity`/`thumbnail` فقط (§4)، فلا نسبة لمنتج بلا مطابقة استنتاجية — وهي ممنوعة.
- **لا تحويل `sold_quantity` إلى مبيعات فترة.** العداد تراكمي وفترته غير موثّقة؛ لا قسمة على أيام ولا مقارنة بين نوافذ.
- **لا مؤشر SEO.** ما يُحسب هو «جودة محتوى المنتج» بأوزان معلنة، ولا ادعاء تأثير على ترتيب البحث.
- **لا صور تُنزَّل أو تُعدّل أو تُقيَّم بصريًا.** فحص شكل الرابط فقط.
- **لا AI/LLM/تضمينات/توصيات مولّدة.** كل توصية نص ثابت مربوط بقاعدة مطلقة.
- **لا كتابة ولا إصلاح تلقائي ولا زر تنفيذ.** لا `POST`/`PUT`/`PATCH`/`DELETE` على المسارات الخمسة.
- **لا هجرة قاعدة بيانات.** البيانات القائمة كافية (المنتجات، الروابط، التصنيفات، المخزون).
- **لا نداء Salla.** الحقول الناقصة تُعرض `unavailable` مع سبب، وتُسجَّل كقيود (§21).

## 2. البنية

```
src/modules/product-intelligence/
├── domain/                     # نقي: بلا Next ولا Drizzle ولا HTTP ولا SDK
│   ├── thresholds.ts           # كل رقم تقارنه المحرّكات، مع وحدة القياس وأثره
│   ├── types.ts                # DTOs + IssueSummary/Recommendation
│   ├── text.ts                 # أدوات نصية كلية (blank/trim/code points/URL/أيام)
│   ├── content.ts              # جودة المحتوى — 5 فحوص موزونة
│   ├── metadata.ts             # metadata.title / metadata.description
│   ├── images.ts               # وجود الصورة وصحة الرابط؛ العدد وalt غير متاحين
│   ├── lifecycle.ts            # updated_at فقط؛ لا عمر منتج
│   ├── commercial.ts           # السعر والعملة والمخزون
│   ├── performance.ts          # مبيعات فترة/إيراد = unavailable
│   ├── issues.ts               # 18 قاعدة + detectIssues + summariseIssues (ترتيب حتمي)
│   ├── recommendations.ts      # نص عربي لكل قاعدة + advisoryOnly
│   ├── products.ts             # analyseProduct: تركيب المحرّكات في مكان واحد
│   ├── catalog.ts              # النظرة العامة + التغطية + الثقة
│   ├── categories.ts           # صحة كتالوج التصنيفات
│   └── provider-metadata.ts    # قراءة metadata.sallaMetadata دون رمي أخطاء
├── infrastructure/
│   └── product-catalog-repository.ts   # 4 قراءات مجمّعة، صفر N+1
└── application/
    ├── query.ts                # تحقق من page/pageSize/q/filter
    └── product-intelligence-service.ts  # لقطة واحدة + إسقاطات + تعريفات
```

الطبقات: **domain** نقي وحتمي وقابل للاختبار بلا قاعدة بيانات؛ **infrastructure** يقرأ فقط (لا كتابة) ويعيد استخدام `loadProductCategoryLinks`/`loadCategoryRows`/`loadInventoryRows` من Phase 07؛ **application** يبني لقطة واحدة لكل طلب ثم يسقط منها كل استجابة؛ **API** خمسة مسارات `GET` فقط؛ **UI** صفحة عربية RTL واحدة.

## 3. عقد الاستجابة

كل استجابة تحمل نفس المغلّف، حتى يعرف القارئ **على أي بيانات** حُسب الرقم:

```json
{
  "storeId": "…",
  "generatedAt": "2026-10-22T…Z",
  "freshness": { "syncedAt": "…", "resources": [...], "staleResources": [...] },
  "coverage": { "status": "complete|partial|empty", "productCount": 3, "categoryCount": 2, "notes": [...] },
  "confidence": { "level": "high|medium|low", ... },
  "data": { … }
}
```

- `freshness` هو سجل Phase 07 كما هو (`sync_runs` + lease)، لا حالة ثانية.
- `coverage.notes` رموز لا نصوص: `products_not_synced`, `products_sync_incomplete`, `categories_not_synced`, `categories_sync_incomplete`, `products_skipped_in_last_run`, `categories_skipped_in_last_run`, `no_products_stored`, `metadata_not_captured`.
- `confidence`: **low** إن لم تُزامَن المنتجات أو فشلت آخر مزامنة أو كانت التغطية فارغة؛ **medium** إن كانت جزئية أو كان `products`/`categories` قديمًا؛ **high** فيما عدا ذلك. لا يُخفى سبب الانخفاض.
- **لا معامل فترة.** الكتالوج حالة حالية، وإضافة نافذة زمنية كانت ستوحي بأن الأرقام تتغير بها.

## 4. المصادر والتحقق

### 4.1 ما تقرأه المرحلة

| المصدر المحلي | الأعمدة |
|---|---|
| `products` | `name`, `sku`, `status`, `description`, `url`, `image_url`, `price_amount`, `currency`, `quantity`, `is_available`, `source_updated_at`, `last_seen_at`, `metadata` |
| `product_categories` + `categories` | الربط، و`name`، و`status` (مضاف قراءةً في Phase 09) |
| `inventory_levels` | `quantity`, `sold_quantity`, `unlimited_quantity` مجمّعة لكل منتج |
| `sync_runs` | آخر تشغيل/نجاح/فشل لكل مورد |

### 4.2 صفوف الدليل المضافة

تسعة صفوف في `docs/salla-reference.md` §17، أهمها: `images[]`/`alt` موثّقان لكن غير محفوظين؛ `sold_quantity` بلا فترة موثّقة؛ لا `created_at` للمنتج؛ لغة المحتوى تُختار بالترويسات والمزامنة لا ترسلها؛ بنود الطلب بلا معرّف منتج.

### 4.3 ما لا يُقرأ ولماذا

- `views` (موثّق، غير محفوظ، ولا معنى لجلبه الآن): لا يُظهر في أي مقياس.
- `images[].alt` وعدد الصور: `unavailable` بسبب `images_not_mirrored` / `image_alt_not_mirrored`.
- `Product Details` لكل منتج: **N+1 مرفوض** (ADR-056).
- `created_at` للمنتج: غير موثّق ⇒ `unavailable("created_at_not_documented")`.

## 5. المقاييس — التعريف والمصدر

| المقياس | التعريف | الحالة عند نقص البيانات |
|---|---|---|
| `totalProducts` | `count(products)` للمتجر | `unavailable("catalog_not_synced")` قبل أول مزامنة ناجحة |
| `needsAttention` | منتجات أعلى مشكلة فيها عالية أو متوسطة | `unavailable("catalog_not_synced")` |
| `averageContentScore` | `mean(content.score)` من 100 | `unavailable("no_products_stored")` للكتالوج الفارغ |
| `metadataHealthPercent` | منتجات تحمل `metadata.title` و`metadata.description` ÷ المنتجات | `partial("metadata_not_captured")` إن لم تُحفظ البيانات الوصفية للجميع |
| `imageCoveragePercent` | منتجات بصورة رئيسية صالحة ÷ المنتجات | `unavailable("no_products_stored")` |
| `categoryCoveragePercent` | منتجات مرتبطة بتصنيف واحد على الأقل ÷ المنتجات | `unavailable("categories_not_synced")` |
| `hiddenProducts` | `status = 'hidden'` | `unavailable("catalog_not_synced")` |
| `staleProducts` | منتجات أقدم من 90 يومًا حسب `updated_at` | `unavailable("provider_updated_at_missing")` أو `partial("updated_at_missing_for_some_products")` |
| `outOfStock` | `stock <= 0` وليست كمية غير محدودة | `unavailable("no_stock_data")` أو `partial("stock_known_for_some_products")` |
| `uncategorized` | منتجات بلا رابط تصنيف | `unavailable("categories_not_synced")` |

**قاعدة الصفر:** `0` يُعرض فقط عندما يكون الصفر هو القياس. كل غياب بيانات ⇒ `value: null` + `reason`، والواجهة تعرض `—` مع السبب بالعربية.

## 6. العتبات (`thresholds.ts`)

| الثابت | القيمة | الوحدة | ما يقرؤه |
|---|---|---|---|
| `MIN_NAME_CHARS` | 3 | حرف (code point) | `short_name` |
| `MIN_DESCRIPTION_CHARS` | 120 | حرف | `short_description` |
| `STALE_CONTENT_DAYS` | 90 | يوم | `stale_content` |
| `RECENT_UPDATE_DAYS` | 14 | يوم | وصف «حديث» فقط، بلا مشكلة |
| `SEVERITY_WEIGHT` | 3 / 2 / 1 | وزن | درجة كل مشكلة في الترتيب |
| `CONTENT_WEIGHT` | 25/30/15/15/15 = 100 | نقطة | جودة المحتوى |
| `METADATA_WEIGHT` | 50/50 | نقطة | صحة البيانات الوصفية |
| `MIN_PRODUCTS_FOR_CATEGORY_HEALTH` | 1 | منتج | أهلية الحكم على التصنيف |
| `LOW_STOCK_UNITS` | 5 | وحدة | إشارة المخزون المنخفض (متسقة مع Phase 07) |

كل قيمة ثابتة لا إعداد لكل متجر: متجران بكتالوج متطابق يحصلان على الحكم نفسه. ولا رقم مبني على «متوسط السوق» أو مخرجات نموذج.

## 7. جودة المحتوى (`content.ts`)

مقياس **داخلي** لا SEO. خمسة فحوص، ومجموع أوزانها 100:

| الفحص | الشرط | الوزن |
|---|---|---|
| `name` | غير فارغ وطوله ≥ 3 | 25 |
| `description` | موجود | 30 |
| `description_length` | طوله ≥ 120 | 15 |
| `url` | رابط `http(s)` مطلق | 15 |
| `sku` | موجود | 15 |

- كل فحص يعيد `observed` (الطول أو القيمة)، فيمكن إعادة حساب الدرجة من الاستجابة.
- الطول يُقاس بـ**code points** لا بوحدات UTF-16 (`"👕".length === 2` لكنه حرف واحد).
- النص الأبيض فقط = مفقود.
- `short_description` تُطلق فقط عندما يكون الوصف موجودًا وقصيرًا؛ ولا تُطلق مع `missing_description` معًا.

## 8. البيانات الوصفية (`metadata.ts`)

- المصدر: `metadata.sallaMetadata = { title, description }` كما حفظته Phase 04 من استجابة المزوّد.
- `stored` يفصل بين «لا يوجد كائن metadata أصلًا» و«الكائن موجود وفيه حقل ناقص».
- `stored: false` ⇒ الدرجة `partial("metadata_not_captured")`، لأن الصفر هنا ليس حكمًا على المنتج بل على ما لم يُحفظ.
- الصلة بالترتيب: `metadataHealthPercent` في النظرة العامة تُحسب على المنتجات التي حُفظت لها بيانات وصفية، وتُعلَن `partial` إن لم تُحفظ للجميع.

## 9. الصور (`images.ts`)

- الحالة من `products.image_url`: `present` / `missing` / `invalid`.
- `urlValid` فحص شكل عبر `new URL` فقط — لا طلب شبكة، لا تنزيل، لا فحص بصري.
- `count` = `unavailable("images_not_mirrored")` و`altText` = `unavailable("image_alt_not_mirrored")`: النسخة المحلية تحفظ رابطًا واحدًا لا قائمة صور (ADR-056 والقيود §21).

## 10. دورة الحياة (`lifecycle.ts`)

- `lastUpdated` من `source_updated_at` (حقل المزوّد الموثّق `updated_at`)، والقياس بالأيام `daysSinceUpdate`.
- `stale` = `daysSinceUpdate >= 90`؛ `recentlyUpdated` = `<= 14` (وصف لا مشكلة).
- `ageDays` = `unavailable("created_at_not_documented")` — **لا** يُشتق عمر المنتج من تاريخ التحديث.
- `hidden` من `status === "hidden"` فقط؛ Salla لا تنشر تعداد حالات مغلقًا، فأي قيمة أخرى تُترك كما هي.
- تاريخ غير قابل للتحليل = مفقود، لا عمر صفري.

## 11. التجاري والتوفر (`commercial.ts`)

- السعر يُقرأ كما حُفظ (`price_amount`) ولا يُعاد تركيبه من `regular_price`/`sale_price`؛ الخصم ليس موضوع هذه المرحلة.
- السعر `0` **يُعرض** كصفر (لأنه قياس)، وتُطلق `non_positive_price`. السعر المفقود = `unavailable("no_price")`.
- المخزون: `inventory_levels` المجمّعة أولًا (`stockSource: "inventory"`)، ثم `products.quantity` (`"products"`)، ثم `unavailable("no_stock_data")`.
- `unlimited_quantity = true` ⇒ `outOfStock = false` مهما كانت الكمية.
- مخزون غير معروف ⇒ `outOfStock = null`، ولا `out_of_stock` — مجهول ليس نافدًا.

## 12. أداء المنتج (`performance.ts`)

```
periodSales            = unavailable("product_sales_not_linked")
revenue                = unavailable("product_sales_not_linked")
cumulativeSoldQuantity = sum(inventory_levels.sold_quantity) أو unavailable("inventory_not_synced")
```

- السبب موثّق: بنود `List Orders` لا تحمل معرّف منتج ولا سعرًا (§4)، و`order_items.link_status = 'no_product_reference'`.
- أي محاولة نسبة مبيعات كانت ستتطلب مطابقة بالاسم أو الصورة أو السعر — وهي ممنوعة صراحةً.
- العداد التراكمي يُعرض بوسم «تراكمي» ويُذكر أن فترته غير موثّقة؛ لا قسمة على أيام ولا مقارنة.

## 13. المشكلات والترتيب (`issues.ts`)

| # | المشكلة | التصنيف | الخطورة | القاعدة |
|---|---|---|---|---|
| 1 | `missing_name` | identity | عالية | `name is blank` |
| 2 | `short_name` | identity | متوسطة | `0 < length(name) < 3` |
| 3 | `missing_description` | content | عالية | `description is null or blank` |
| 4 | `short_description` | content | متوسطة | `length(description) < 120` |
| 5 | `missing_metadata_title` | metadata | عالية | `metadata.title is blank` |
| 6 | `missing_metadata_description` | metadata | متوسطة | `metadata.description is blank` |
| 7 | `missing_image` | images | عالية | `image_url is null or blank` |
| 8 | `invalid_image_url` | images | متوسطة | `image_url does not parse as http(s)` |
| 9 | `missing_sku` | identity | متوسطة | `sku is blank` |
| 10 | `missing_url` | identity | متوسطة | `url is blank` |
| 11 | `missing_category` | category | عالية | `no category links` |
| 12 | `hidden_category_link` | category | منخفضة | `any linked category.status = 'hidden'` |
| 13 | `hidden_product` | lifecycle | منخفضة | `product.status = 'hidden'` |
| 14 | `stale_content` | lifecycle | متوسطة | `daysSinceUpdate >= 90` |
| 15 | `missing_price` | commercial | عالية | `price is unavailable` |
| 16 | `non_positive_price` | commercial | عالية | `price <= 0` |
| 17 | `missing_currency` | commercial | متوسطة | `currency is blank` |
| 18 | `out_of_stock` | inventory | متوسطة | `stock <= 0 and not unlimited` |

**الترتيب الحتمي:** `score = affectedCount × SEVERITY_WEIGHT[severity]`، ثم `severity desc`، ثم `affectedCount desc`، ثم `id asc`. المفاتيح الثلاثة الأولى قد تتعادل، والرابع يحسم دائمًا ⇒ ترتيب واحد لأي لقطة معطاة، وقابل لإعادة الحساب من الحمولة وحدها.

**`needsAttention`:** منتج يدخل قائمة العمل إذا كانت أعلى مشكلة لديه عالية أو متوسطة. منتج كل مشكلاته منخفضة (`hidden_product`/`hidden_category_link`) يُعرض ولا يدخل القائمة: إخفاء منتج قد يكون قرارًا موسميًا مدروسًا.

## 14. التوصيات (`recommendations.ts`)

- واحدة لكل مشكلة **أطلقت فعلًا**؛ صفر مشاكل ⇒ صفر توصيات (لا نصائح عامة).
- `{ id: "rec.<issueId>", issueId, title, rationale, priority, severity, rule, affectedCount, affectedPercent, examples, advisoryOnly: true }`.
- `priority` من الخطورة: عالية ⇒ `P1`، متوسطة ⇒ `P2`، منخفضة ⇒ `P3`.
- `rule` = `<issueId>_count > 0`؛ `examples` = نفس أسماء الأمثلة في صف المشكلة (حتى 3).
- النص عربي ثابت لكل قاعدة، و`rationale` يذكر العدد والنسبة صراحةً.
- `advisoryOnly` هو `true` حرفيًا: لا مسار كتابة، ولا عميل Salla، ولا زر تنفيذ، ولا تعديل.

## 15. صحة التصنيفات (`categories.ts`)

لكل تصنيف: `productCount`, `missingDescription`(+%), `missingMetadata`(+%), `missingImage`(+%), `hiddenProducts`, `averageContentScore`, `completenessPercent`, `belowVerdictThreshold`.

- تصنيف بلا منتجات ⇒ المعدلات `unavailable("no_products_in_category")`، لا صفر (الصفر كان سيقرأ كـ«منتجاته سيئة»).
- `salesAttribution` **دائمًا** `unavailable("product_sales_not_linked")` — العمود موجود ليقول السبب، لا ليُملأ بتقدير.
- `hidden` من `categories.status`، وهو حقل موثّق في استجابة Salla.

## 16. واجهات API

جميعها `GET` فقط، تحت `/api/organizations/current/stores/[storeId]/product-intelligence/`:

| المسار | الاستعلام | الإسقاط |
|---|---|---|
| `overview` | — | المقاييس + العدّادات + أفضل 5 مشكلات وتوصيات + التعريفات + «غير المتاح بالتصميم» |
| `products` | `page`, `pageSize` (≤100), `q` (اسم/SKU), `filter=all\|attention\|clean` | صفحة منتجات مرتّبة بالأسوأ أولًا |
| `categories` | — | صفوف صحة التصنيفات |
| `issues` | — | المشكلات مرتّبة كاملة |
| `recommendations` | — | التوصيات كاملة |

- كل مسار يمرّ بـ: Session → Organization → Membership → Permission (`store:read`) → Store Access → RLS داخل `withTenantTransaction`.
- `storeId` أجنبي = **404** قبل قراءة أي منتج.
- تحقق صارم: `pageSize=500` ⇒ **422** `VALIDATION_FAILED` (لا قصّ صامت)، و`filter` غير معروف ⇒ 422.
- لا مسار سادس: لا تصدير، ولا «إصلاح»، ولا webhook.

## 17. الواجهة

`/app/stores/[storeId]/product-intelligence` — عربية RTL، خادم فقط (`force-dynamic`):

1. **نظرة عامة:** إجمالي المنتجات، تحتاج مراجعة، متوسط جودة المحتوى، تغطية الصور، صحة البيانات الوصفية، تغطية التصنيفات، مخفية، محتوى قديم؛ وصف سريع لمنتجات سليمة/بلا تصنيف/نافدة/إجمالي المشكلات.
2. **شريط التغطية والثقة:** الحالة، آخر مزامنة ناجحة، وملاحظات النقص بالعربية.
3. **جدول المنتجات:** الدرجة من 100 مع الفحوص الفاشلة ووزن كل منها، البيانات الوصفية، حالة الصورة، المخزون، آخر تحديث و«قديم/حديث/غير معروف»، عدد المشكلات، الخطورة؛ بحث بالاسم/SKU، مرشّح (الكل/تحتاج مراجعة/سليمة)، وترقيم صفحات.
4. **المشكلات مرتّبة:** الدرجة، القاعدة، الخطورة، العدد، النسبة، الأمثلة.
5. **صحة التصنيفات:** بلا عمود مبيعات مزيّف، مع سبب غياب أداء المبيعات.
6. **التوصيات:** بطاقة لكل توصية مع القاعدة والأدلة ووسم «استشارية فقط — لا تنفيذ».
7. **تعريفات وحدود:** ماذا يقيس كل مؤشر، وما لا يمكن قياسه ولماذا.

كل قيمة غير متاحة تظهر `—` + السبب العربي من `REASON_LABELS_AR` (أُضيفت 18 تسمية جديدة). لا `0` مكان غياب. أُضيفت بطاقة ثالثة في صفحة المتجر؛ لم يُضف رابط في الشريط العلوي لأن صفحات التحليل مرتبطة بمتجر ولا يوجد محدّد متجر في الشريط (كما في Phase 07/08).

## 18. الاختبارات

### 18.1 وحدة — 8 ملفات / 111 اختبارًا

| الملف | الاختبارات | التركيز |
|---|---|---|
| `content.test.ts` | 10 | الأوزان، الحدود، code points، صحة URL |
| `metadata-images.test.ts` | 7 | `partial` عند غياب الكائن؛ العدد/alt غير متاحين دائمًا |
| `lifecycle.test.ts` | 7 | الحد 90 يومًا، `ageDays` غير متاح، تاريخ تالف، `hidden` |
| `commercial.test.ts` | 12 | السعر 0 مقابل مفقود، أفضلية المخزون، `unlimited`، `outOfStock: null` |
| `issues.test.ts` | 32 | كل قاعدة منفردة، عدم تعارض الوصف، الترتيب الحتمي بترتيب إدخال معكوس |
| `recommendations.test.ts` | 8 | توصية لكل مشكلة فقط، الأدلة، الأولوية، `advisoryOnly` |
| `catalog.test.ts` | 22 | التغطية، الثقة، `partial`، الصفر المقيس، صحة التصنيفات |
| `query.test.ts` | 13 | رفض `page`/`pageSize`/`filter` غير الصالح، الترتيب، الترقيم، البحث |

### 18.2 تكامل — `product-intelligence.integration.test.ts` (17 اختبارًا)

PostgreSQL حقيقي + محاكي Salla، والكتالوج يصل عبر **مسار المزامنة الحقيقي** (OAuth → `syncStore` → mappers → repositories):

- لقطة كاملة: تغطية، ثقة، مقاييس، تعريفات، وخمسة «غير متاح بالتصميم».
- كتالوج غير مُزامَن: `unavailable("catalog_not_synced")` لا أصفار.
- تجميع المخزون عبر صفوف المتغيّرات (5 + 2 = 7، ومبيع تراكمي 34).
- الترتيب والصفحات والبحث والمرشّح.
- `periodSales`/`revenue`/`ageDays` غير متاحة في كل صف.
- `pageSize=500` ⇒ 422.
- المشكلات: الدرجة = العدد × الوزن، والترتيب تنازلي، وأعلى مشكلة `missing_description` (2 منتجات).
- التوصيات: تطابق تام مع المشكلات المطلقة، القاعدة، النسبة، الأمثلة، `advisoryOnly`.
- **بنية للقراءة فقط:** الوحدات الخمسة تصدّر `GET` ولا تصدّر `POST`/`PUT`/`PATCH`/`DELETE`.
- صحة التصنيفات: الأعداد والنسب، `salesAttribution` غير متاح، التصنيف المخفي.
- الأمان: 401 لخمسة مسارات بلا جلسة؛ 404 لمستأجر آخر بلا تسريب معرّفات أو أسماء؛ عزل متجرين داخل المؤسسة نفسها؛ مشاهد يقرأ بلا حقول هوية؛ انعدام `store:read` لا يحدث لأي دور لكنه مُثبَّت بالاختبار؛ و`TENANT_ISOLATION_VIOLATION` عند تمرير مؤسسة أخرى.

## 19. الأمان

- **سلسلة المستأجر:** الجلسة تُحدَّد أولًا، ثم العضوية في المؤسسة الحالية، ثم `store:read`، ثم التحقق من ملكية المؤسسة للمتجر (`requireStoreAccess`)، ثم كل استعلام داخل `withTenantTransaction` (RLS جدار ثانٍ).
- `organizationId`/`storeId` لا يُقبلان من العميل كسلطة: `storeId` في المسار يُتحقق منه، لا يُوثق به.
- الحمولة خالية من الهوية: لا بريد، لا هاتف، لا اسم عميل، لا عنوان، ولا رموز وصول. اختبار تكامل يفحص التسلسل الكامل.
- **قراءة فقط بنيويًا:** لا مسار كتابة، ولا عميل Salla في هذه الوحدة، ولا زر تنفيذ.
- رؤوس الأمان لم تُمَس، ولا تغيير في CSRF/الجلسات.

## 20. الأداء

- **4 استعلامات مجمّعة** لكل طلب: منتجات المتجر (إسقاط ضيق)، كل روابط التصنيفات، كل التصنيفات، كل صفوف المخزون. ثم تجميع في الذاكرة.
- **صفر N+1:** لا استعلام لكل منتج، ولا نداء Salla لكل منتج (ADR-056).
- المفهرسات القائمة على `store_id` تخدم الاستعلامات الأربعة؛ لا استعلامات `LIKE` غير مفهرسة (البحث داخل الصفحة المحسوبة).
- لا كاش خارجي، لا Redis، لا Elasticsearch، لا طوابير.
- التكلفة تُعاد كل طلب (لا جدول مشتقات) — مقبولة لحجم كتالوج متجر واحد، وتُراجع إن تجاوز الكتالوج حدًّا يظهر في زمن الاستجابة.

## 21. القيود والأسئلة المفتوحة

**قيود مقصودة (ليست أخطاء):**

1. `views` غير محفوظ ⇒ لا «مشاهدات» ولا «معدل تحويل» ولا «الأكثر مشاهدة».
2. `images[].alt` وعدد الصور غير محفوظين ⇒ لا تحليل التكرار ولا جودة النص البديل.
3. لا `created_at` ⇒ لا عمر منتج ولا «منتجات جديدة».
4. `sold_quantity` تراكمي بلا فترة ⇒ لا مبيعات فترة ولا سرعة بيع.
5. جودة المحتوى تقيس الوجود والأطوال لا جودة الصياغة، ولا لغة محددة (المحفوظ بلغة المتجر الافتراضية).
6. تصنيفات كصحة كتالوج لا أداء؛ لا إيراد لكل تصنيف.
7. بيانات كشخة الحقيقية غير مستخدمة، والمزامنة الحيّة لم تُختبر في هذه المرحلة (لا نداء جديد أصلًا).

**أسئلة مفتوحة (تحتاج تحققًا حيًّا من Salla أو قرار مالك):**

1. هل يوجد تقرير موثّق يعيد مبيعات لكل منتج بفترة؟ إن وُجد، يُفتح له مسار مستقل بدل الاستنتاج.
2. هل يمكن تخزين `images[]` كاملًا أثناء مزامنة المنتجات دون نداء إضافي (موجود في استجابة القائمة)؟ قرار تخزين جديد يحتاج مراجعة Phase 04.
3. هل `metadata.title/description` مضمونان في كل استجابة، أم يغيبان لبعض أنواع المنتجات؟ يؤثر على تفسير `metadataHealthPercent`.

## 22. Git

- `feat(product-intelligence): read-only catalogue health, ranked issues, and evidence-backed recommendations`
- `test(product-intelligence): unit and PostgreSQL integration coverage for the read model`
- `docs(phase-09): product intelligence design, evidence, and limitations`

لا force push، ولا تعديل على هجرات سابقة، ولا تغيير خارج نطاق المرحلة.

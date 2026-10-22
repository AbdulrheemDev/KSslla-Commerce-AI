# Phase 07 — ذكاء المتجر (Store Intelligence)

> **الحالة:** مكتمل داخل نطاق المرحلة، بلا وكيل ذكاء اصطناعي وبلا كتابة إلى Salla.
> **التاريخ:** 2026-10-22. **الفرع:** `arena/8ae97403-ksslla-commerce-ai`.
> **الاعتماد:** يقرأ فقط ما جعلته المراحل 03–06 متاحًا في القاعدة المحلية. لا نداء Salla جديد، ولا حقل مُخترع.

---

## 1. الهدف

أن **يفهم** النظام المتجر من بياناته الفعلية، لا أن يعرض رسومًا تجميلية:

- ما الذي يبيع وما الذي لا يبيع؟
- أين خطر نفاد المخزون؟
- أي فئة تتحرك وأي فئة ساكنة؟
- أين تُفقد الفرص؟
- وما الإجراء الذي يستحق أن يتخذه صاحب المتجر الآن؟

كل رقم في هذه المرحلة **محسوب من صفوف موجودة**، وكل رقم لا يمكن حسابه يُعاد `unavailable` مع سبب مقروء — لا صفر، ولا تقدير، ولا «+24%» مُختلق.

### 1.1 خارج النطاق (مقصود)

| خارج النطاق | لماذا |
|---|---|
| أي مزوّد ذكاء اصطناعي (OpenAI/Claude/Gemini…)، أي prompt، أي وكيل | قرار المرحلة: التحليل حتمي (deterministic) وقابل للتفسير |
| أي كتابة إلى Salla (تعديل مخزون/سعر/حالة) | القراءة فقط؛ مستويات READ/RECOMMEND لم تُتجاوز |
| SEO، التسويق، أتمتة النمو، Phase 08 | خارج نطاق المرحلة |
| تنبؤات مخزون، معدل بيع بوحدة/يوم، «أيام حتى النفاد» | لا فترة موثّقة لـ `sold_quantity` (انظر §5.2) |
| إيراد على مستوى المنتج/الفئة، مساهمة الفئة في الإيراد | سطور الطلب لا تحمل معرّف منتج ولا سعر سطر (§4.2) |
| استنتاجات نفسية أو ديموغرافية عن العملاء | ممنوعة صراحةً؛ العملاء أرقام مجمّعة فقط |
| تخزين مقاييس جاهزة (materialized metrics) | لا حاجة مُثبتة؛ الحساب على الطلب (on read) من بيانات مفهرسة |

---

## 2. البنية

```
src/modules/intelligence/
├── domain/                    # حساب نقي: بلا Next.js، بلا Drizzle، بلا Salla SDK، بلا AI
│   ├── types.ts               # Metric<T> + Availability + Coverage + Freshness + Envelope
│   ├── thresholds.ts          # كل العتبات الرقمية في مكان واحد، مع وحدة كل عتبة وأثرها
│   ├── period.ts              # النوافذ الزمنية، الفترة السابقة، التغطية، وجود أساس للمقارنة
│   ├── sales.ts               # مبيعات ونمو
│   ├── products.ts            # تصنيف المنتجات + ملخّص + ترتيب
│   ├── inventory.ts           # مخزون حالي ومخاطر
│   ├── customers.ts           # مجاميع عملاء بلا هوية
│   ├── categories.ts          # مجاميع فئات
│   ├── health.ts              # درجة صحة المتجر
│   ├── opportunities.ts       # محرّك الفرص + التوصية داخل كل فرصة
│   └── insight.ts             # واجهة مستقبلية للذكاء الاصطناعي — أنواع فقط، بلا تنفيذ
├── infrastructure/
│   └── intelligence-repository.ts   # قراءات Drizzle داخل معاملة مستأجر
└── application/
    └── intelligence-service.ts      # التحقق من الصلاحية والملكية، تجميع اللقطة، المغلف
```

**قاعدة الاتجاه:** `domain` لا يستورد شيئًا من الطبقات الأعلى ولا من مزوّد خارجي. كل ما يحتاجه يصل كوسائط. لذلك يمكن اختبار القواعد كلها بلا قاعدة بيانات ولا شبكة (83 اختبار وحدة).

**لا هجرة جديدة:** المقاييس تُحسب من جداول موجودة (`products`, `categories`, `product_categories`, `orders`, `order_items`, `customers`, `inventory_levels`, `sync_runs`). لا جدول ملخّصات، ولا عمود جديد.

---

## 3. عقد الاستجابة (كل نقطة نهاية)

```jsonc
{
  "data": {
    "storeId": "…",
    "generatedAt": "2026-10-22T18:00:00.000Z",
    "period":   { "key": "30d", "from": "…", "to": "…", "days": 30 },
    "coverage": {
      "requestedFrom": "…", "requestedTo": "…",
      "firstOrderAt": "…", "lastOrderAt": "…",
      "status": "complete | partial | empty",
      "notes": ["history_starts_after_window"]
    },
    "freshness": {
      "syncedAt": "…",
      "resources": [{ "resource": "orders", "status": "succeeded", "lastSuccessAt": "…", "lastFailureAt": null, "lastErrorCode": null, "stale": false }],
      "staleResources": []
    },
    "data": { /* حمولة النقطة */ }
  }
}
```

كل متري داخل `data` يأخذ الشكل:

```jsonc
{ "value": 600 | null, "availability": "available | partial | unavailable",
  "basis": "sum(orders.total_amount excluding canceled)", "reason": null | "orders_not_synced" }
```

- `reason` **إلزامي** عند `partial`/`unavailable`.
- الواجهة تعرض `—` + سبب عربي عند غياب القيمة، ولا تعرض `0` مكانها.
- `coverage` و`freshness` تُرسل مع **كل** استجابة، لا مع النظرة العامة فقط.

---

## 4. توافر البيانات — ما يمكن قوله وما لا يمكن

### 4.1 المصادر المتاحة

| المصدر | الحقول المستخدمة | من أين جاءت |
|---|---|---|
| `products` | `name, status, price_amount, currency, quantity, is_available, image_url` | Phase 04 (`GET /products`) |
| `categories`, `product_categories` | أسماء الفئات والربط many-to-many | Phase 04 (`GET /categories`) |
| `orders` | `status_slug, total_amount, currency, draft, order_date, customer_id, items_count` | Phase 05 (`GET /orders`) |
| `customers` | `id`, `source_created_at` فقط | Phase 05 (`GET /customers`) |
| `inventory_levels` | `quantity, sold_quantity, unlimited_quantity, price_amount` | Phase 05 (`GET /products/quantities`) |
| `sync_runs` | حالة كل مورد وآخر نجاح/فشل | Phase 05/06 |

### 4.2 القيد المركزي: لا إسناد مبيعات إلى منتج

`List Orders` يعيد لكل سطر `name`, `quantity`, `thumbnail` فقط — **بلا** معرّف منتج وبلا سعر سطر (موثّق في `docs/salla-reference.md` §12.2، ADR-043). النتيجة المباشرة:

- **إيراد المنتج** = `unavailable("line_level_data_unavailable")`.
- **إيراد الفئة ومساهمتها** = `unavailable` بالسبب نفسه.
- **معدل البيع (وحدة/يوم)** و**أيام المخزون** = `unavailable("no_sales_period")` لأن `sold_quantity` قيمة تراكمية **لا توثّق Salla فترتها**.
- لا مطابقة بالاسم، ولا ضرب السعر الحالي في كمية مبيعية تراكمية (ذاك رقم لم يحدث قط).

ما **يمكن** قوله: الكميات المبيعة التراكمية لكل منتج، والمخزون الحالي، وأعداد الطلبات وقيمتها، ومتوسط قيمة الطلب، والنمو بين نافذتين، وأعداد العملاء، ومجاميع الفئات بالوحدات.

### 4.3 قيد الحالات

Salla لا تنشر تعدادًا مغلقًا لحالات الطلب. المعروف من الأمثلة: `completed`, `canceled`, `under_review`, `payment_pending`, `in_progress`، ويمكن للتاجر إنشاء حالات مخصّصة. لذلك:

- `completed` و`canceled` يُعاملان بالاسم؛
- كل ما عداهما يُجمع في `otherStatusOrders` ولا يُخمَّن كـ«مكتمل»؛
- **لا خانة «مرتجع»**: لا توجد حالة `refunded` موثّقة، رغم وجود حدث ويبهوك `order.refunded` (لا يعني حالة طلب). لا نخترع تصنيفًا لعكس المال.

---

## 5. المقاييس والصيغ

### 5.1 المبيعات (`sales.ts`)

| المتري | الصيغة | الحالة الخاصة |
|---|---|---|
| `orders` | `count(orders WHERE draft = false AND order_date ∈ window)` | غير مُزامن ⇒ `unavailable("orders_not_synced")`؛ فشل آخر مزامنة ⇒ `partial("orders_sync_incomplete")` |
| `completedOrders` | نفس المجتمع مع `status_slug = 'completed'` | كالسابق |
| `cancelledOrders` | نفس المجتمع مع `status_slug = 'canceled'` | كالسابق |
| `otherStatusOrders` | الباقي | كالسابق |
| `totalOrderValue` | `Σ total_amount` للطلبات غير المسودة **وغير الملغاة**، بعملة واحدة | عملات مختلفة ⇒ `mixed_currency`؛ إجمالي ناقص ⇒ `partial("some_orders_missing_total")`؛ غير مُزامن ⇒ `orders_not_synced` |
| `completedOrderValue` | `Σ total_amount WHERE status = completed` | لا طلبات مكتملة ⇒ `0` حقيقي (`available`) |
| `averageOrderValue` | `totalOrderValue ÷ عدد الطلبات المقيمة غير الملغاة` | لا إجماليات ⇒ `no_order_totals`؛ مختلط ⇒ `mixed_currency` |
| `ordersGrowthPercent` | `(current − previous) / previous × 100` | `previous = 0` ⇒ `no_baseline_orders`؛ التاريخ لا يغطي الفترة السابقة ⇒ `no_baseline_period` |
| `valueGrowthPercent` | نفس المعادلة على القيمة | تشترط عملة واحدة في النافذتين |
| `currency` | عملة الطلبات المقيمة | لا إجماليات ⇒ `unavailable` |

**قرارات محسومة:**

1. **الطلبات الملغاة مستبعدة من كل رقم مالي** (قيمة، متوسط، نمو قيمة، إيراد العملاء). الملغى ليس بيعًا. تُحتسب فقط في `cancelledOrders`.
2. **المسودّات مستبعدة من كل شيء** — هي ليست طلبات بعد.
3. **لا يُخلط SAR بـ USD** ولا يُعتبر إجمالي غائب صفرًا.
4. **النوافذ UTC**: حدود اليوم/النافذة محسوبة بـ UTC لأن كل طلب يحمل منطقته الخاصة، ولا يوجد في الوثائق «منطقة المتجر». اعتماد `Asia/Riyadh` كان سيُزيح أول وآخر ساعة من كل نافذة لمتاجر خارجها.

### 5.2 المنتجات (`products.ts`)

المدخلات لكل منتج: المخزون (أولوية: `Σ inventory_levels.quantity` ثم `products.quantity`)، `sold_quantity` التراكمي، `unlimited_quantity`، السعر، التصنيفات، الصورة، الحالة.

| التصنيف | قاعدة الإسناد (بالترتيب) |
|---|---|
| `insufficient_data` | لا مخزون ولا مبيعات، أو لا مخزون مع غياب `sold_quantity` |
| `inventory_risk` | مخزون `≤ 0` ومبيعات `≥ 1` — أو `0 < مخزون ≤ 5` ومبيعات `≥ 1` |
| `star` | مبيعات `≥ 10` |
| `growth_opportunity` | مبيعات `≥ 3` وأقل من 10 |
| `low_performer` | مخزون `≤ 0` بلا مبيعات، أو مبيعات `= 0` مع مخزون متاح |
| `stable` | داخل العتبات |

`unlimited_quantity = true` يلغي إشارات النفاد/الانخفاض (منتج غير محدود لا ينفد منطقيًا).

المقاييس المرفقة: `price`, `stock`, `stockSource`, `unitsSold` (قيمة مزوّد تراكمية — يُذكر ذلك في `basis`)، و`revenue`/`velocity`/`daysOfStock` = `unavailable` مع السبب. `signals` تذكر أسباب القلق: `out_of_stock`, `low_stock`, `no_sales`, `missing_price`, `missing_category`, `missing_image`, `hidden`.

`ProductSummary`: الإجمالي، المتوفر، النافد، المنخفض، بلا مبيعات، ناقص السعر/التصنيف/الصورة، وعدد بحسب التصنيف.

`rankings`: أعلى/أدنى 10 بحسب `sold_quantity` التراكمي؛ الترتيب لا يُسمّى «الأكثر مبيعًا هذا الشهر» — بل «تراكمي».

### 5.3 المخزون (`inventory.ts`)

| المتري | المعنى |
|---|---|
| `trackedEntries` | عدد صفوف مستويات المخزون (يتكرر المنتج لكل متغيّر) |
| `trackedProducts` | عدد المنتجات المميزة |
| `totalUnits` | مجموع وحدات **المنتجات المحدودة** فقط (غير المحدود لا يدخل في رقم كمية) |
| `outOfStock` | منتجات بكمية `≤ 0` |
| `lowStock` | `0 < quantity ≤ 5` |
| `overstock` | `quantity ≥ 50` مع `sold = 0` |
| `unlimited` | منتجات `unlimited_quantity = true` |
| `lastSyncedAt` | أحدث `last_synced_at` في صفوف المخزون |
| `velocity`, `daysOfStock` | `unavailable("no_sales_period")` |

`risk` لكل عنصر: `out | low | overstock | unlimited | ok`.

### 5.4 العملاء (`customers.ts`)

مجاميع فقط، **بلا اسم/بريد/جوال/عنوان/سجل فردي**:

| المتري | الصيغة |
|---|---|
| `customers` | `count(customers)` — `partial` إذا فشلت آخر مزامنة |
| `newCustomers` | عدد من `source_created_at ∈ window`؛ `partial("source_created_at_missing_for_some_customers")` عند وجود عملاء بلا تاريخ إنشاء (القائمة لا توثّق `created_at`) |
| `returningCustomers` | عملاء بـ `orders ≥ 2` |
| `customersWithOrders` | عملاء بـ `orders ≥ 1` |
| `ordersPerCustomer` | `Σ طلبات ÷ عدد العملاء الذين طلبوا` |
| `repeatPurchaseRate` | `returning ÷ customersWithOrders × 100` |
| `customerRevenue` | `Σ total_amount` لطلبات العملاء غير الملغاة |
| `averageRevenuePerCustomer` | `customerRevenue ÷ customersWithOrders` |

الطلبات الملغاة مستبعدة من عدّ العملاء وإيرادهم أيضًا، ليتطابق رقم العملاء مع رقم المبيعات في نفس الصفحة.

### 5.5 الفئات (`categories.ts`)

لكل فئة: `productCount`، `availableProducts`، `unitsSold` (`Σ sold_quantity` لأعضائها)، `revenue` = `unavailable`، `contribution` = `unavailable`، و`weak = productCount ≥ 2 && كل المبيعات معروفة && المجموع = 0`.

الربط **many-to-many**: المنتج يُحتسب في كل فئة ينتمي إليها، لذلك مجموع الفئات قد يتجاوز مجموع المتجر — وهذا مصرّح به في الحمولة (`manyToMany: true`) وفي الواجهة.

`uncategorisedProducts` يعدّ المنتجات بلا أي فئة.

### 5.6 درجة صحة المتجر (`health.ts`)

| المكوّن | الوزن | الصيغة |
|---|---|---|
| `catalog_completeness` | 25 | `100 − (ناقص سعر + ناقص تصنيف + ناقص صورة) ÷ (3 × عدد المنتجات) × 100` |
| `stock_health` | 20 | `inStock ÷ stockKnown × 100` |
| `sales_activity` | 25 | `min(100, طلبات مكتملة/30 يومًا ÷ 10 × 100)` |
| `sync_health` | 15 | `موارد مزامنتها ليست قديمة ÷ الموارد التي نجحت مرة × 100` |
| `freshness` | 15 | سلّم: `≤1 ساعة 100 · ≤24 ساعة 75 · ≤7 أيام 40 · غير ذلك 10` |

- المكوّن غير القابل للحساب **يُستبعد** ويُعاد تطبيع الوزن على المتاح، وتصبح الدرجة `partial("some_components_unavailable")`.
- أقل من **مكوّنين** صالحين ⇒ `insufficient_data` و`grade = null`. درجة من مكوّن واحد تبدو موثوقة وهي لا تقول شيئًا.
- الدرجة: `≥85 excellent · ≥70 good · ≥50 fair · <50 poor`.

### 5.7 الفرص والتوصيات (`opportunities.ts`)

كل فرصة: `id, type, severity, entityType, entityId, title, description, evidence[], recommendedAction, rationale, confidence, createdAt`.
`evidence` تحمل **القيم المحسوبة نفسها** (المخزون، المبيعات، العتبة) — لا نصًا عامًا. `rationale` يذكر القاعدة بالأرقام. `confidence` (`high|medium|low`) مشتقة من اكتمال القيم: قيم `available` ⇒ high، فيها `partial` ⇒ medium، فيها `unavailable` ⇒ low.

| النوع | القاعدة | الشدة |
|---|---|---|
| `out_of_stock` | مخزون `≤ 0` (بلا شرط مبيعات؛ العنوان يختلف بحسب وجود مبيعات سابقة) | high |
| `high_sales_low_stock` | `0 < مخزون ≤ 5` ومبيعات `≥ 10` | high |
| `low_stock` | `0 < مخزون ≤ 5` ومبيعات `≠ 0` وأقل من 10 | medium |
| `overstock` | مخزون `≥ 50` ومبيعات `= 0` والمنتج غير مخفي | medium |
| `slow_mover` | مخزون `> 5` ومبيعات `= 0` وغير مخفي | low |
| `weak_category` | فئة بعدد منتجات `≥ 2` ومبيعات صفر | low |
| `incomplete_product_data` | منتج واحد على الأقل بلا سعر/تصنيف/صورة | low |
| `stale_sync` | مورد آخر مزامنة ناجحة له أقدم من 24 ساعة | medium |
| `no_recent_sales` | الطلبات مُزامنة، الفترة غير فارغة، والطلبات المكتملة `= 0` | medium |

الترتيب: الشدة ثم النوع ثم العنوان (حتمي). السقف 50 عنصرًا؛ `total` و`countsByType` يعدّان **كل** ما أُثير قبل القص.

#### انحراف موثّق عن قائمة المرحلة

قائمة المرحلة ذكرت أيضًا: `declining_product`, `growing_product`, `high_revenue_product`, `low_activity`. **لم تُنفَّذ** لأنها تحتاج مبيعات منتج داخل فترة أو إيراد منتج — وكلاهما غير متاح موثوقًا (§4.2). تنفيذها كان سيتطلب اختراع إسناد. البديل الحتمي المتاح: `slow_mover`, `weak_category`, `no_recent_sales`, والتصنيفان `star` و`growth_opportunity` (تراكميان، مُسمّيان كذلك في الواجهة).

**قاعدة العتبات:** كل الأرقام في `thresholds.ts` مع وحدة كل عتبة والقاعدة التي تستخدمها وأثر تغييرها، وتُعرض في الواجهة داخل «كيف تُحسب هذه الأرقام؟».

### 5.8 `IntelligenceInsight` (واجهة مستقبلية فقط)

`domain/insight.ts` يعرّف شكل أي شرح مستقبلي (نوع، كيان، عنوان، نص، `evidence` من نفس المتريات، ثقة، `generatedBy`). لا مزوّد، لا SDK، لا نداء شبكة، و`advisoryOnly: true` تجعل الإجراء مستحيلًا بنيويًا. هذه المرحلة **لا تولّد** أي `IntelligenceInsight`.

---

## 6. النوافذ والتغطية والحداثة

- النوافذ المدعومة: `today` (من بداية يوم UTC حتى الآن)، `7d`, `30d`, `90d`, ونافذة `custom` بحد أقصى **366 يومًا**.
- أي نافذة غير مدعومة أو نطاق معكوس/مستحيل (مثل `2026-02-31`) ⇒ `422 VALIDATION_FAILED`، لا تصفية صامتة.
- `coverage.status`:
  - `empty` — لا طلبات محفوظة أصلًا (`no_orders_stored`)؛
  - `partial` — التاريخ يبدأ بعد بداية النافذة (`history_starts_after_window`) أو آخر مزامنة فشلت (`orders_sync_incomplete`)؛
  - `complete` — النافذة داخل التاريخ والمزامنة سليمة.
- `freshness` تُبنى من `sync_runs`: لكل مورد آخر نجاح/فشل ورمز خطأ، و`stale` إذا تجاوز العمر 24 ساعة.
- لا تُعرض «مبيعات اليوم» إذا لم ينجح أي sync للطلبات: `orders` تكون `unavailable("orders_not_synced")`، والواجهة تكتب «لا توجد بيانات كافية بعد» مع السبب.

---

## 7. الأمان والعزل بين المستأجرين

سلسلة القرار في كل طلب:

```
جلسة (cookie) → requireOrganizationAccess → TenantContext
  → assertPermission(context, "store:read")
  → requireStoreAccess(db, context, storeId)   ← ملكية المتجر داخل المنظمة (وإلا 404)
  → withTenantTransaction(context)             ← RLS + tenant_id في كل استعلام
```

- **لا يُقرأ `organizationId` ولا `storeId` من الحمولة**: الأول من الجلسة، والثاني من المسار ويُتحقّق من ملكيته.
- متجر منظمة أخرى ⇒ **404** لا 403 ولا لوحة فارغة — لا نكشف وجود المعرّف.
- `viewer` و`analyst` يملكان `store:read` فيقرآن التحليل؛ لا صلاحية كتابة مطلوبة أصلًا.
- **لا PII**: استعلامات العملاء تقرأ `id` و`source_created_at` فقط؛ الحمولة تحمل مجاميع. اختبار تكاملي يفشل إذا ظهر بريد أو رقم جوال أو `first_name` في الاستجابة.
- الحمولات `Cache-Control: no-store`، والأخطاء تمرّ عبر `withApi` فلا تتسرّب تفاصيل السائق.

---

## 8. واجهات API

جميعها `GET`، `dynamic = "force-dynamic"`، `runtime = "nodejs"`:

| المسار | الحمولة |
|---|---|
| `/api/organizations/current/stores/{storeId}/intelligence/overview` | `sales`, `products{total,inStock,outOfStock,lowStock,unsold,byClass}`, `inventory{...}`, `customers`, `health`, `opportunities{total, top≤5}`, `definitions` |
| `…/intelligence/products` | `summary`, `items ≤ 200`, `total`, `truncated`, `rankings{top,bottom}`, `definitions` |
| `…/intelligence/categories` | `totalCategories`, `uncategorisedProducts`, `items[]`, `manyToMany` |
| `…/intelligence/inventory` | `trackedEntries`, `trackedProducts`, `totalUnits`, `outOfStock`, `lowStock`, `unlimited`, `overstock`, `lastSyncedAt`, `velocity`, `daysOfStock`, `items[]` |
| `…/intelligence/customers` | المجاميع الثمانية + `currency` |
| `…/intelligence/opportunities` | `items`, `total`, `truncated`, `countsByType` |

**انحراف تسمية مقصود:** وُضعت المسارات تحت `api/organizations/current/stores/{storeId}/…` بدل `/api/stores/{storeId}/…` المذكور في نص المرحلة، لتطابق نمط المشروع القائم (`catalog/*`, `data/*`, `webhooks/*`). المتطلبات الأمنية هي المطلوبة نفسها، والعزل نفسه.

لا توجد نقطة توصيات منفصلة: التوصية جزء من كل فرصة (`recommendedAction` + `rationale`)، فلا تُفصل عن دليلها.

---

## 9. الواجهة (عربية RTL)

المسار: `/app/stores/{storeId}/intelligence` — صفحة خادم واحدة تطلب لقطة واحدة (`getIntelligenceDashboard`) فتُظهر كل الأقسام من **نفس اللحظة**.

| القسم | المحتوى |
|---|---|
| الترويسة | اسم المتجر، مسار التنقل، تبويبات النوافذ (اليوم/7/30/90)، شارة التغطية والحداثة |
| نظرة عامة | بلاطات: الطلبات، المكتملة، الملغاة، أخرى، قيمة الطلب، متوسط الطلب، النمو، المنتجات، العملاء |
| صحة المتجر | الدرجة + المكوّنات وأوزانها + ما لم يُحسب ولماذا |
| الفرص | بطاقات: ماذا، لماذا (الدليل بالأرقام)، وماذا تفعل — بحد أقصى 8 على الصفحة |
| المنتجات | جدول 20 صفًا مع شارة التصنيف، والأكثر/الأقل مبيعًا تراكميًا |
| المخزون | نافد/منخفض/راكد/غير محدود + آخر مزامنة |
| الفئات | جدول الفئات مع «غير مصنّف» |
| الذيل | «كيف تُحسب هذه الأرقام؟» — تعريفات كل متري وعتبة |

قواعد العرض:

- قيمة `null` ⇒ `—` مع سبب عربي مقروء (`reasonLabel`)، **لا صفر**.
- الأرقام بصيغة `ar-SA` مع أرقام لاتينية (`latn`) وتقويم ميلادي (`gregory`) — لا خلط.
- لا بيانات ⇒ «لا توجد بيانات كافية بعد» + سبب التغطية.
- كل الملصقات عربية؛ لا نصوص تجريبية ولا أرقام ثابتة.

نقطة دخول من صفحة المتجر (`commerce-store-header.tsx` + بطاقة في صفحة المتجر) — الصفحة ليست يتيمة.

---

## 10. الاختبارات

### 10.1 وحدة (83 اختبارًا في 8 ملفات)

`src/modules/intelligence/domain/*.test.ts`: المبيعات (مسودّات، ملغاة، عملات مختلطة، إجمالي ناقص، نمو بلا أساس، متوسط، صفر حقيقي)، المنتجات (كل تصنيف، عتبات، غير محدود، مخزون من المصدرين، رفض الإيراد)، المخزون (المخاطر، الوحدات، غير المحدود)، العملاء (بلا هوية، تاريخ إنشاء ناقص، قسمة على صفر، عملات مختلطة)، الفئات (many-to-many، فئة ضعيفة، غير مصنّف)، الصحة (إعادة التطبيع، مكوّن واحد، الحدود)، الفرص (كل نوع، الترتيب، القص، الأدلة)، النوافذ (UTC، مخصص، أقصى مدى، التغطية، وجود الأساس).

### 10.2 تكامل على PostgreSQL حقيقي (14 اختبارًا)

`src/test/integration/intelligence.integration.test.ts` — البيانات تُدخل عبر **مزامنة Salla الفعلية** مع محاكي البروتوكول المحلي، لا بإدراج صفوف يدوي:

- متجر مُزامن كاملًا: الطلبات 4 (مسودة مستبعدة)، المكتملة 3، الملغاة 1، القيمة 600، المتوسط 200، النمو `no_baseline_period`، المنتجات 3، النافد 1، المنخفض 1، التصنيفات `star`/`inventory_risk`/`low_performer`.
- الفئات: `عطور` منتجان و42 وحدة (many-to-many)، منتج واحد غير مصنّف.
- العملاء: 3 عملاء طلبوا، إيراد 600، تكرار 0، و**لا PII** في الحمولة.
- متجر فارغ: `coverage = empty`، `orders = null` بسبب `orders_not_synced`، الصحة `null` — لا أصفار كاذبة.
- مزامنة فاشلة بعد نجاح: البيانات القديمة تبقى، الحالة `failed`، العدّ `partial("orders_sync_incomplete")`.
- نافذة مغطّاة بلا طلبات: `0` **متاح** (حقيقة)، لا `unavailable`.
- أمن: IDOR عبر كل النقاط الست ⇒ 404، متجر غير موجود ⇒ 404، بلا جلسة ⇒ 401، نوافذ غير صالحة ⇒ 422، رفض على مستوى الخدمة أيضًا، وقراءتان متتاليتان تعطيان نفس الأرقام (نموذج قراءة).

---

## 11. القيود المعروفة (لا أخطاء)

1. لا إيراد/معدل بيع/أيام مخزون على مستوى المنتج — قيد موثّق في Salla (§4.2).
2. `sold_quantity` تراكمية بلا فترة موثّقة؛ كل وصف في الواجهة يقول «تراكمي».
3. لا تنبؤ، ولا «سينفد بعد X يوم».
4. لا تمييز بين طلب مرتجع وآخر مكتمل: لا حالة موثّقة للمرتجع.
5. التصنيفات تعتمد على `products.quantity` أو مجموع مستويات المخزون؛ عند تعارضهما تُقدَّم مستويات المخزون ويُذكر المصدر (`stockSource`).
6. الفرص الأربع المذكورة في §5.7 غير منفّذة لغياب بيانات الإسناد.
7. المسار يخالف نص المرحلة حرفيًا (`api/organizations/current/...`) لصالح اصطلاح المشروع.

---

## 12. أسئلة مفتوحة

| # | السؤال | الأثر الحالي |
|---|---|---|
| 1 | ما الفترة التي تغطيها `sold_quantity` في Salla؟ | كل مشتقات المعدل/التنبؤ معطّلة، والعرض تراكمي فقط |
| 2 | هل `status.slug` مستقر عبر المتاجر أم يتأثر بحالات مخصّصة؟ | نعتمد `completed`/`canceled` فقط، والباقي `other` |
| 3 | أي حقل هو المرجع للمخزون عند التعارض: `products.quantity` أم `products/quantities`؟ | نقدّم مستويات المخزون ونفصح عن المصدر |
| 4 | كيف يمثّل Salla المرتجع (حالة أم حدث فقط)؟ | لا خانة مرتجع؛ الأرقام قد تفوق الصافي الفعلي |
| 5 | هل يمكن الحصول على مبيعات منتج داخل فترة من مصدر موثّق آخر (تقرير/تصدير)؟ | إن توفّر، تُفتح فرص `growing/declining/high_revenue` و`daysOfStock` |

---

## 13. التحقق

| الأمر | النتيجة |
|---|---|
| `npm run format:check` | ✅ (بعد تنسيق مسارات النقاط الست) |
| `npm run lint` | ✅ بلا تحذيرات |
| `npm run typecheck` | ✅ |
| `npm run test` (وحدة) | **36 ملفًا / 381 اختبارًا** ✅ — منها 8 ملفات / 83 اختبارًا لهذه المرحلة |
| `npm run test:integration` | **10 ملفات / 156 اختبارًا** ✅ — منها 14 اختبارًا لهذه المرحلة |
| `npm run check:secrets` | ✅ 283 ملفًا متعقّبًا، بلا أسرار |
| `npm run build` | ✅ والمسار `/app/stores/[storeId]/intelligence` ظاهر في مخرجات البناء |
| `npm run verify` | ✅ (السلسلة الكاملة أعلاه، تشغيل متصل) |

### 13.1 فحص واجهة يدوي (Smoke)

- شُغّل التطبيق محليًا على قاعدة بيانات جديدة، وأُنشئ حساب ومنظمة ومتجر، ثم فُتح `/app/stores/{storeId}/intelligence` بجلسة حقيقية.
- **متجر بلا بيانات:** HTTP 200، ورسالة «لا توجد بيانات كافية بعد» عند غياب الدليل، بلا أصفار كاذبة.
- **متجر بصفوف مُدخلة يدويًا في قاعدة معاينة مؤقتة** (وليس عبر مزامنة، هذا فحص عرض فقط): ظهرت 4 طلبات، 3 مكتملة، 1 ملغاة، قيمة 600.00 SAR، متوسط 200.00 SAR، نمو «غير متاح — لا توجد فترة سابقة كافية»، 3 عملاء، معدل تكرار 50%، تصنيفات المنتجات، وبطاقات الفرص مع «المخزون الحالي 2 وحدة / المبيعات 12 / الحد 5» و«ماذا تفعل». الحقول الغائبة ظهرت `—` مع السبب.
- **ما لم يُختبر:** لا اختبار متصفح آلي (لا Playwright)، ولا لقطات مقارنة بصرية. الفحص كان على HTML الناتج من الخادم.

> منهجية الإبلاغ: «مُنفَّذ» ≠ «مُختبَر محليًا» ≠ «مُختبَر بروتوكولًا» ≠ «مُختبَر على Salla حقيقي». هذه المرحلة **لم** تُختبر على متجر Salla حقيقي ولا على شبكة Salla؛ اختبارات التكامل تعمل على محاكي بروتوكول محلي فقط.

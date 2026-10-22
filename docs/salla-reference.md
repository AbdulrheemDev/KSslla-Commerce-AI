# Salla Integration Reference — Verified Facts Only

> **تاريخ التحقق:** 2026-10-21 (Phase 01/02) — أُعيد التحقق في **2026-10-22** لمسارات OAuth.  
> **المصدر الوحيد:** الوثائق الرسمية [docs.salla.dev](https://docs.salla.dev/)  
> **القاعدة:** لا يُكتب كود تكامل يعتمد على Endpoint أو Scope غير مسجّل هنا. أي معلومة غير مؤكدة تُعلَّم **⚠️ تحتاج تحققًا** ولا يُبنى عليها.  
> **سجل الأدلة الكامل لـ Phase 03:** §8. **تعارضات الوثائق:** §9.

---

## 0. سياسة الاستخدام

1. كل Endpoint يُستخدم يُضاف إلى **سجل Endpoints** (§2) مع:
   - Method + Path
   - Scope المطلوب
   - رابط الصفحة الرسمية
   - تاريخ التحقق
   - شكل الاستجابة (Zod schema لاحقًا)
2. لا تُخترع Scopes. تُقرأ من بوابة Salla Partners ومن استجابة التفويض.
3. أي تغيير في الوثائق يعيد التحقق قبل المرحلة التي تعتمد عليه.
4. اختبار التكامل على **Demo Store** رسمي، لا على متجر إنتاج.

---

## 1. الأساسيات

| البند | القيمة | المصدر |
|---|---|---|
| Base URL (Merchant API v2) | `https://api.salla.dev/admin/v2` | [Get Started](https://docs.salla.dev/) |
| إصدار API | v2 | [Get Started](https://docs.salla.dev/) |
| المصادقة | `Authorization: Bearer <ACCESS_TOKEN>` | [Authorization](https://docs.salla.dev/authorization) |
| HTTPS | إلزامي | [Security Considerations](https://docs.salla.dev/421121m0) |
| شكل الاستجابة | `{ status, success, data, pagination? }` | صفحات الـ API (مثال [List Orders](https://docs.salla.dev/5394146e0)) |

---

## 2. سجل Endpoints المعتمد

### 2.1 OAuth / الهوية

| Method | Endpoint | الغرض | Scope | الحالة | المصدر |
|---|---|---|---|---|---|
| GET | `https://accounts.salla.sa/oauth2/auth` | بدء التفويض | `offline_access` (للحصول على refresh) | ✅ موثّق ومُنفَّذ | [Authorization](https://docs.salla.dev/doc-421118) |
| POST | `https://accounts.salla.sa/oauth2/token` | تبادل code / تجديد | — | ✅ موثّق ومُنفَّذ | [Authorization](https://docs.salla.dev/doc-421118) |
| GET | `https://accounts.salla.sa/oauth2/user/info` | هوية المستخدم/التاجر | — | ✅ موثّق ومُنفَّذ | [User Information](https://docs.salla.dev/merchants/user-info) |
| — | `https://s.salla.sa/apps/install/{app-id}` | رابط التثبيت | — | ✅ موثّق (غير مُستخدَم آليًا) | [Authorization](https://docs.salla.dev/doc-421118) |

**الشكل النهائي لطلب الرمز (Phase 03، 2026-10-22):** `POST` إلى `https://accounts.salla.sa/oauth2/token` بجسم `application/x-www-form-urlencoded` يحتوي `grant_type`, `code`, `redirect_uri`, `client_id`, `client_secret` (أو `grant_type=refresh_token&refresh_token=…`). الأدلة في §8 الصفوف 2–4. الوثائق لا تعرض الجسم الخام؛ اعتمدنا RFC 6749 §4.1.3 (وهو ما يطبّقه عميل Salla الرسمي `SallaApp/oauth2-merchant`) ونسجّل ذلك كدليل ثانوي لا أساسي.

### 2.2 المتجر

| Method | Endpoint | الغرض | Scope | الحالة | المصدر |
|---|---|---|---|---|---|
| GET | `/store/info` | بيانات المتجر | ⚠️ غير مذكور في الصفحة | ✅ موثّق | [Store Information](https://docs.salla.dev/merchants/store-info) |

مثال استجابة موثّق (مختصر):

```json
{
  "status": 200,
  "success": true,
  "data": {
    "id": 1305146709,
    "name": "dev-wofftr4xsra5xtlv",
    "entity": "company",
    "email": "merchant@example.com",
    "plan": "pro",
    "type": "demo",
    "status": "active",
    "currency": "SAR",
    "domain": "https://salla.sa/dev-wofftr4xsra5xtlv"
  }
}
```

> `plan` مهم لاحقًا: حدود المعدل تعتمد على الخطة (Plus/Pro/Special).

### 2.3 Webhooks

| Method | Endpoint | الغرض | Scope | الحالة | المصدر |
|---|---|---|---|---|---|
| POST | `/webhooks/subscribe` | تسجيل Webhook | `webhooks.read_write` | ✅ موثّق | [Register Webhook](https://docs.salla.dev/webhooks/subscribe) |
| GET | `/webhooks/events` | قائمة الأحداث المتاحة | `webhooks.read` / `read_write` | ✅ موثّق | [List Events](https://docs.salla.dev/5394136e0) |
| — | صفحات إدارة الاشتراك (Update / List Active / Deactivate) | إدارة الاشتراك | `webhooks.read_write` | ⚠️ المسارات تُسجَّل قبل الاستخدام | — |

### 2.4 الكتالوج والطلبات (تُسجّل في مراحلها)

| المرحلة | ما سيُسجّل قبل التنفيذ |
|---|---|
| Phase 04 | List/Create/Update/Delete Products، Categories، Product Images، Product Tags، مع Scopes الفعلية |
| Phase 05 | List/Details Orders، Order Statuses، Customers، Product Quantities، مع Scopes الفعلية |
| Phase 06 | Webhooks update/active/deactivate، وسر التوقيع |

> **لا تُستخدم أي من هذه قبل قراءة صفحتها الرسمية وتسجيلها هنا.** وردت إشارات إلى مسارات مثل `GET /products` و`GET /orders` في الوثائق، لكنها لا تُعدّ معتمدة في هذا المشروع حتى تُسجّل بالشكل الكامل (scope + schema + تاريخ).

---

## 3. OAuth 2.0

### 3.1 الوضعان

| الوضع | الوصف | قرارنا |
|---|---|---|
| **Easy Mode** | Salla تُرسل `app.store.authorize` عبر Webhook يحتوي الرموز بعد التثبيت | **هدف الإنتاج** عند النشر في App Store؛ غير منفّذ (يتطلب Webhook) |
| **Custom Mode** | Redirect إلى callback مع `code` + `state`، ثم تبادل الرمز | **المنفَّذ في Phase 03** (الوثائق تخصّصه للاختبار) |

المصدر: [Authorization](https://docs.salla.dev/authorization).

### 3.2 معاملات التفويض الموثّقة

`client_id`, `response_type=code`, `redirect_uri`, `scope`, `state`.

- `state` إلزامي لدينا لمنع CSRF وربط الربط بالمؤسسة.
- `scope=offline_access` مطلوب للحصول على refresh token.

### 3.3 صلاحية الرموز — حرج

| الحقيقة | القيمة | المصدر |
|---|---|---|
| Access token | **14 يومًا** | [Authorization](https://docs.salla.dev/authorization) |
| Refresh token | **أحادي الاستخدام** | [Authorization](https://docs.salla.dev/authorization) |
| نافذة التجديد | خلال **شهر واحد** | [Get Started](https://docs.salla.dev/) |
| إعادة استخدام refresh مستخدم | إبطال refresh + إلغاء access tokens + رفض المحاولات اللاحقة | [Authorization](https://docs.salla.dev/authorization) |
| نتيجة الخطأ | إعادة تثبيت التطبيق من Salla App Store | [Authorization](https://docs.salla.dev/authorization) |

**المتطلبات المعمارية المترتبة:**

- تجديد استباقي قبل الانتهاء (نسبة أمان).
- قفل (row lock / distributed lock) يمنع تجديدين متوازيين.
- إعادة المحاولة عند فشل الشبكة بحذر دون إعادة استخدام refresh.
- مسار واضح لإعادة الربط عند `invalid_grant`.
- تشفير الرموز at-rest وعدم تسجيلها.

### 3.4 Easy Mode Payload (مرجعي)

حدث `app.store.authorize` يحتوي تقريبًا:

```json
{
  "event": "app.store.authorize",
  "merchant": 1234509876,
  "created_at": "2022-12-31 12:31:25",
  "data": {
    "access_token": "…",
    "expires": 1634819484,
    "refresh_token": "…",
    "scope": "settings.read branches.read offline_access",
    "token_type": "bearer"
  }
}
```

المصدر: [App Events](https://docs.salla.dev/421413m0). `expires` هنا Unix timestamp (كما تنص الوثائق).

### 3.5 هوية المستخدم مقابل هوية المتجر

`GET /oauth2/user/info` يعيد:

- بيانات المستخدم الذي فوّض التطبيق: `id`, `name`, `email`, `mobile`, `role`.
- كائن `merchant`: `id`, `username`, `name`, `avatar`, `store_location`, `plan`, `status`, `domain`, `tax_number`, `commercial_number`, `created_at`.

**تحذير موثّق:** المستخدم المفوِّض **ليس دائمًا مالك المتجر**؛ قد يكون من فريق المتجر. لذلك:

- هوية المتجر تُؤخذ من `merchant.id` و`/store/info`، لا من بريد المستخدم.
- صلاحية الربط تُحدد في نظامنا (من بدأ الربط ومن يملك المؤسسة).

---

## 4. Scopes

### 4.1 أمثلة موثّقة (غير حصرية)

من نموذج `app.installed` الرسمي:

```text
settings.read
customers.read_write
orders.read_write
carts.read
branches.read_write
categories.read_write
brands.read_write
products.read_write
webhooks.read_write
payments.read
taxes.read_write
specialoffers.read_write
countries.read
metadata.read_write
offline_access
```

ومن صفحات API: `products.read`, `orders.read`, `dns-records.read`, `store-settings.read`.

**لا نستنتج أن هذه القائمة كاملة.** تُقرأ Scopes الفعلية من بوابة Salla Partners بعد اعتماد التطبيق، وتُسجَّل هنا.

### 4.2 المبدأ

- **أقل صلاحية ممكنة**: قراءة فقط في المراحل 03–13.
- كتابة المنتجات/المحتوى تُطلب فقط عند Phase 15+.
- `offline_access` مطلوب منذ البداية للتجديد.
- لا نطلب Scopes تسويقية قبل تصميم المرحلة 17.

### 4.3 تمييز مهم: Store Scopes ≠ OAuth Scopes

صفحة **List Store Scopes** يعرض محتواها «نطاقات المتجر» (فروع/دول/نطاقات بيع) وليس صلاحيات التطبيق. المسار الدقيق يُسجَّل قبل الاستخدام، ولا يُخلط بين المفهومين.

---

## 5. Webhooks

### 5.1 المغلف

```json
{
  "event": "brand.created",
  "merchant": 596493488,
  "created_at": "Sun Mar 24 2024 16:09:48 GMT+0300",
  "data": { "id": 190175156, "name": "Brand Name" }
}
```

المصدر: [App Functions — Webhook Payload](https://docs.salla.dev/1726814m0).

- لا يوجد في الوثائق المقروءة معرّف حدث فريد مضمون. لذلك الاعتماد على **hash للمحتوى + dedupe key**.
- `created_at` قد يأتي بصيغ مختلفة؛ لا يُستخدم كمفتاح.

### 5.2 الأمان

| البند | المعلومة | الحالة |
|---|---|---|
| استراتيجية افتراضية | `Signature` | ✅ |
| رأس الاستراتيجية | `X-Salla-Security-Strategy` | ✅ |
| رأس التوقيع | `X-Salla-Signature` | ✅ |
| التوقيع | SHA-256 للجسم باستخدام السر، 64 حرفًا hex | ✅ موثّق وصفيًا |
| المقارنة | timing-safe | ✅ موصى بها |
| السر | يُقدَّم عند تسجيل Webhook | ✅ |
| دورة حياة السر/دورانه | غير موثّقة في الصفحات المقروءة | ⚠️ تحقق Phase 06 |

**⚠️ التفاصيل الدقيقة (HMAC-SHA256 أم SHA256 بسيط مع السر، وترميز hex) تُؤكد في Phase 06** باختبار توقيع حقيقي على Demo Store قبل الإنتاج. لا يُعتمد التخمين.

### 5.3 الوقت وإعادة المحاولة

- Salla تنتظر استجابة نحو **30 ثانية**.
- عند عدم النجاح: **3 محاولات** بفواصل ~5 دقائق.
- المصدر: [Webhooks — Timeout](https://docs.salla.dev/webhooks).

**المتطلبات:** حفظ سريع + رد 2xx + معالجة غير متزامنة + idempotency + DLQ.

### 5.4 التسجيل

```json
{
  "name": "Salla Update Customer Event",
  "event": "customer.updated",
  "url": "https://example.com/api/webhooks/salla",
  "version": 2,
  "rule": "payment_method = mada OR price < 50",
  "headers": [{ "key": "Authorization", "value": "…" }]
}
```

- الإصدار الافتراضي = 2.
- يدعم `rule` لتصفية الأحداث (Conditional Webhooks).
- المصدر: [Register Webhook](https://docs.salla.dev/webhooks/subscribe)، [Conditional Webhooks](https://docs.salla.dev/421120m0).

### 5.5 الأحداث الموثّقة

| المجموعة | الأحداث |
|---|---|
| Order | `order.created`, `order.updated`, `order.status.updated`, `order.cancelled`, `order.refunded`, `order.deleted`, `order.products.updated`, `order.payment.updated`, `order.coupon.updated`, `order.total.price.updated`, `order.shipment.*`, `order.shipping.address.updated` |
| Product | `product.created`, `product.deleted`, `product.quantity.low`, `product.price.updated`, `product.status.updated`, `product.image.updated`, `product.category.updated`, `product.brand.updated`, `product.tags.updated` |
| Customer | `customer.created`, `customer.updated`, `customer.login`, `customer.otp.request` |
| Category/Brand | `category.created`, `category.updated`, `brand.created`, `brand.updated`, `brand.deleted` |
| Store | `store.branch.created/updated/setDefault/activated/deleted`, `storetax.created` |
| Cart | `abandoned.cart`, `coupon.applied` |
| Invoice | `invoice.created` |
| Offer | `specialoffer.created`, `specialoffer.updated` |
| Review | `review.added` |
| Shipping | `shipping.zone.*`, `shipping.company.*`, `shipment.*` |

### 5.6 تعارض موثّق: `product.updated`

- جدول [Webhooks](https://docs.salla.dev/webhooks) يعرض `product.updated` **مشطوبًا**.
- [Conditional Webhooks](https://docs.salla.dev/421120m0) و[List Events](https://docs.salla.dev/5394136e0) يذكرانه كمدعوم.
- **القرار:** لا يُعتمد كأساس للمزامنة. تُستخدم `product.created` + `product.price.updated` + `product.status.updated` + reconciliation، ويُعاد التحقق قبل Phase 06.
- **لا يُبنى أي منطق حرج على هذا الحدث وحده.**

---

## 6. Rate Limiting

| الخطة | الحد الأقصى | المهلة | السلوك بعد التجاوز |
|---|---|---|---|
| Plus | 120 طلب/دقيقة | دقيقة | 1 طلب/ثانية حتى إعادة الضبط |
| Pro | 360 طلب/دقيقة | دقيقة | 1 طلب/ثانية |
| Special | 720 طلب/دقيقة | دقيقة | 1 طلب/ثانية |

- الخوارزمية: leaky bucket.
- لكل طلب رؤوس Rate Limit (أسماؤها الدقيقة ⚠️ تُقرأ قبل التنفيذ).
- المصدر: [Rate Limiting](https://docs.salla.dev/rate-limiting).

**المتطلبات:** limiter لكل متجر حسب `plan`، قراءة الرؤوس، backoff عند 429، وعدم تجاوز 1 req/s بعد الحجب.

---

## 7. Pagination

شكل موثّق:

```json
"pagination": {
  "count": 3,
  "total": 231,
  "perPage": 3,
  "currentPage": 76,
  "totalPages": 77,
  "links": {
    "previous": "…?per_page=3&page=75",
    "next": "…?per_page=3&page=77"
  }
}
```

قواعد موثّقة (List Orders):

- `page` تسلسلي؛ تخطي الصفحات قد يعيد نتيجة فارغة.
- `per_page=30` لتقليل الطلبات (للطلبات).
- إكمال الترقيم خلال **15 دقيقة** (كاش).
- استخدام `from_date`/`to_date` قدر الإمكان.

المصدر: [List Orders](https://docs.salla.dev/5394146e0)، [Pagination](https://docs.salla.dev/pagination).

---

## 8. الأخطاء

| HTTP | المعنى | التعامل |
|---|---|---|
| 401 | غير مصرح / scope ناقص | إعادة ربط أو طلب Scope صحيح؛ لا retry أعمى |
| 403 | ممنوع/حجب مؤقت | backoff + تنبيه |
| 404 | غير موجود | لا retry؛ تحقق من المعرّف |
| 422 | تحقق فاشل | لا retry؛ سجل الحقل |
| 429 | تجاوز الحد | retry بعد backoff محترم |
| 5xx | خطأ خادم | retry محدود + تنبيه |

شكل الاستجابة الموثّق يحتوي `status`, `success`, `error.code`, `error.message`. المصدر: [Responses](https://docs.salla.dev/421123m0).

---

## 9. Versioning

- Merchant API: **v2** (base URL).
- Webhooks: version `1` أو `2`؛ الافتراضي `2`.
- المصدر: [Versioning](https://docs.salla.dev/versioning)، [Webhooks](https://docs.salla.dev/webhooks).

**السياسة:** أي تغيير في الإصدار يستلزم مراجعة الوثائق واختبارات قبل الترقية. لا نستخدم إصدارًا غير مثبت في السجل.

---

## 10. سجل التحقق

| التاريخ | الصفحة | ما تم التحقق منه |
|---|---|---|
| 2026-10-21 | `/` (Get Started) | Base URL، OAuth2، عمر access token، نافذة refresh |
| 2026-10-21 | `/authorization` | Endpoints، المعاملات، Easy/Custom، 14 يومًا، refresh أحادي |
| 2026-10-21 | `/webhooks` | التوقيع، الرؤوس، 30s، 3 محاولات، كتالوج الأحداث، `product.updated` |
| 2026-10-21 | `/webhooks/subscribe` | شكل التسجيل، version 2 |
| 2026-10-21 | `/webhooks/events` | Endpoint القائمة |
| 2026-10-21 | `/rate-limiting` | الخطط والحدود |
| 2026-10-21 | `/pagination` + List Orders | per_page، التسلسل، 15 دقيقة |
| 2026-10-21 | `/merchants/user-info` | حقول المستخدم/التاجر، تحذير فريق المتجر |
| 2026-10-21 | `/merchants/store-info` | `GET /store/info` والحقول |
| 2026-10-21 | `/421413m0` | نموذج `app.store.authorize` وScopes |

---

## 11. أسئلة مفتوحة

1. الشكل الدقيق لتبادل `/oauth2/token` واستجابته.
2. كيفية إصدار/تدوير سر توقيع Webhooks.
3. اعتماد Custom Mode للنشر في App Store.
4. `product.updated`: مهمل أم خطأ توثيق؟
5. أسماء رؤوس Rate Limit وقيمها.
6. Scopes الفعلية المتاحة للتطبيق بعد الاعتماد.
7. هل يسمح التطبيق بأكثر من متجر Salla لكل مؤسسة/تاجر؟
8. واجهات Marketing APIs وScopes.
9. بيانات traffic/conversion المتاحة.
10. متطلبات فوترة Salla Partners (Phase 24+).

---

## 12. المراجع

- <https://docs.salla.dev/>
- <https://docs.salla.dev/authorization>
- <https://docs.salla.dev/webhooks>
- <https://docs.salla.dev/webhooks/subscribe>
- <https://docs.salla.dev/rate-limiting>
- <https://docs.salla.dev/pagination>
- <https://docs.salla.dev/merchants/user-info>
- <https://docs.salla.dev/merchants/store-info>
- <https://docs.salla.dev/421413m0>
- <https://docs.salla.dev/421123m0>
- <https://docs.salla.dev/421120m0>


---

## 8. سجل أدلة Phase 03 (Claim / Source / URL / Verified At / Implementation Impact)

كل قرار في كود Phase 03 يعود إلى صفّ هنا. «مصدر ثانوي» يعني أنه يدعم الفهم لكنه ليس نصًّا رسميًا في docs.salla.dev.

| # | Claim | Source | URL | Verified At | Implementation Impact |
|---|---|---|---|---|---|
| 1 | عنوان التفويض هو `https://accounts.salla.sa/oauth2/auth` وأنواع المعاملات `client_id`, `response_type=code`, `redirect_uri`, `scope`, `state` | Salla Docs — Authorization | https://docs.salla.dev/doc-421118 | 2026-10-22 | `buildAuthorizationUrl()` يرسل هذه المعاملات فقط، دون أي حقل غير موثّق |
| 2 | عنوان الرمز ونقطة التجديد هما `https://accounts.salla.sa/oauth2/token` | Salla Docs — Authorization | https://docs.salla.dev/doc-421118 | 2026-10-22 | ثابت واحد `SALLA_OFFICIAL_ENDPOINTS.tokenUrl` يُستخدم للتبادل والتجديد |
| 3 | جسم طلب الرمز `application/x-www-form-urlencoded` يحتوي `grant_type`, `code`, `redirect_uri`, `client_id`, `client_secret` | RFC 6749 §4.1.3 + عميل Salla الرسمي (ثانوي) | https://github.com/SallaApp/oauth2-merchant/blob/master/src/Provider/Salla.php | 2026-10-22 | `exchangeAuthorizationCode()` يرسل الجسم كـ URLSearchParams مع `content-type` الصحيح؛ لا بيانات اعتماد في الـ URL |
| 4 | التجديد يستخدم `grant_type=refresh_token` و`refresh_token` مع نفس بيانات العميل | Salla Docs — Authorization (وصف التجديد) + العميل الرسمي | https://docs.salla.dev/doc-421118 | 2026-10-22 | `refreshAccessToken()` يرسل الحقول الأربعة فقط |
| 5 | `offline_access` شرط الحصول على refresh token | Salla Docs — Authorization (Important Notes) | https://docs.salla.dev/doc-421118 | 2026-10-22 | `SALLA_REQUIRED_SCOPES = ["offline_access"]` في Phase 03؛ أُضيف سكوبا القراءة في Phase 04 (§10.4) |
| 6 | صلاحية access token 14 يومًا | Salla Docs — Authorization + Get Started | https://docs.salla.dev/doc-421118 | 2026-10-22 | `ACCESS_TOKEN_FALLBACK_MS = 14d`، وتجديد استباقي قبل دقيقة |
| 7 | صلاحية refresh token شهر واحد | Salla Docs — Get Started | https://docs.salla.dev/ | 2026-10-22 | `REFRESH_TOKEN_TTL_MS = 30d` يُخزَّن في `refresh_token_expires_at` |
| 8 | `expires` يُعاد كثواني (Unix seconds) | Salla Docs — Authorization (Important Notes) | https://docs.salla.dev/doc-421118 | 2026-10-22 | `computeAccessTokenExpiry()` يقبل `expires` و`expires_in` ويتحمّل المللي ثانية |
| 9 | refresh token أحادي الاستخدام ويُستبدل في كل تجديد | Salla Docs — Authorization | https://docs.salla.dev/doc-421118 | 2026-10-22 | `saveRefreshedTokens()` يخزّن الزوج الجديد ويرفع `token_version`، ولا يُعاد استخدام القديم |
| 10 | إعادة استخدام refresh token تُبطل الـ refresh وكل access tokens المشتقة منه وتُلزم التاجر بإعادة التثبيت | Salla Docs — Authorization | https://docs.salla.dev/doc-421118 | 2026-10-22 | قفل تجديد على مستوى الصف (`refresh_lock_id` + `refresh_lock_expires_at` + `token_version`) يمنع أي تجديد متوازٍ |
| 11 | خطأ التجديد الدائم يُعاد بصيغة `{"error":"invalid_grant","error_description":"…"}` مع HTTP 401 | Salla Docs — Responses | https://docs.salla.dev/responses | 2026-10-22 | `refreshAccessToken()` يرمي `sallaInvalidGrant()`؛ `token-manager` ينقل الحالة إلى `reauth_required` ويمسح الرموز |
| 12 | **Easy Mode** هو الوحيد المسموح للتطبيقات المنشورة، والرموز تُسلَّم عبر Webhook `app.store.authorize` بلا Redirect/callback | Salla Docs — Authorization | https://docs.salla.dev/doc-421118 | 2026-10-22 | ADR-034: Easy Mode للمسار العام، لكن تنفيذه يتطلب Webhook (§9 تعارض 1)؛ الواجهة تُعلن `implemented: false` عند اختياره |
| 13 | **Custom Mode** يتطلب redirect URI مسجّلًا ويعيد `?code=…&scope=…&state=…`، وهو موصوف «لأغراض الاختبار» | Salla Docs — Authorization | https://docs.salla.dev/doc-421118 | 2026-10-22 | Phase 03 ينفّذ Custom Mode فقط، ويُوثّق أن ترقية Easy Mode لا تعيد بناء نموذج الاتصال |
| 14 | حدث `app.store.authorize` يحمل `access_token`, `expires`, `refresh_token`, `scope`, `token_type` و`merchant` | Salla Docs — App Events | https://docs.salla.dev/421413m0 | 2026-10-22 | مخطط التخزين يستوعب هذه الحقول مباشرة عند بناء مسار Easy Mode (خارج نطاق هذه المرحلة) |
| 15 | `GET /oauth2/user/info` يعيد `data.merchant.id` وبيانات المتجر؛ المستخدم المفوِّض قد يكون عضو فريق لا المالك | Salla Docs — User Information | https://docs.salla.dev/merchants/user-info | 2026-10-22 | هوية المتجر الخارجية = `merchant.id` حصرًا؛ `external_user_id` = `data.id` ولا يُستخدم كهوية متجر |
| 16 | `GET /store/info` يعيد `data.id` لبيانات المتجر | Salla Docs — Store Information | https://docs.salla.dev/merchants/store-info | 2026-10-22 | لم يُستدعَ في Phase 03 (يكفي `user/info` للهوية)؛ يُسجَّل قبل أي استخدام لاحق |
| 17 | حدود المعدل تعتمد على خطة المتجر (Plus 120 / Pro 360 / Special 720 في الدقيقة) | Salla Docs — Rate Limiting | https://docs.salla.dev/rate-limiting | 2026-10-22 | `SallaRateLimitError` موجود في التصنيف، ولا ندّعي تنفيذ limiter متكامل قبل Phase 04 |
| 18 | يُنصح باستخدام متجر تجريبي (Demo Store) للاختبار | Salla Docs — Authorization / Report Builder | https://docs.salla.dev/doc-421118 | 2026-10-22 | كل الاختبارات الآلية على mock محلي؛ لا يوجد اتصال بمتجر حقيقي أو بمتجر كشخة |
| 19 | تثبيت التطبيق من `https://s.salla.sa/apps/install/{app-id}` | Salla Docs — Authorization | https://docs.salla.dev/doc-421118 | 2026-10-22 | يُذكر في `docs/phase-03.md` كخطوة تشغيلية للمالك؛ لا استدعاء آلي |

---

## 9. تعارضات الوثائق وقرارات الحفظ (Phase 03)

لا يوجد تخمين: كل تعارض يُسجَّل هنا، ويُنفَّذ الخيار الأكثر تحفّظًا.

### 9.1 فاصل السكوبات (space مقابل comma)

- **التعارض:** مثال الـ callback في الوثائق يعرض `scope={app-scopes}+offline_access` (أي مسافة عند فك الترميز)، بينما عميل Salla الرسمي `oauth2-merchant` يعرّف `getScopeSeparator()` كـ `,`.
- **القرار:** نرسل مسافة (`serializeScopes`)، مطابقةً لـ RFC 6749 §3.3 ومثال الوثائق في عنوان التفويض.
- **الأثر:** نخزّن السكوبات كما تعيدها Salla (`token.scope` أو `app.store.authorize.data.scope`) بعد تطبيع يقبل الفاصلين، فلا تتأثر المقارنة بشكل الإرسال.
- **الأثر المستقبلي:** إذا رفضت Salla التفويض بسبب السكوبات، يُعاد التحقق ويُسجَّل هنا قبل التغيير.

### 9.2 جسم طلب الرمز غير معروض في الوثائق

- **التعارض:** الوثائق تسرد المعاملات ولا تعرض مثال `curl` للجسم.
- **القرار:** `application/x-www-form-urlencoded` في الجسم (RFC 6749 §4.1.3) + بيانات العميل في الجسم، وليس في الـ URL ولا في ترويسة Basic.
- **الدليل الثانوي:** عميل Salla الرسمي يعتمد `league/oauth2-client` الذي يرسل `client_id`/`client_secret` في الجسم مع `grant_type`.
- **الأثر:** لا تُسجَّل بيانات العميل في أي سجل HTTP؛ ولو تغيّرت الوثائق يُعدَّل موضع واحد فقط (`oauth-client.ts`).

### 9.3 `expires` مقابل `expires_in`

- **التعارض:** الوثائق تذكر `expires` كثواني Unix في قسم OAuth، ويستخدم حدث Webhook أيضًا `expires`؛ بينما استجابات OAuth الشائعة تستخدم `expires_in`.
- **القرار:** نقبل الاثنين، ونفضّل `expires_in` عند وجوده، ونعتبر `expires` ثواني Unix مع تحمّل القيم بالمللي ثانية.
- **الأثر:** إذا لم يوجد أي منهما نستخدم 14 يومًا الموثّقة، ويظهر ذلك في `tokens.ts` كـ fallback معلن لا كتخمين صامت.

### 9.4 Easy Mode بلا callback

- **التعارض:** أفضل مسار للنشر (Easy Mode) لا يمر عبر callback أصلًا، بينما Prompt Phase 03 يطلب تدفّق callback و`state`.
- **القرار:** تنفيذ Custom Mode (الموثّق للاختبار) الآن، مع تصميم نموذج الاتصال بحيث يستقبل الرموز من أي مصدر (callback أو Webhook لاحقًا) عبر نفس `saveAuthorizedConnection`، وإعلان `implemented: false` عند `SALLA_OAUTH_MODE=easy` بدل الادعاء الكاذب.
- **الأثر:** ADR-034 يشرح المسار، و`docs/phase-03.md` §القيود يذكر أن الإنتاج يستلزم Webhook `app.store.authorize` في مرحلة لاحقة.

---

## 10. سجل أدلة Phase 04 — المنتجات والتصنيفات

### 10.1 `GET /admin/v2/products`

| الحقل | القيمة |
|---|---|
| **Endpoint** | `GET https://api.salla.dev/admin/v2/products` |
| **Purpose** | قراءة قائمة منتجات المتجر لبناء نسخة محلية للتحليل |
| **HTTP Method** | `GET` |
| **Required Scope** | `products.read` (Products Read Only) |
| **Authentication** | `Authorization: Bearer <access_token>` من `SallaTokenManager` |
| **Pagination** | `page`, `per_page` (الحد الأقصى الموثّق 60)؛ الاستجابة تحمل `pagination.count/total/perPage/currentPage/totalPages/links` |
| **Response Shape** | `{ status, success, data: Product[], pagination }` |
| **Rate Limit Considerations** | خطة المتجر: Plus 120 / Pro 360 / Special 720 طلبًا في الدقيقة، وبعد التجاوز طلب واحد/ثانية؛ ترويسات `X-RateLimit-*` و`Retry-After` |
| **Source** | Salla Docs — List Products |
| **URL** | https://docs.salla.dev/5394168e0 |
| **Verified At** | 2026-10-22 |
| **Implementation Notes** | يُقرأ فقط: `id, name, sku, type, status, description, url, main_image, thumbnail, price, regular_price, sale_price, quantity, is_available, updated_at, categories[].id, brand, urls, metadata`. لا تُقرأ `options`/`skus` (مخزون، Phase 06+). `format=light` غير مستخدم لأن اقتراحه لا يضمن حقل `categories` |

### 10.2 `GET /admin/v2/categories`

| الحقل | القيمة |
|---|---|
| **Endpoint** | `GET https://api.salla.dev/admin/v2/categories` |
| **Purpose** | قراءة شجرة التصنيفات لربط المنتجات بها |
| **HTTP Method** | `GET` |
| **Required Scope** | `categories.read` (Categories Read Only) |
| **Authentication** | `Authorization: Bearer <access_token>` |
| **Pagination** | نفس كتلة `pagination` القياسية (`per_page` بحد أقصى 60) |
| **Response Shape** | `{ status, success, data: Category[], pagination }` |
| **Rate Limit Considerations** | نفس حدود المتجر؛ نُسلسل الصفحات ولا نفتح طلبات متوازية |
| **Source** | Salla Docs — List Categories |
| **URL** | https://docs.salla.dev/api-5394207 |
| **Verified At** | 2026-10-22 |
| **Implementation Notes** | الحقول: `id, name, image, parent_id, sort_order, status, update_at, urls, metadata, show_in`. لا يوجد حقل `slug` في الاستجابة (يُشتق من `urls.customer` فقط عند الحاجة مستقبلًا؛ لم يُخزَّن الآن). `parent_id = 0` يعني جذرًا |

### 10.3 Pagination

- المصدر: https://docs.salla.dev/pagination — «All paginated responses will append ... `pagination`» و«maximum value for the `per_page` query parameter is 60».
- نستخدم `per_page=30`: أقل من الحد الأقصى، ويُبقي معاملة كل صفحة صغيرة.
- نعتمد `currentPage`/`totalPages` من الاستجابة، لا من عدّاد محلي، ونرفض أي استجابة `currentPage` فيها لا يساوي الصفحة المطلوبة.
- حماية من الحلقات: بصمة لكل صفحة (معرّفات خارجية مرتبة)، سقف 200 صفحة، ورفض صفحة فارغة قبل الأخيرة.

### 10.4 Scopes

| Scope | الاستخدام | الحالة |
|---|---|---|
| `offline_access` | refresh token | مطلوب منذ Phase 03 |
| `products.read` | `GET /products` | مطلوب منذ Phase 04 |
| `categories.read` | `GET /categories` | مطلوب منذ Phase 04 |

لا سكوبات كتابة ولا سكوبات مراحل لاحقة. الاتصال القديم (Phase 03) لا يملك سكوبي القراءة، لذلك تتطلب المزامنة إعادة ربط واضحة (`missing_scope`).

### 10.5 Rate limits

- المصدر: https://docs.salla.dev/rate-limiting (Verified At 2026-10-22).
- الحدود حسب الخطة فقط؛ لا رقم مضمّن في الكود.
- عند `429`: يُقرأ `Retry-After` إن وُجد ويُنتظر بالقيمة نفسها، ثم يُعاد الطلب ضمن سقف المحاولات. لا إعادة محاولة فورية. إن طلب المزوّد انتظارًا أطول من 30 ثانية يتوقف التشغيل (`rate_limited`) بدل إعادة المحاولة مبكرًا.
- `1 request/second` بعد تجاوز الحد هو سلوك الخادم، وليس سياسة نطبقها محليًا.

### 10.6 Error behaviour

| الحالة | تفسير Salla | تعاملنا |
|---|---|---|
| 401 | رمز غير صالح، تطبيق غير مثبّت، أو سكوب غير ممنوح | تجديد واحد ثم إعادة الطلب مرة؛ إن تكرر → `reauth_required` |
| 403 | ممنوع (حجب مؤقت أو وصول غير مسموح) | فشل دائم، بلا إعادة محاولة |
| 404 | المسار/العنصر غير موجود | فشل دائم |
| 422 | أخطاء تحقق | لا يحدث في القراءة؛ فشل دائم |
| 429 | تجاوز الحد | إعادة محاولة بعد `Retry-After` |
| 5xx | خطأ خادم مؤقت | إعادة محاولة ضمن السقف |
| جسم غير مطابق للمخطط | تغيّر عقد | `SallaInvalidResponseError`، تُفشل التشغيل ولا تُخزَّن بيانات تالفة |

المصدر: https://docs.salla.dev/responses — ويذكر صراحةً أن 401 يُستخدم أيضًا عند «Not allowed Scopes».

### 10.7 Deletion behaviour

- لا توثّق Salla نقطة نهاية أو حقلًا موثوقًا لسرد المحذوف عبر `GET /products` أو `GET /categories`، ولا تعِد `deleted` كحالة موثّقة شاملة.
- القرار: **لا حذف تلقائي إطلاقًا** في Phase 04. يُسجَّل `last_seen_at` عند كل ظهور ناجح، ويبقى الصف إن اختفى من القائمة.
- المرشح للمرحلة اللاحقة: مقارنة `last_seen_at` بمعرّفات، بعد التحقق من أي Webhook/Audit رسمي، وقرار ADR مستقل.

### 10.8 Field notes

- `product.status` يعيد أمثلة `sale`/`hidden`/`out`/`sold`؛ لا تُنشر قائمة enum مغلقة، لذلك يُخزَّن كنص كما هو ولا يُترجم إلى «محذوف».
- `category.status` مثالها `active`/`hidden`.
- `category.update_at` (وليس `updated_at`) هو الاسم الموثّق في استجابة التصنيفات، وقد يصل كائنًا `{date, timezone_type, timezone}` داخل منتج.
- الأسعار كائنات `{amount, currency}`؛ `sale_price` قد يكون `{}` — تُطبَّع إلى `null` لا إلى صفر.
- `quantity` يصل رقمًا أو نصًا (`"50"`)؛ يُطبَّع إلى عدد صحيح أو `null`.

---

## 11. تعارضات وثائق Phase 04

### 11.1 `per_page` مقابل `count`

- **التعارض:** صفحة Pagination تقول «The `count` parameter may be used to increase the number of results per request»، بينما المثال نفسه وأمثلة المسارات تستخدم `per_page`.
- **القرار:** نرسل `per_page` فقط (مذكور صراحةً في الصفحة نفسها وفي curl الخاص بالمنتجات)، ولا نرسل `count` غير الموثّق لكل مسار.
- **الأثر:** إن غيّرت Salla الاسم، يُعدَّل `catalog-client.ts` وحده.

### 11.2 المنطقة الزمنية للطوابع

- **التعارض:** `updated_at`/`update_at` تُعرض كنص `YYYY-MM-DD HH:mm:ss` بلا منطقة زمنية، وأحيانًا ككائن يحمل `Asia/Riyadh`.
- **القرار:** تُحلَّل النصوص كـ UTC بشكل حتمي، وتُستخدم فقط لتتبّع التغيّر؛ لا تُعرض كتوقيت دقيق للمستخدم. الواجهة تعرض `updated_at` المحلي (وقت المزامنة) بدلًا منها.
- **الأثر:** لا اعتماد على دقة الطابع الخارجي في أي قرار.

### 11.3 حالة المنتج غير مغلقة

- **التعارض:** لا قائمة enum موثّقة لحالات المنتج.
- **القرار:** `status` نصّي كما هو، مع خريطة عرض عربية لأشهر القيم فقط، وأي قيمة أخرى تُعرض كما وردت.
- **الأثر:** لا ترجمة صامتة ولا استنتاج حذف.

### 11.4 عدم وجود `slug` للتصنيف

- **التعارض:** متجر Salla يعرض مسارًا يحتوي ما يشبه الـ slug، لكن استجابة API لا تحمل حقل `slug`.
- **القرار:** لا نولّد slug ولا نستخرجه بالتخمين؛ الواجهة تعرض الاسم فقط.
- **الأثر:** إن احتاجته مرحلة لاحقة، يُشتق من `urls.customer` بقرار موثّق.

### 11.5 `categories` داخل المنتج

- **التعارض:** الوثائق تعرض مصفوفة `categories` داخل المنتج، لكنها قد تكون فارغة، ولا تضمن أن التصنيف مُزامَن بعد.
- **القرار:** تُقرأ المعرّفات فقط، وتُربط بما هو موجود محليًا؛ الارتباط بمعرّف غير معروف يُتجاهل ويُحصى (`items_skipped`) بدل إنشاء تصنيف وهمي.
- **الأثر:** ترتيب Categories → Products إلزامي، وأي تصنيف مفقود يظهر في عدّاد لا في بيانات مخترعة.

---

## 12. سجل أدلة Phase 05 — الطلبات والعملاء والمخزون

> **تاريخ التحقق:** 2026-10-22. كل صف أدناه قرأته من الصفحة الرسمية المذكورة في نفس الصف.  
> ما لم يُقرأ في الوثائق **لم يُنفَّذ**؛ ويُسجَّل في §13 كقيد أو تعارض.

### 12.1 `GET /admin/v2/orders`

| الحقل | القيمة |
|---|---|
| **Endpoint** | `GET https://api.salla.dev/admin/v2/orders` |
| **Purpose** | قراءة قائمة طلبات المتجر لبناء نسخة محلية للقراءة فقط |
| **HTTP Method** | `GET` |
| **Required Scope** | `orders.read` (Orders Read Only) |
| **Authentication** | `Authorization: Bearer <access_token>` من `SallaTokenManager` — لا عميل جديد ولا تخزين رمز جديد |
| **Pagination** | `page` + `per_page`؛ **قراءة متسلسلة فقط**: الصفحة التالية بعد السابقة، وطلب صفحة خارج التسلسل يعيد استجابة **فارغة**. يجب إكمال كل الصفحات داخل نافذة **15 دقيقة** المخزّنة مؤقتًا |
| **Response Shape** | `{ status: 200, success: true, data: Order[], pagination: { count, total, perPage, currentPage, totalPages, links: { next } } }` |
| **Rate Limit Considerations** | خطة المتجر (Plus 120 / Pro 360 / Special 720 في الدقيقة)؛ `X-RateLimit-Limit/Remaining/Reset` و`Retry-After`؛ لا طلبات متوازية |
| **Source** | Salla Docs — List Orders |
| **URL** | https://docs.salla.dev/5394146e0 |
| **Verified At** | 2026-10-22 |
| **Implementation Notes** | نرسل `page`, `per_page=30` فقط، و`from_date`/`to_date` عند تضييق النطاق. **لا نرسل `expanded=true`** (غير مدعوم للتطبيقات المنشأة بعد 2024-08-15، ومزال من 2026-09-01). الحقول المقروءة: `id, external_reference_id, reference_id, total{amount,currency}, date{date,timezone}, source, status{id,name,slug}, draft, payment_method, is_pending_payment, items[name,quantity,thumbnail], customer{...}`. `customer.groups` مهجور (2026-02-18) ولا يُقرأ |

**معاملات الاستعلام الموثّقة (لم نستخدمها كلها):** `keyword, payment_method, status, from_date, to_date, country, city, product, branch, tags, expanded, page, reference_id, coupon, customer_id, shipping_app_id, source, sort_by, accounting_services, unread, assign_employee, selling_channel, created_by`.
نستخدم فقط: `page`, `per_page`, واختياريًا `from_date`/`to_date`. الباقي غير مستخدم لأنه لا توجد حاجة منتج له بعد (ولا يُرسل معامل غير موثّق).

### 12.2 شكل سطر الطلب في `List Orders` (قيد موثّق)

| الحقل | القيمة |
|---|---|
| **Claim** | سطر الطلب في استجابة القائمة يحمل `name`, `quantity`, `thumbnail` فقط — **بلا** معرّف منتج أو SKU أو سعر سطر أو سعر وحدة |
| **Source** | Salla Docs — List Orders (مخطط `items`) |
| **URL** | https://docs.salla.dev/5394146e0 |
| **Verified At** | 2026-10-22 |
| **Implementation Impact** | `order_items.external_product_id/sku_id/sku/unit_price/total_price` تبقى `NULL`، وتُسجَّل `link_status = 'no_product_reference'`. لا مطابقة بالاسم، ولا إنشاء منتجات وهمية. تفاصيل القرار: ADR-043 |

### 12.3 `GET /admin/v2/customers`

| الحقل | القيمة |
|---|---|
| **Endpoint** | `GET https://api.salla.dev/admin/v2/customers` |
| **Purpose** | قراءة قائمة العملاء لبناء نسخة محلية للقراءة فقط |
| **HTTP Method** | `GET` |
| **Required Scope** | `customers.read` (Customers Read Only) |
| **Authentication** | `Authorization: Bearer <access_token>` |
| **Pagination** | `page` + `per_page`؛ الاستجابة تحمل `pagination` (`perPage` الافتراضي **15** و`per_page` قابل للتغيير حسب صفحة Pagination العامة) |
| **Response Shape** | `{ status, success, data: Customer[], pagination: { count, total, perPage, currentPage, totalPages, links: [] } }` |
| **Rate Limit Considerations** | **حد خاص موثّق: 500 طلب لكل 10 دقائق** للمتجر، إضافة إلى حد الخطة |
| **Source** | Salla Docs — List Customers |
| **URL** | https://docs.salla.dev/5394121e0 |
| **Verified At** | 2026-10-22 |
| **Implementation Notes** | الحقول المقروءة: `id, first_name, last_name, mobile{number,mobile_code}, mobile_code, email, gender, birthday{date}, city, country, country_code, currency, lang, type, created_at, updated_at`. القائمة **لا تعيد** `created_at` ولا `full_name`؛ يُملأ `created_at` فقط إن جاء من كائن العميل داخل الطلب. لا تُحفظ `urls`/`avatar`/`location`/`groups` |

### 12.4 `GET /admin/v2/customers/{id}`

| الحقل | القيمة |
|---|---|
| **Endpoint** | `GET https://api.salla.dev/admin/v2/customers/{id}` |
| **Purpose** | قراءة عميل واحد — **غير مستخدم في Phase 05** (القائمة تكفي، والنداء لكل عميل يضاعف استهلاك الحد) |
| **HTTP Method** | `GET` |
| **Required Scope** | `customers.read` |
| **Authentication** | `Authorization: Bearer <access_token>` |
| **Pagination** | لا ينطبق (عنصر واحد) |
| **Response Shape** | `{ status, success, data: Customer }` |
| **Rate Limit Considerations** | نفس حد العملاء 500/10 دقائق |
| **Source** | Salla Docs — Customer Details |
| **URL** | https://docs.salla.dev/5394122e0 |
| **Verified At** | 2026-10-22 |
| **Implementation Notes** | موثّق أنه يعيد `country_code` (مثال `"sa"`) و`location` و`groups`، ولا يعيد `created_at` أيضًا. لم يُستخدم لأن `N` نداءات لا تُبرَّر بلا حقل إضافي نحتاجه |

### 12.5 `GET /admin/v2/products/quantities`

| الحقل | القيمة |
|---|---|
| **Endpoint** | `GET https://api.salla.dev/admin/v2/products/quantities` |
| **Purpose** | قراءة الحالة الحالية لكميات المنتجات/المتغيّرات |
| **HTTP Method** | `GET` |
| **Required Scope** | `products.read` (Products Read Only) — لا سكوب مخزون منفصل |
| **Authentication** | `Authorization: Bearer <access_token>` |
| **Pagination** | **نقطة مُصفَّحة**: تحمل كتلة `pagination` (`perPage` افتراضي 15، `total`, `totalPages`)، وتقبل `page` و`per_page` كبقية نقاط القوائم |
| **Response Shape** | `{ status: 200, success: true, data: Quantity[], pagination: {...} }` |
| **Rate Limit Considerations** | حد الخطة؛ `Retry-After` عند 429 |
| **Source** | Salla Docs — List Product Quantities |
| **URL** | https://docs.salla.dev/9612796e0 |
| **Verified At** | 2026-10-22 |
| **Implementation Notes** | الحقول: `id, name, image, sku_id, sku, quantity, sold_quantity, price, unlimited_quantity, variant`. `price` يصل **رقمًا أو نصًا** (`127` و`"127.00"` في نفس المثال). `sku_id = null` لمنتج بلا متغيّرات، ويتكرر نفس `id` مرة لكل متغيّر. معاملات موثّقة إضافية غير مستخدمة: `keyword, categories[], brands[], tags[], branch` |

### 12.6 الفرق بين نظامي الترقيم

| المورد | القاعدة الموثّقة | تنفيذنا |
|---|---|---|
| Orders | تسلسلي فقط؛ خارج التسلسل ⇒ استجابة فارغة؛ إكمال كل الصفحات خلال 15 دقيقة | صفحة 1 ثم 2 ثم 3… دون قفز؛ مهلة النافذة تُوقف التشغيل (`sequential_window_exceeded`) |
| Customers | `page`/`per_page` عادي، `perPage` افتراضي 15 | صفحة 1..N حسب `currentPage`/`totalPages`؛ `per_page=30` |
| Quantities | `page`/`per_page` عادي، `perPage` افتراضي 15 | نفس المسار؛ `per_page=30` |

المصدر العام: https://docs.salla.dev/pagination («maximum value for the `per_page` query parameter is `60`»). لا نفترض قاعدة Orders لأي مورد آخر.

### 12.7 Scopes المطلوبة بعد Phase 05

| Scope | يستخدمه | الحالة |
|---|---|---|
| `offline_access` | refresh token | مطلوب منذ Phase 03 |
| `products.read` | `GET /products` و`GET /products/quantities` | مطلوب منذ Phase 04 |
| `categories.read` | `GET /categories` | مطلوب منذ Phase 04 |
| `orders.read` | `GET /orders` | **جديد في Phase 05** |
| `customers.read` | `GET /customers` | **جديد في Phase 05** |

لا سكوب كتابة واحد. أي اتصال قديم لا يحمل السكوبين الجديدين يعطي `missing_scope` ويحتاج إعادة ربط واحدة (ADR-042).

### 12.8 سجل أدلة Phase 05 (Claim / Source / URL / Verified At / Impact)

| # | Claim | Source | URL | Verified At | Implementation Impact |
|---|---|---|---|---|---|
| 1 | `GET /admin/v2/orders` يتطلب `orders.read` | Salla Docs — List Orders | https://docs.salla.dev/5394146e0 | 2026-10-22 | `SALLA_ORDER_SCOPES = ["orders.read"]`؛ يُفحص قبل التشغيل ويُعيد `missing_scope` |
| 2 | قراءة الطلبات **متسلسلة فقط**، وطلب صفحة خارج التسلسل يعيد استجابة فارغة | List Orders (ملاحظة Pagination) | https://docs.salla.dev/5394146e0 | 2026-10-22 | المشغّل لا يقفز صفحات أبدًا؛ صفحة فارغة قبل الأخيرة تُفشل التشغيل (`pagination.empty`) بدل تخطّي بيانات |
| 3 | يجب إكمال ترقيم الطلبات خلال **15 دقيقة** | List Orders | https://docs.salla.dev/5394146e0 | 2026-10-22 | `SEQUENTIAL_WINDOW_MS = 15 * 60 * 1000` حول مورد الطلبات فقط |
| 4 | `expanded=true` غير مدعوم للتطبيقات المنشأة بعد 2024-08-15 ومزال من 2026-09-01 | List Orders + Order Details | https://docs.salla.dev/5394146e0 | 2026-10-22 | العميل لا يرسل `expanded` إطلاقًا؛ اختبار تكاملي يؤكد غيابه من كل طلب |
| 5 | `per_page` الأقصى الموثّق 60 | Salla Docs — Pagination | https://docs.salla.dev/pagination | 2026-10-22 | نستخدم 30 لكل الموارد الخمسة |
| 6 | سطر الطلب في القائمة = `name, quantity, thumbnail` فقط | List Orders | https://docs.salla.dev/5394146e0 | 2026-10-22 | أعمدة السعر/SKU/المنتج تبقى `NULL` مع `link_status = no_product_reference` (ADR-043) |
| 7 | استجابة Order Details الافتراضية `format=light` تُسقط Items، والاستجابة الموسّعة القديمة غير مدعومة منذ 2026-09-01 | Order Details | https://docs.salla.dev/orders/details | 2026-10-22 | لا نستخدم Order Details لجلب البنود؛ ولا نضيف نداءً لكل طلب بلا فائدة موثّقة |
| 8 | `GET /admin/v2/customers` يتطلب `customers.read` | List Customers | https://docs.salla.dev/5394121e0 | 2026-10-22 | `SALLA_CUSTOMER_SCOPES = ["customers.read"]` |
| 9 | حد نقاط العملاء **500 طلب / 10 دقائق** | Rate Limiting | https://docs.salla.dev/rate-limiting | 2026-10-22 | ترقيم متسلسل بلا توازٍ؛ مزامنة العملاء أولًا في المشغّل لتفادي تكرار النداء |
| 10 | القائمة لا تعيد `created_at`/`full_name`/`lang`/`currency`/`country_code`/`type` | List Customers | https://docs.salla.dev/5394121e0 | 2026-10-22 | الأعمدة `nullable`؛ تُملأ من كائن العميل داخل الطلب (enrich) فقط، وتظهر «—» بدل اختراع قيمة |
| 11 | `GET /products/quantities` يتطلب `products.read` ويعيد `pagination` | List Product Quantities | https://docs.salla.dev/9612796e0 | 2026-10-22 | `SALLA_INVENTORY_SCOPES = ["products.read"]`؛ المورد مُصفَّح بالكامل |
| 12 | `sku_id` يميّز المتغيّرات، ونفس `id` يتكرر لكل متغيّر | List Product Quantities | https://docs.salla.dev/9612796e0 | 2026-10-22 | `quantity_key = "sku:<sku_id>"` أو `"product:<id>"`؛ اختبار وحدة يؤكد عدم اندماج المتغيّرات |
| 13 | `price` يصل رقمًا أو نصًا | List Product Quantities | https://docs.salla.dev/9612796e0 | 2026-10-22 | يُطبَّع إلى `numeric(14,2)` نصًا بدقة منزلتين |
| 14 | `X-RateLimit-*` و`Retry-After` موثّقة | Rate Limiting | https://docs.salla.dev/rate-limiting | 2026-10-22 | نفس آلية Phase 04؛ `Retry-After` يُحترم حرفيًا ولا تُقصَّر المدة |
| 15 | `mobile_code` يأتي `"+966"` في الطلبات و`"967"` في العملاء، و`country_code` بين `"SA"` و`"sa"` | List Orders + List Customers | https://docs.salla.dev/5394146e0 | 2026-10-22 | يُحفظ `mobile_code` كما وصل ويُجمَّع للعرض فقط؛ `country_code` يُخزَّن بأحرف كبيرة لأن المزوّد يخلط الحالتين |
| 16 | تفاصيل الطلب الكاملة تحمل حقولًا حسّاسة: `bank.iban_number`, `notes`, `payment_actions`, `source_details` إضافة إلى `customer` و`urls` | Order Details | https://docs.salla.dev/orders/details | 2026-10-22 | حمولة الطلب المحفوظة قائمة سماح تستبعدها كلها؛ لا تُختار ولا تُعرض ولا تُسجَّل (ADR-043) |

---

## 13. قيود وتعارضات Phase 05

### 13.1 بنود الطلب لا يمكن ربطها بمنتج (قيد، لا خطأ)

- **الواقع الموثّق:** `List Orders` يعيد `name`/`quantity`/`thumbnail` لكل سطر. `Order Details` صار `format=light` افتراضيًا ويُسقط `Items`، والاستجابة الموسّعة القديمة أُزيلت (2026-09-01).
- **القرار:** تُحفظ البنود بما هو موثّق فقط، وبأعمدة `NULL` لما لا وجود له، مع `link_status = 'no_product_reference'`. لا مطابقة بالاسم، ولا إنشاء منتج وهمي، ولا نداء تفاصيل لكل طلب.
- **الأثر:** التقارير المستقبلية التي تحتاج «منتجًا» في سطر الطلب يجب أن تنتظر مصدرًا موثّقًا (Webhook أو تقرير/تصدير رسمي) — ولا يُخترع الآن.
- **إعادة التحقق:** عند أي تغيير في صفحة List Orders أو Order Details، يُعاد فحص هذا القيد قبل المرحلة 06.

### 13.2 حقول عميل غير متاحة في القائمة

- `created_at` غير موجود، و`full_name` غير موجود، و`lang`/`currency`/`type`/`country_code`/`birthday` غير موجودة في `List Customers`.
- **القرار:** الأعمدة nullable، وتُملأ فقط من كائن العميل المرافق للطلب (`enrich`)، و`source_created_at` يبقى `NULL` حتى يصبح متاحًا موثّقًا. الواجهة تعرض «—».

### 13.3 اختلاف شكل الهاتف والدولة

- `mobile` كائن في الطلبات وقد يكون نصًا/رقمًا في مسارات أخرى؛ `mobile_code` بصيغتين (`+966` / `967`)؛ `country_code` بحالتين (`SA` / `sa`).
- **القرار:** يُخزَّن النص كما وصل (بلا إعادة كتابة)، ويُطبَّع للعرض فقط (ADR-043).

### 13.4 لا نقطة موثّقة لحذف/إلغاء الطلبات أو العملاء

- لا سرد موثوق للمحذوف في أي من النقاط الثلاث.
- **القرار:** لا حذف تلقائي. `last_seen_at` يُحدَّث، والصف يبقى. (نفس سياسة Phase 04، ADR-038.)

---

## 14. سجل أدلة Phase 06 — الويبهوك وأحداث التطبيق

> **تاريخ التحقق:** 2026-10-22. **المصادر:** `https://docs.salla.dev/webhooks`، `https://docs.salla.dev/doc-421119`، `https://docs.salla.dev/421413m0`، `https://docs.salla.dev/doc-433804`، `https://docs.salla.dev/webhook-events/products`.
> كل ما بُني في هذه المرحلة مأخوذ من هذه الصفحات. ما لم يُذكر فيها **لم يُخترع**: لا معرّف حدث، ولا ترويسة إضافية، ولا نطاق (scope) جديد.

### 14.1 التسجيل والشكل العام

| العنصر | ما تقوله الوثيقة |
|---|---|
| طريقة التسجيل | `POST` على واجهة تسجيل الويبهوك في لوحة التطبيق، أو من إعدادات التطبيق في Salla |
| معاملات التسجيل | `name`, `event`, `version` (1 أو 2), `rule`, `url`, `headers[{key,value}]`, `secret` |
| إصدار الـ API | **"Salla currently uses API Version 2"**، والويبهوك الجديد يُسجَّل بـ `version: 2` افتراضيًا |
| الرابط | HTTPS عام، ويُستقبل الحدث بـ `POST` |
| المحتوى | `application/json` بغلاف موحّد (14.3) |

### 14.2 الأمان والتوقيع

| العنصر | ما تقوله الوثيقة |
|---|---|
| استراتيجيتان | `Signature` (**الافتراضية**) و`Token` |
| ترويسة الاستراتيجية | `X-Salla-Security-Strategy: Signature` |
| ترويسة التوقيع | `X-Salla-Signature` |
| الخوارزمية | **HMAC-SHA256**، الناتج **hex بطول 64 حرفًا**، مفتاحه `secret` الخاص بالويبهوك |
| ما يُوقَّع | جسم الطلب |
| عيّنة Node | `crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex')` ثم مقارنة بـ `===` |
| عيّنة PHP | تقرأ `php://input` (الجسم الخام) |
| عدد الترويسات في التسليم | **ترويسان فقط**: `X-Salla-Security-Strategy` و`X-Salla-Signature`؛ لا ترويسة إصدار |
| المقارنة | الوثيقة تنصّ صراحةً على استخدام **دالة مقارنة زمنية ثابتة** (timing-safe) |

**تعارض موثّق (14.8.1):** العيّنة Node تعيد تسلسل الكائن، وPHP تقرأ الخام. التنفيذ هنا يعتمد **الجسم الخام** ومقارنة زمنية ثابتة — انظر ADR-045.

> **تحقّق مستقل:** القيمة المتوقّعة لـ`HMAC-SHA256` على جسم الاختبار مأخوذة من `openssl dgst -sha256 -hmac` (بذرة اختبار ثابتة في `signature.test.ts`)، وليست محسوبة بالكود نفسه؛ وهذا يثبت أن الخوارزمية **مفتاحية** لا مجرّد `SHA256` غير مفتاحي كما قد يُفهم من نصّ الوثيقة.

### 14.3 غلاف الويبهوك

```json
{
  "event": "order.created",
  "merchant": 1234509876,
  "created_at": "2022-12-31 12:31:25",
  "data": { "id": 1122334455 }
}
```

- `merchant` هو **معرّف المتجر التجاري** (رقم)، وهو الهوية الوحيدة المتاحة لربط الحدث بمتجر.
- **لا يوجد معرّف حدث** (`event id`/`delivery id`) في الغلاف — لذلك لا يمكن الاعتماد عليه في منع التكرار (14.8.2).
- `created_at` بتوقيت بلا منطقة (`YYYY-MM-DD HH:mm:ss`)، مثل بقية طوابع Salla.

### 14.4 كتالوج الأحداث

**أحداث المتجر — الطلبات (17):**
`order.created`, `order.updated`, `order.status.updated`, `order.cancelled`, `order.refunded`, `order.deleted`, `order.products.updated`, `order.payment.updated`, `order.coupon.updated`, `order.total.price.updated`, `order.shipment.creating`, `order.shipment.created`, `order.shipment.cancelled`, `order.shipment.return.creating`, `order.shipment.return.created`, `order.shipment.return.cancelled`, `order.shipping.address.updated`.

**أحداث المتجر — المنتجات (11):**
`product.created`, `product.updated` *(مهجور)*, `product.deleted`, `product.available` *(مهجور)*, `product.quantity.low`, `product.price.updated`, `product.status.updated`, `product.image.updated`, `product.category.updated`, `product.brand.updated`, `product.tags.updated`.

**أحداث المتجر — التصنيفات والعملاء:**
`category.created`, `category.updated`, `customer.created`, `customer.updated`, `customer.login`, `customer.otp.request`.

**أحداث التطبيق:** `app.store.authorize`, `app.installed`, `app.updated`, `app.uninstalled`, `app.trial.started`, `app.trial.expired`, `app.trial.canceled`, `app.subscription.started`, `app.subscription.expired`, `app.subscription.canceled`, `app.subscription.renewed`, `app.feedback.created`, `app.settings.updated`.

**أسر أخرى موثّقة (24 اسمًا) لم تُستهلك في هذه المرحلة:**

| الأسرة | الأسماء (كما في جدول Salla) |
|---|---|
| Shipping Companies (5) | `shipping.zone.created`, `shipping.zone.updated`, `shipping.company.created`, `shipping.company.updated`, `shipping.company.deleted` |
| Shipments (4) | `shipment.creating`, `shipment.created`, `shipment.cancelled`, `shipment.updated` |
| Brand (3) | `brand.created`, `brand.updated`, `brand.deleted` |
| Store (6) | `store.branch.created`, `store.branch.updated`, `store.branch.setDefault`, `store.branch.activated`, `store.branch.deleted`, `storetax.created` |
| Cart (2) | `abandoned.cart`, `coupon.applied` |
| Invoice (1) | `invoice.created` |
| Special Offer (2) | `specialoffer.created`, `specialoffer.updated` |
| Miscellaneous (1) | `review.added` |

> هذه الأسماء **مُتحقَّق منها حرفيًا** من جدول الأحداث، وتُصنَّف `documented_not_consumed`: تُحفظ، ويُردّ عليها `2xx`، ولا يُبنى عليها أي إجراء. أي اسم خارج الجداول كلها يُصنَّف `unknown_event` بالمعالجة نفسها (ADR-049، ADR-052).

**الإجمالي المُسجَّل:** 17 طلب + 11 منتج + 2 تصنيف + 4 عميل + 13 تطبيق = **47 حدثًا**، منها **اثنان مهجوران فقط** (`product.updated`, `product.available`).

### 14.5 سلوك التسليم

| العنصر | ما تقوله الوثيقة |
|---|---|
| المهلة | **~30 ثانية** لكل محاولة |
| عند الفشل | **3 محاولات إعادة** بفاصل **~5 دقائق** |
| عند النجاح | تتوقف الإعادة |
| أثر ذلك علينا | يجب أن يكون الرد 2xx سريعًا، والعمل الثقيل خارج دورة الطلب (ADR-046) |

### 14.6 حمولات أحداث التطبيق (`app.*`)

- `app.store.authorize` → `data`: `access_token`, `expires` (unix), `refresh_token`, `scope` (نص مفصول بمسافات), `token_type` (`bearer`). **لا يوجد `store id`**؛ الهوية الوحيدة هي `merchant`.
- `app.installed` → `{ id, app_name, description, app_type, app_scopes[], installation_date, store_type }`.
- `app.updated` → `{ id, app_name, description, app_type, categories[], app_scopes[], installation_date, update_date, store_type }`.
- `app.uninstalled` → `{ id, app_name, app_description, app_type, categories[], installation_date, uninstallation_date, refunded, store_type }`.

### 14.7 تغييرات موثّقة في حمولات الطلبات

- `data.checkout_url` و`data.rating_link` أُزيلا في **2025-05-25**، والبديل `data.urls.checkout` و`data.urls.rating`.
- `items.codes` و`items.files` مهجوران، والبديل `data.urls.digital_content`.
- أربعة أحداث شحن تشترك في نموذج واحد، والعشرة أحداث طلب الأخرى تشترك في نموذج واحد.
- تبويبات مخطط البيانات (`Data schema`) تُعرض بحالة "No schema defined" لأنها تُرسم بالجافاسكربت — لذلك لا تُستخرج قوائم الحقول منها ولا تُخمَّن.

### 14.8 تعارضات وفجوات Phase 06

#### 14.8.1 تسلسل الجسم في عيّنة Node
- **التعارض:** العيّنة Node توقّع `JSON.stringify(req.body)`، وPHP تقرأ `php://input`.
- **القرار:** يُوقَّع **الجسم الخام** حرفيًا كما وصل، بمقارنة `timingSafeEqual`. أي إعادة تسلسل تُغيّر المفاتيح/المسافات فتُبطل التوقيع. (ADR-045)

#### 14.8.2 لا معرّف حدث موثّق
- **الفجوة:** الغلاف لا يحمل `id` للحدث/التسليم.
- **القرار:** مفتاح منع التكرار = **SHA-256 للجسم الخام**، بفهرس فريد `(provider, payload_hash)`. لا يُستخدم الوقت ولا `created_at` ولا معرّف استلام. (ADR-048)

#### 14.8.3 هوية المتجر في الأحداث
- **الواقع:** `merchant` رقم متجر؛ وبعض أحداث المنتجات/الطلبات تحمل `data.id` للمورد لا للمتجر.
- **القرار:** الربط عبر `merchant → store_connections.external_store_id → store_id → organization_id` فقط. لا يُشتق المستأجر من أي حقل آخر في الحمولة. (ADR-046)

#### 14.8.4 أحداث مهجورة لا تزال تُسلَّم
- `product.updated` و`product.available` موسومان كمهجورين، لكن ويبهوكات سابقة قد تستمر في إرسالهما.
- **القرار:** يُزامَن المنتج كالمعتاد (مزامنة قراءة)، لكنهما يبقيان موسومين `deprecated` في السجل، ويُسجَّل الوسم في نتيجة المعالجة (`lifecycle: "deprecated"` + `deprecationNote`) حتى لا يُعرَضا كحدثين حاليّين. (ADR-052)

#### 14.8.5 استراتيجية `Token`
- الوثيقة تذكر `Token` كاستراتيجية ثانية دون تفصيل ترويساتها أو طريقة مقارنتها.
- **القرار:** تُرفض التسليمات التي تعلن `Token` (`unsupported_strategy`) بدل قبول جسم غير متحقّق منه. (ADR-045)

#### 14.8.6 غياب ترويسة الاستراتيجية
- **الفجوة:** الوثيقة تقول إن Salla **تُسنِد** `Signature` افتراضيًا عند التسجيل بلا استراتيجية، لكنها **لا تنصّ** على سلوك المستقبِل عند غياب الترويسة.
- **القرار (الأكثر تحفّظًا):** الغياب يُفسَّر كالافتراضي `Signature`، **بشرط** نجاح التوقيع؛ الغياب لا يعفي من التحقّق ولا يُحوّل أي تسليم إلى مقبول بلا توقيع. أي قيمة أخرى غير `Signature` تُرفض. (ADR-052)

#### 14.8.7 ترويسة إصدار الويبهوك
- **الفجوة:** الإصدار (`1` أو `2`) معامل **تسجيل**، وليس جزءًا من الغلاف الموثّق ولا من الترويسات الموصوفة.
- **القرار:** لا يُقرأ الإصدار من أي ترويسة؛ العمود `event_version` يبقى `NULL` حتى توثّق Salla مصدرًا له لكل تسليم. قراءة ترويسة غير موثّقة كانت ستُخزّن قيمة مُختلقة. (ADR-052)

### 14.9 سجل أدلة Phase 06 (Claim / Source / URL / Verified At / Impact)

| # | الادّعاء | المصدر | الرابط | تاريخ التحقق | الأثر في التنفيذ |
|---|---|---|---|---|---|
| 17 | التوقيع HMAC-SHA256 hex بطول 64 على جسم الطلب بمفتاح `secret` الويبهوك، مع ترويستَي `X-Salla-Security-Strategy` و`X-Salla-Signature` | Webhooks — Security | https://docs.salla.dev/webhooks | 2026-10-22 | `verifySallaWebhookSignature` على الجسم الخام + `timingSafeEqual` (ADR-045) |
| 18 | الاستراتيجية الافتراضية `Signature`، و`Token` بديل غير مفصّل | Webhooks — Security | https://docs.salla.dev/webhooks | 2026-10-22 | غياب ترويسة الاستراتيجية مقبول إذا صحّ التوقيع؛ `Token` يُرفض |
| 19 | معاملات التسجيل: `name,event,version(1|2),rule,url,headers,secret` | Webhooks — Register | https://docs.salla.dev/webhooks | 2026-10-22 | لا حقول تسجيل في الكود؛ الوثيقة هي المرجع عند التسجيل اليدوي |
| 20 | "Salla currently uses API Version 2" والإصدار معامل تسجيل | Webhooks — Register | https://docs.salla.dev/webhooks | 2026-10-22 | لا تُقرأ ترويسة إصدار غير موثّقة؛ `event_version` يبقى `NULL` (14.8.7) |
| 21 | غلاف `{event, merchant, created_at, data}` بلا معرّف حدث | Webhooks — Payload | https://docs.salla.dev/webhooks | 2026-10-22 | مخطط Zod للغلاف + بصمة جسم كمعرّف (ADR-048) |
| 22 | مهلة ~30 ثانية و3 محاولات بفاصل ~5 دقائق | Webhooks — Retries | https://docs.salla.dev/webhooks | 2026-10-22 | الرد 2xx قبل المعالجة؛ عمل ثقيل في عامل منفصل |
| 23 | كتالوج أحداث الطلبات (17) والمنتجات (11) والتصنيفات والعملاء | Store Events | https://docs.salla.dev/doc-421119 | 2026-10-22 | `classifyEvent` يطابق الأسماء حرفيًا |
| 24 | `product.updated` و`product.available` مهجوران | Store Events | https://docs.salla.dev/doc-421119 | 2026-10-22 | يُقبلان كي لا تنكسر ويبهوكات قديمة |
| 25 | `app.store.authorize` يحمل `access_token/refresh_token/expires/scope/token_type` وبلا `store id` | App Events | https://docs.salla.dev/421413m0 | 2026-10-22 | الحدث **يُسجَّل** ولا يُطبَّق؛ الرموز لا تُحفظ منه (ADR-050) |
| 26 | حمولات `app.installed/updated/uninstalled` موثّقة بالحقول | App Events | https://docs.salla.dev/421413m0 | 2026-10-22 | تُستخرج منها الهوية فقط؛ الباقي يُهمل |
| 27 | `checkout_url`/`rating_link` أُزيلا 2025-05-25 لصالح `data.urls.*` | Order Events models | https://docs.salla.dev/doc-433804 | 2026-10-22 | لا يُقرأ أي رابط من الحمولة؛ المزامنة تقرأ من الـ API |
| 28 | نماذج بيانات المنتجات تُعرض "No schema defined" | Product Webhook Events | https://docs.salla.dev/webhook-events/products | 2026-10-22 | لا تُستخرج حقول من الحمولة؛ المنتج يُقرأ من `GET /admin/v2/products` |
| 29 | التسليم يحمل ترويستَي الأمان فقط، والمقارنة يجب أن تكون **timing-safe** | Webhooks — Verify Using Signature | https://docs.salla.dev/421119m0 | 2026-10-22 | `safeEqualHex` عبر `timingSafeEqual`؛ لا مقارنة `===` (ADR-045) |
| 30 | أسماء أحداث الشحن والشحنات والعلامات والفروع والسلات والفواتير والعروض والمراجعات (24 اسمًا) | Store Events | https://docs.salla.dev/doc-421119 | 2026-10-22 | تُصنَّف `documented_not_consumed` لا `unknown` (14.4) |
| 31 | `product.updated` و`product.available` مشطوبان في الجدول الرسمي | Store Events — Product | https://docs.salla.dev/doc-421119 | 2026-10-22 | وسم `deprecated` في السجل + `lifecycle` في نتيجة المعالجة (ADR-052) |
| 32 | Salla تُسنِد `Signature` افتراضيًا عند التسجيل بلا استراتيجية؛ لا نصّ على سلوك المستقبِل عند الغياب | Webhooks — Register / Security | https://docs.salla.dev/doc-421119 | 2026-10-22 | الغياب = الافتراضي بشرط صحّة التوقيع؛ غير ذلك يُرفض (14.8.6) |
| 33 | تبويب `Token` لا يُصيَّر نصًّا في الوثيقة؛ لا ترويسة ولا خوارزمية موثّقة له | Webhooks — Security Strategies | https://docs.salla.dev/421119m0 | 2026-10-22 | `Token` يُرفض بـ`unsupported_strategy` ولا يُخمَّن (14.8.5) |

### 14.10 ترتيب قرار التحقّق (كما هو مُنفَّذ)

الترتيب مقصود: كل خطوة تمنع الخطوة التي بعدها من أن تكون «قبولًا بالخطأ».

| # | الحالة | النتيجة | الحالة HTTP | هل يُحفظ الحدث؟ |
|---|---|---|---|---|
| 1 | `SALLA_WEBHOOK_SECRET` غير مضبوط | `secret_not_configured` | 503 | لا |
| 2 | لا ترويسة `X-Salla-Signature` | `missing_signature` | 401 | لا |
| 3 | ترويسة استراتيجية بقيمة غير `Signature` (مثل `Token`) | `unsupported_strategy` | 401 | لا — ولو كان التوقيع صحيحًا |
| 4 | توقيع ليس 64 حرفًا hex | `malformed_signature` | 401 | لا (بلا مقارنة أصلًا) |
| 5 | توقيع صحيح الشكل لكنه لا يطابق | `invalid_signature` | 401 | لا |
| 6 | استراتيجية غائبة + توقيع صحيح | مقبول كـ`Signature` | 200 | نعم |
| 7 | استراتيجية `Signature` + توقيع صحيح | مقبول | 200 | نعم |

- **لا يوجد مسار «تجاوز»**: لا `NODE_ENV`، ولا `bypass`، ولا قبول عند تعذّر المقارنة.
- **لا يُسجَّل** السرّ ولا التوقيع المستلَم ولا المتوقَّع؛ السجل يحمل السبب فقط (`webhook.rejected` + `reason`).
- التوقيع يُتحقَّق **قبل** `JSON.parse`؛ جسم غير JSON بتوقيع خاطئ يعطي **401** لا 400.

---

## 15. سجل أدلة Phase 07 — ذكاء المتجر

> **تاريخ التحقق:** 2026-10-22. **المصادر:** الصفحات نفسها المعتمدة في §12 و§14 — لا مصدر جديد، ولا نقطة نهاية جديدة.
> هذه المرحلة **لا تنادي Salla إطلاقًا**: كل رقم يُحسب من النسخة المحلية التي بُنيت في المراحل 04–06، بعد التحقق من الحقول أدناه.

| # | Claim | Source | URL | Verified At | Implementation Impact |
|---|---|---|---|---|---|
| 1 | سطر الطلب في `List Orders` يحمل `name, quantity, thumbnail` فقط، بلا معرّف منتج وبلا سعر سطر أو سعر وحدة | Salla Docs — List Orders (مخطط `items`) | https://docs.salla.dev/5394146e0 | 2026-10-22 | إيراد المنتج، وإيراد الفئة، ومساهمة الفئة، ومعدل البيع، وأيام المخزون = `unavailable` بأسباب صريحة. لا مطابقة بالاسم ولا ضرب سعر حالي في كمية تراكمية |
| 2 | `GET /admin/v2/products/quantities` يعيد `sold_quantity` دون أي معامل فترة/تاريخ موثّق، ودون تعريف لنافذته | List Product Quantities | https://docs.salla.dev/9612796e0 | 2026-10-22 | `unitsSold` يُعرض بوسم «تراكمي من Salla»، و`velocity` و`daysOfStock` = `unavailable("no_sales_period")`. لا تنبؤ نفاد |
| 3 | `unlimited_quantity` حقل منطقي في نفس النقطة | List Product Quantities | https://docs.salla.dev/9612796e0 | 2026-10-22 | المنتج غير المحدود لا يُرفع له `out_of_stock`/`low_stock`، ويُستبعد من `totalUnits` |
| 4 | `price` في الكميات يصل رقمًا أو نصًا | List Product Quantities | https://docs.salla.dev/9612796e0 | 2026-10-22 | يُطبَّع إلى `numeric(14,2)` نصًا عند المزامنة؛ التحليل لا يعيد تفسيره |
| 5 | `status.slug` في الطلب حرّ ولا يوجد تعداد مغلق؛ `completed` و`canceled` من الأمثلة الموثّقة | List Order Statuses / List Orders | https://docs.salla.dev/5394150e0 | 2026-10-22 | `completed` و`canceled` بالاسم؛ كل slug آخر يُجمع في `otherStatusOrders` ولا يُخمَّن «مكتمل» |
| 6 | لا توجد حالة طلب باسم `refunded` في الوثائق، مع وجود حدث ويبهوك `order.refunded` | List Order Statuses + Webhook events (Order) | https://docs.salla.dev/5394150e0 | 2026-10-22 | لا خانة «مرتجع» ولا استنتاج لصافي المبيعات؛ الحدث يُحفظ ولا يُترجم إلى حالة محلية |
| 7 | `total{amount,currency}` و`draft` و`date{date,timezone}` حقول موثّقة في الطلب | List Orders | https://docs.salla.dev/5394146e0 | 2026-10-22 | القيمة والمتوسط والنمو تُحسب منها؛ `draft = true` مستبعدة، وتعدد العملات يرفض الجمع |
| 8 | `List Customers` لا يعيد `created_at` (يُملأ فقط من كائن العميل داخل الطلب) | List Customers | https://docs.salla.dev/5394121e0 | 2026-10-22 | `newCustomers` تصبح `partial("source_created_at_missing_for_some_customers")` عند وجود عملاء بلا تاريخ |
| 9 | الوثائق لا توثّق نقطة «تحليلات/تقارير مبيعات» للتطبيقات المسجَّلة استخدامها هنا | — (قرار تنفيذ) | https://docs.salla.dev/ | 2026-10-22 | كل المقاييس مشتقة محليًا من نقاط القوائم الموثقة (`products`, `categories`, `orders`, `customers`, `products/quantities`)؛ لم يُضف أي نداء غير موثّق |
| 10 | حدود النوافذ الزمنية غير موثّقة في Salla (لا «منطقة المتجر») | — (قرار تنفيذ) | https://docs.salla.dev/ | 2026-10-22 | النوافذ UTC، والتغطية تُفصح عن بداية التاريخ ونهايته بدل افتراض تقويم محلي |

### 15.1 قيود مترتبة على الأدلة (لا تعارضات)

- **الدليل 1** هو أصل معظم القيود: أي طلب لتقرير «إيراد منتج» يلزمه مصدر موثّق جديد (تقرير رسمي أو تصدير أو حدث يحمل معرّف منتج وسعرًا).
- **الدليل 2** يمنع ادّعاء «معدل بيع»؛ لا يُستخدم `sold_quantity` في أي قسمة على أيام.
- **الدليل 6** يمنع تسمية أي طلب «مرتجعًا»؛ ويُسجَّل كسؤال مفتوح في `docs/phase-07.md` §12.
- **الدليل 10** لا يتعارض مع §12.1 (الذي يذكر `date.timezone` لكل طلب): المنطقتان تُحفظان لكل طلب، لكن التجميع عبر نافذة واحدة يحتاج حدًّا موحّدًا، وUTC هو الوحيد المتماثل لكل الطلبات.

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
| 5 | `offline_access` شرط الحصول على refresh token | Salla Docs — Authorization (Important Notes) | https://docs.salla.dev/doc-421118 | 2026-10-22 | `SALLA_REQUIRED_SCOPES = ["offline_access"]`؛ لا سكوبات إضافية في Phase 03 |
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

# PHASE 06 REPORT — Webhooks + Sync Engine

**الفرع:** `arena/8ae97403-ksslla-commerce-ai` · **HEAD:** `24b0dc3` · **مرفوع إلى origin:** نعم
**التاريخ:** 2026-10-22

---

## 1. الحالة

**مكتملة محليًا وبروتوكوليًا، وبانتظار مراجعة المالك.** لم يُختبر تسليم حقيقي من Salla لعدم توفر مفاتيح تطبيق أو متجر تجريبي.

> Webhook ingestion, verification, inbox, retries, dead-letter and replay are tested locally against PostgreSQL and a protocol simulator; live Salla delivery is pending credentials.

---

## 2. نطاق المرحلة المُنجز

| المطلوب | الحالة |
|---|---|
| نقطة استقبال عامة موقّعة | ✅ `POST /api/webhooks/salla` |
| تحقق التوقيع على الجسم الخام قبل التحليل | ✅ |
| صندوق وارد في قاعدة البيانات بحالات صحيحة | ✅ `webhook_events` |
| منع تكرار بلا معرّف حدث | ✅ بصمة SHA-256 + فهرس فريد |
| رد سريع ثم معالجة في عامل | ✅ `after()` + عامل `SKIP LOCKED` |
| إعادة محاولة محدودة ثم رسالة ميتة | ✅ 1د / 5د / 15د ثم `dead_letter` |
| إعادة تشغيل محصورة بالمستأجر | ✅ API + واجهة |
| معالجات الطلبات/المنتجات/التصنيفات/العملاء/دورة الحياة | ✅ |
| محرّك مزامنة موحّد | ✅ `syncProducts/Categories/Orders/Customers/Inventory` |
| واجهة عربية RTL | ✅ `/app/webhooks` |
| محاكي | ✅ `scripts/simulate-webhook.mjs` |
| اختبارات وحدة + تكامل + Org A/B | ✅ |
| وثائق + ADRs | ✅ ADR-045…051، `docs/phase-06.md` |
| `npm run verify` + قاعدة جديدة | ✅ |

---

## 3. الملفات والبنية

51 ملفًا (منها هذا التقرير) في خمسة commits:

| Commit | المحتوى |
|---|---|
| `3277bf7` | مخطط `webhook_events`، الهجرات 0009/0010، نطاق التوقيع/الأحداث/الحالات/السياسة/الحمولة، أحداث التدقيق الجديدة، متغيرات البيئة |
| `a4b3040` | الاستقبال، العامل، المعالجات، إعادة التشغيل، الاستعلامات، محرّك المزامنة، السياق النظامي، المسارات الثلاثة، صفحة الويب والواجهة |
| `baaa826` | 4 ملفات اختبار وحدة + ملف تكامل واحد (35 اختبارًا) + مساعدات الاختبار |
| `a049be5` | `docs/phase-06.md`، ADR-045…051، §14 في `salla-reference.md`، تحديثات architecture/roadmap/README، سكربت المحاكي |
| `24b0dc3` | تدقيق مرة واحدة للتسليم المكرر غير المرتبط + حدّ زمني للطلب |

الوحدات الجديدة: `src/modules/webhooks/{domain,application,infrastructure,security}`، `src/modules/sync/application/sync-engine.ts`, `system-context.ts`، وثلاثة مسارات API + صفحة `app/webhooks`.

---

## 4. قاعدة البيانات والهجرات

| الهجرة | المحتوى |
|---|---|
| `0009_webhook_events` | جدول `webhook_events` (23 عمودًا)، مفتاحان أجنبيان (cascade)، 6 فهارس |
| `0010_webhook_events_rls` | CHECK للحالة والعدّاد، `app.is_webhook_worker()`، `app.is_webhook_ingest()`، `app.resolve_salla_store()`، تفعيل RLS وفرضه، سياسات select/insert/update، **بلا DELETE** |

**إثبات قاعدة جديدة (نُفِّذ فعليًا):**

```
migrations applied: 11
webhook_events: webhook_events
functions: is_webhook_ingest, is_webhook_worker, resolve_salla_store
policies: 3   rls enabled/forced: true true
indexes: webhook_events_event_name_idx, webhook_events_external_store_idx,
         webhook_events_org_received_idx, webhook_events_pkey,
         webhook_events_provider_hash_unique, webhook_events_status_available_idx,
         webhook_events_store_received_idx
```

لم تُعدَّل أي هجرة سابقة، ولم تُحذف بيانات.

---

## 5. الواجهات البرمجية

| المسار | الطريقة | الحماية | الغرض |
|---|---|---|---|
| `/api/webhooks/salla` | POST | توقيع HMAC فقط (بلا جلسة/CSRF/Bearer) | استقبال + إقرار |
| `/api/organizations/current/stores/[storeId]/webhooks` | GET | جلسة + `store:read` + RLS | سجل الأحداث والعدّادات |
| `/api/organizations/current/stores/[storeId]/webhooks/[eventId]/replay` | POST | جلسة + CSRF + `store:sync` + RLS | إعادة تشغيل |
| `/api/internal/webhooks/drain` | POST | `Authorization: Bearer WEBHOOK_WORKER_TOKEN` | مضخّة إعادة المحاولة المجدولة (404 عند عدم الضبط) |

كل المسارات `force-dynamic` و`runtime = "nodejs"`، والاستقبال بحد أقصى 30 ثانية.

---

## 6. الأمان وحدود الثقة

- النقطة العامة لا تثق بأي معرّف مستأجر: `organizationId`/`storeId` لا يُقرآن من الجسم إطلاقًا.
- الجسم الخام يُستخدم للتحقق والبصمة فقط، ولا يُخزَّن.
- الفشل يرد رسالة عامة واحدة: `{"error":{"code":"WEBHOOK_UNAUTHORIZED","message":"Unauthorized webhook."}}`.
- السجلات تحمل أسماء ورموزًا وعدّادات ومددًا فقط — لا توقيع، لا سرّ، لا جسم، لا PII.
- `content-type` غير JSON ⇒ 415، تجاوز 256 KiB ⇒ 413، جسم غير صالح بتوقيع صحيح ⇒ 400 برسالة محايدة.
- CSRF لا يُطبَّق على هذه النقطة (لا كوكي)، والمسار منفصل تمامًا عن OAuth والجلسات.

---

## 7. التوقيع

- HMAC-SHA256 على **الجسم الخام**، ناتج hex (64 حرفًا)، مفتاحه `SALLA_WEBHOOK_SECRET`.
- ترويستان موثّقتان: `X-Salla-Security-Strategy` و`X-Salla-Signature`.
- المقارنة `timingSafeEqual` بعد فحص الطول؛ لا `===`.
- `Signature` مدعومة، وغياب ترويسة الاستراتيجية مقبول إذا صحّ التوقيع؛ `Token` وأي قيمة أخرى ⇒ `unsupported_strategy` ⇒ 401.
- لا سرّ مُهيّأ ⇒ 503 لكل التسليمات (لا قبول غير متحقّق منه).
- عيّنة Node في وثائق Salla تعيد تسلسل الجسم؛ لم تُتَّبع، والسبب موثّق في ADR-045 و§14.8.1.

---

## 8. صندوق الوارد وآلة الحالات

```
received ──▶ processing ──▶ processed
   ▲             │
   │             ├──▶ failed ──(available_at)──▶ processing
   │             │        └── attempts exhausted ──▶ dead_letter
   └── replay ───┴──▶ dead_letter
unmatched / ignored — نهائيتان
```

- الأعمدة: الهوية، اسم الحدث، `payload_hash`، الإسقاط، الحالة، `attempt_count`، `available_at`، `processing_started_at`، `processed_at/failed_at`، `last_error_code/message`، `result`، الطوابع.
- `processing → processed` لا يحدث إلا بعد نجاح العمل فعليًا؛ الفشل يبقى `failed` أو `dead_letter`.
- الانتقال من حالة نهائية إلى `processing` ممنوع؛ الوحيد الذي يعيد فتحها هو إعادة التشغيل إلى `received`.
- الاستيلاء كلـ`lease` (120 ثانية): صف `processing` انقطع عامله يُستولى عليه بعد انتهاء المهلة.

---

## 9. منع التكرار

- المفتاح: `(provider, payload_hash)` فريد + `on conflict do nothing` + إعادة قراءة.
- التسليم المكرر ⇒ `200 {"received":true,"duplicate":true}` بلا صف جديد وبلا زيادة عدّاد.
- اختبار تكاملي بأربع تسليمات متوازية لنفس الجسم: صف واحد، وأربعة ردود ناجحة.
- `external_event_id` عمود محفوظ لمعرّف مستقبلي، غير مستخدم ولا يُملأ بقيم مخترعة.

---

## 10. ربط المستأجر

```
envelope.merchant → app.resolve_salla_store() [SECURITY DEFINER, read-only]
                  → store_connections(external_store_id) → (organization_id, store_id)
```

- `merchant` قيمة كُتبت في `store_connections` أثناء OAuth مكتمل — لا تُشتق من `data.id` ولا من أي حقل قابل للتزوير.
- اختبار يرسل `organization_id`/`store_id` مزيّفين ويؤكد أنهما لا يُستخدمان ولا يُخزَّنان.
- الدالة تُرجع المعرّفات وحالة الاتصال فقط (لا رموز، لا أسماء، لا سكوبات).
- غير القابل للربط ⇒ `organization_id IS NULL` + `unmatched`، غير مرئي لأي مستأجر ولا يستوليه العامل.

---

## 11. محرّك المزامنة

- `runResourceSync({resource})` هو المدخل الوحيد: `products|categories` عبر `syncStore`، و`orders|customers|inventory` عبر `syncStoreData`.
- **بلا تكرار للمنطق:** نفس القفل، نفس `sync_runs`، نفس تجديد الرمز وحدود المعدل.
- **الدمج:** لا نداء إذا وُجد تشغيل **ناجح** لنفس `(store, resource)` بدأ بعد وصول الحدث. التشغيل الفاشل أو الجاري لا يُعدّ تغطية (خطأ اكتُشف وأُصلح أثناء الاختبار: كان التشغيل الفاشل يبتلع الحدث).
- سياق نظام: `initiated_by_user_id = NULL` و`trigger = 'webhook'`، بلا انتحال مستخدم.
- المزامنة اليدوية لم تتغيّر سلوكيًا؛ أُضيف حقلان اختياريان فقط إلى `SyncRuntime`/`DataSyncRuntime`.

---

## 12. المعالجات والأحداث المدعومة

| العائلة | العدد | الإجراء |
|---|---|---|
| الطلبات | 17 | مزامنة طلبات |
| المنتجات | 11 (منها مهجوران) | مزامنة منتجات |
| `product.quantity.low` | 1 | منتجات + مخزون |
| التصنيفات | 2 | مزامنة تصنيفات |
| العملاء | 2 | مزامنة عملاء |
| `customer.login`, `customer.otp.request` | 2 | تجاهل (إشارة جلسة) |
| `app.store.authorize` | 1 | تسجيل تدقيقي (بلا رموز) |
| `app.updated` | 1 | تسجيل تدقيقي |
| `app.uninstalled` | 1 | فصل الاتصال + احتفاظ بالبيانات |
| باقي `app.*` | 10 | تجاهل |
| أي اسم غير معروف | — | `ignored` + 2xx |

كل اسم مأخوذ حرفيًا من الكتالوج الموثّق (`docs/salla-reference.md` §14.4).

---

## 13. دورة حياة التطبيق

- **`app.store.authorize`**: يُتحقّق ويُربط ويُسجَّل، ولا يُخزَّن أي رمز منه ولا يُحدَّث أي رمز قائم (`tokensApplied: false`). اختبار تكاملي يقارن `access_token_ciphertext`/`refresh_token_ciphertext`/`token_version` قبل وبعد.
- **`app.updated`**: تسجيل فقط، وحالة الاتصال تبقى `connected`.
- **`app.uninstalled`**: يعيد استخدام مسار الفصل في Phase 03 (`disconnectConnection` + `updateStoreStatus('not_connected')` + تدقيق)، فتُمحى الرموز المشفّرة ويُضبط `revoked_at`، وتبقى المنتجات والطلبات والعملاء والمخزون و`sync_runs`.

---

## 14. إعادة المحاولة والرسائل الميتة

| المحاولة | الحالة | `available_at` |
|---|---|---|
| 1 | `failed` | +60 ثانية |
| 2 | `failed` | +5 دقائق |
| 3 | `dead_letter` | — |

- الأخطاء غير القابلة للإعادة تذهب مباشرة إلى `dead_letter`.
- **إعادة محاولة Salla ليست هذه:** Salla تعيد 3 مرات ~5 دقائق (موثّق §14.5)؛ جدولنا داخلي.
- `CONFLICT` (مزامنة جارية) لا يُعدّ فشلًا عند المعالج، بل تغطية.

---

## 15. إعادة التشغيل

- تتطلب `store:sync`، وتُحدِّث الحالة إلى `received` وتصفّر العدّاد وتكتب تدقيق `webhook.replayed` بهوية الفاعل.
- محصورة بالمستأجر عبر RLS + البحث الصريح: حدث مؤسسة أخرى ⇒ 404.
- مُختبرة: `dead_letter` ➜ `/app/webhooks` ➜ `received` ➜ `processed` بعد إصلاح العطل.
- مشاهد بلا `store:sync`: يقرأ السجل (200) ويُرفض في الإعادة (403 `FORBIDDEN`).

---

## 16. الواجهة العربية

`/app/webhooks` (RTL، بادئة المتجر، رابط في شريط التنقل):

- أربعة عدّادات رئيسية + ثلاث حالات إضافية (غير مرتبط، قيد المعالجة، متجاهَل) — كلها من PostgreSQL.
- سجل بأحدث 40 حدثًا: الاسم، الحالة، عدد المحاولات، وقت الوصول/المعالجة، الإجراء، رمز الخطأ.
- زر إعادة تشغيل يظهر فقط في `failed`/`dead_letter` ولمن يملك الصلاحية، مع تنبيه صريح عند غيابها.
- حالة فراغ حقيقية عند عدم وصول أي حدث، بلا أرقام وهمية.

---

## 17. المحاكي

`scripts/simulate-webhook.mjs` — سيناريوهات: `valid`, `invalid-signature`, `duplicate`, `malformed`, `unknown-event`, `uninstalled`، بهدف `APP_URL` ومفتاح `SALLA_WEBHOOK_SECRET`. البيانات محاكاة صريحة وليست من Salla.

---

## 18. Implemented / Tested locally / Protocol tested / Live tested

| البند | الحالة |
|---|---|
| **Implemented** | كل ما ورد في §2 — كود كامل داخل المستودع |
| **Tested locally (unit)** | 261 اختبارًا، منها 82 جديدة للويبهوك |
| **Tested locally (integration on real PostgreSQL + RLS)** | 137 اختبارًا، منها 35 جديدة |
| **Protocol tested (Salla simulator)** | ✅ المحاكي يرسل ترويسات وتوقيعًا مطابقين للوثيقة، وأُعيد إنتاج المسار كاملًا |
| **Live tested (Salla حقيقي)** | ❌ **NOT AVAILABLE** — لا مفاتيح تطبيق ولا متجر تجريبي |

---

## 19. الاختبارات بالأرقام

| المجموعة | الملفات | الاختبارات |
|---|---|---|
| وحدة إجمالًا | 28 | **261** |
| — ويبهوك (توقيع، أحداث، حالات، حمولة) | 4 | **82** |
| تكامل إجمالًا | 9 | **137** |
| — ويبهوك (استقبال، عامل، إعادة، RLS، RBAC، أسرار) | 1 | **35** |
| **المجموع** | **37** | **398** |

تغطية خاصة: توقيع خاطئ/ناقص/مشوّه/استراتيجية غير مدعومة، جسم مُعاد تنسيقه، تكرار متسلسل ومتوازٍ، مزامنة قبل الإقرار (لا نداء للمزوّد)، حدث غير معروف، إعادة محاولة كاملة حتى `dead_letter`، عدم الاستيلاء قبل الاستحقاق، ثلاثة عمال متوازين، دمج ثلاثة أحداث في تشغيل واحد، دورة حياة التطبيق، **Org A / Org B DENY** (قراءة وإعادة تشغيل وتحديث مباشر عبر RLS)، غياب الأسرار من قاعدة البيانات والتدقيق.

---

## 20. التحقق

```
npm run verify  →  exit 0
format ✓  lint ✓  typecheck ✓  unit 261 ✓  integration 137 ✓  secrets ✓  build ✓
```

- بناء إنتاجي ناجح، والمسارات الجديدة ظاهرة في مخرجات البناء.
- هجرة قاعدة جديدة: 11 هجرة، RLS مفعّل ومفروض، 3 سياسات، 7 فهارس (§4).

---

## 21. الدخان اليدوي (خادم تطوير حقيقي + محاكي)

| السيناريو | النتيجة |
|---|---|
| تسليم صحيح لمتجر مربوط | 200 `{received:true,duplicate:false}` ➜ `processed` تلقائيًا عبر `after()` بلا أي طلب إضافي |
| توقيع خاطئ | 401 `Unauthorized webhook`، بلا صف |
| نفس الجسم مرتين | 200 ثم 200 `duplicate:true`، صف واحد |
| JSON مشوّه بتوقيع صحيح | 400 `WEBHOOK_INVALID_PAYLOAD`، بلا صف |
| حدث غير معروف (متجر مربوط) | 200 ثم `ignored` |
| حدث غير معروف (متجر غير مربوط) | 200 ثم `unmatched` بلا مستأجر |
| عطل المزوّد (500) | `failed` (1) ➜ `failed` (2) ➜ `dead_letter` (3) |
| مضخّة العامل برمز صحيح | 200 مع عدّادات الاستنزاف |
| إعادة تشغيل بعد إصلاح العطل | `received` ➜ `processed`، `attempt_count = 1` |
| `/app/webhooks` | 200، النصوص العربية والبيانات الحقيقية ظاهرة، لا صفحة خطأ |
| سجلات الخادم | لا سرّ ولا توقيع ولا جسم؛ أسماء أحداث ورموز فقط |

---

## 22. القيود المعروفة

1. **إعادة المحاولة المؤجلة تحتاج مضخّة:** بلا `WEBHOOK_WORKER_TOKEN` ومهمة مجدولة، يُستهلك الاستحقاق عند وصول تسليم لاحق فقط. العامل والمضخّة جاهزان؛ الجدولة خارج نطاق المرحلة.
2. **`unmatched` نهائي:** لا مسار لإعادة ربط تسليم وصل قبل ربط المتجر.
3. **استراتيجية `Token` مرفوضة** صراحةً (غير موثّقة الترويسات).
4. **المزامنة عند كل حدث هي مزامنة مورد كاملة** (مع دمج)، لا تحديث كائن واحد؛ التحديث الكائني يحتاج نقاطًا موثّقة لكل مورد.
5. **`app.store.authorize` لا يطبّق رموزًا** — OAuth يبقى المصدر الوحيد للرموز.
6. **حد الجسم 256 KiB** قرار محلي لا موثّق.
7. **لا سياسة احتفاظ** للصندوق بعد (مقصود).
8. **`external_event_id` غير مستخدم** حتى توثّق Salla معرّف حدث.

---

## 23. التوافق مع المراحل 01–05 والمخاطر

- لم تُعدَّل أي هجرة سابقة، ولم تتغيّر أي نقطة مزامنة يدوية.
- التغيير الوحيد على كود سابق: حقلان اختياريان في سياقَي المزامنة + توسيع `AUDIT_ACTIONS` + سطر في `truncate` الخاص بالاختبارات + مسارات في مساعد الاختبار.
- كل اختبارات المراحل السابقة تمر (179 وحدة + 102 تكامل سابقة).
- **المخاطر المتبقية:** حِمل المزامنة عند عاصفة أحداث حقيقية (مخفّف بالدمج والقفل، ويحتاج قياسًا حقيقيًا)، وسلوك تسليم Salla الفعلي (ترويسات/توقيت) غير مُتحقّق منه حيًّا.

---

## 24. الخطوة التالية الموصى بها

**PHASE 07 فقط — وبعد مراجعة المالك لهذا التقرير.** لا عمل تحليلي أو ذكاء اصطناعي قبل هذه المراجعة.

اقتراح نطاق Phase 07 الأولي: مُجدول دوري يستدعي مضخّة العامل، وسياسة احتفاظ للصندوق، ثم Store Intelligence على البيانات الموجودة.

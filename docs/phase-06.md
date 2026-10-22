# Phase 06 — Webhooks + Sync Engine

> **الحالة:** منفّذة ومُختبرة محليًا (وحدة + تكامل على PostgreSQL حقيقي) ومُختبرة بروتوكوليًا على محاكي Salla. **لم يُختبر الاستدعاء الحقيقي لـ Salla** لعدم توفر مفاتيح تطبيق أو متجر تجريبي.
>
> **الجملة المعتمدة:** Webhook ingestion, verification, inbox, retry, dead-letter and replay are tested locally against PostgreSQL; live Salla delivery is pending credentials.

---

## 1. الهدف

استقبال أحداث Salla بأمان، وتثبيتها قبل معالجتها، ثم تحديث الحالة المحلية عبر **نفس** خدمات المزامنة التي تستخدمها الأزرار اليدوية — بلا مسار كتابة ثانٍ، وبلا ثقة في جسم الويبهوك.

```
POST /api/webhooks/salla
  → raw body → HMAC verify (timing-safe) → JSON parse → envelope validate
  → merchant → store_connections → organization/store
  → INSERT webhook_events (received | unmatched)  → 2xx ACK
  → after() → worker (FOR UPDATE SKIP LOCKED)
  → tenant tx → handler → SyncEngine → sync_runs
  → PROCESSED | FAILED(available_at) | DEAD_LETTER | IGNORED
```

**خارج النطاق صراحةً:** أي كتابة إلى Salla، وأي تحليلات/توصيات/تسويق، وأي مُجدول مزامنة دوري (Phase 07+)، وأي Kafka/Redis/طابور خارجي.

---

## 2. حدود المرحلة

| مبدأ | التنفيذ |
|---|---|
| لا ثقة قبل التحقق | لا يُقرأ الجسم كـ JSON قبل التحقق من التوقيع؛ لا `organizationId`/`storeId` من العميل |
| إقرار سريع | الرد 2xx لا ينتظر أي نداء إلى Salla (اختبار يثبت أن المحاكي لم يُستدعَ) |
| تثبيت قبل المعالجة | `INSERT` داخل معاملة، ثم معالجة لاحقة؛ لا فقدان حدث عند تعطّل المعالجة |
| لا تكرار | بصمة الجسم + فهرس فريد + `on conflict do nothing` |
| عزل المستأجر | RLS مفعّل مع سياقين فقط (عامل/استقبال)؛ كل معالجة داخل معاملة المستأجر |
| لا اختراع | كل اسم حدث ومعامل وتوقيع مأخوذ من `docs/salla-reference.md` §14 |

---

## 3. البنية

| الملف | الدور |
|---|---|
| `src/app/api/webhooks/salla/route.ts` | النقطة العامة: حدّ حجم، نوع محتوى، تحقق، تثبيت، إقرار، جدولة العامل |
| `src/modules/webhooks/domain/signature.ts` | HMAC-SHA256 على الجسم الخام + مقارنة زمنية ثابتة |
| `src/modules/webhooks/domain/payload.ts` | غلاف Zod + بصمة الجسم + إسقاط قائمة السماح |
| `src/modules/webhooks/domain/events.ts` | كتالوج الأحداث → إجراء |
| `src/modules/webhooks/domain/status.ts` | آلة الحالات |
| `src/modules/webhooks/domain/retry.ts` | سياسة إعادة المحاولة الداخلية |
| `src/modules/webhooks/application/ingest.ts` | تحقق → تحليل → ربط مستأجر → تثبيت |
| `src/modules/webhooks/application/worker.ts` | استيلاء + معالجة + تسجيل النتيجة |
| `src/modules/webhooks/application/handlers.ts` | حدث → إجراء (مزامنة/فصل/تسجيل/تجاهل) |
| `src/modules/webhooks/application/replay.ts` | إعادة تشغيل مُدقّقة ومحصورة بالمستأجر |
| `src/modules/webhooks/infrastructure/event-repository.ts` | كل SQL الخاص بالصندوق |
| `src/modules/webhooks/infrastructure/store-resolver.ts` | `merchant → organization/store` |
| `src/modules/sync/application/sync-engine.ts` | الواجهة الموحّدة `syncProducts/Categories/Orders/Customers/Inventory` |
| `src/app/api/internal/webhooks/drain/route.ts` | مضخّة العامل للمهام المجدولة (رمز حامل) |

---

## 4. التدفّق بالتفصيل

1. **طريقة/نوع/حجم:** `POST` فقط (بقية الطرق 405 من Next)، `content-type` يجب أن يتضمن `application/json` (وإلا 415)، والحد 256 KiB (وإلا 413) — يُفحص `content-length` قبل القراءة، والطول الفعلي بعدها.
2. **التحقق:** `X-Salla-Signature` على الجسم الخام. الفشل ⇒ `401 Unauthorized webhook` عام، بلا تفاصيل.
3. **التحليل:** `JSON.parse` بعد التحقق فقط؛ الفشل ⇒ 400.
4. **الغلاف:** `event` و`merchant` مطلوبان؛ الحقول الإضافية تُتجاهل.
5. **الربط:** `merchant` → `app.resolve_salla_store()` → `(organization_id, store_id)`.
6. **التثبيت:** داخل معاملة المستأجر (`received`)، أو بلا مستأجر (`unmatched`).
7. **الإقرار:** `200 { received: true, duplicate }`، ثم `after()` يجدول العامل.
8. **المعالجة:** استيلاء `SKIP LOCKED` → معاملة المستأجر → المعالج → `processed`/`failed`/`dead_letter`.

---

## 5. الأمان والتوقيع

- **الخوارزمية:** HMAC-SHA256، ناتج hex بطول 64، مفتاحه سرّ الويبهوك (`SALLA_WEBHOOK_SECRET`).
- **الجسم الخام:** لا إعادة تسلسل. اختبار وحدة يثبت أن بصمة جسم مُعاد تنسيقه لا تُطابق توقيع الجسم الأصلي.
- **المقارنة:** `timingSafeEqual` بعد فحص الطول.
- **الاستراتيجيات:** `Signature` مدعومة؛ `Token` وأي قيمة أخرى ⇒ `unsupported_strategy` و401 **حتى مع توقيع صحيح**. غياب الترويسة ⇒ الافتراضي `Signature` **بشرط** صحّة التوقيع (ADR-052).
- **الترتيب:** سرّ غير مضبوط 503 → توقيع غائب 401 → استراتيجية غير مدعومة 401 → توقيع غير 64-hex 401 (`malformed_signature`) → عدم تطابق 401. لا مسار تجاوز.
- **غياب السرّ:** 503 لكل تسليم — لا قبول غير متحقّق منه.
- **السجلات:** عند القبول يُسجَّل `event`, `eventName`, `organizationId`, `storeId`, `webhookEventId`, `duplicate`, `durationMs`. لا توقيع، لا سرّ، لا جسم، لا PII.
- **حدود منفصلة:** هذه النقطة عامة بلا جلسة وبلا CSRF وبلا Bearer؛ حد أمانها الوحيد هو التوقيع. لا تتشارك أي مسار مع OAuth أو الجلسات.

---

## 6. صندوق الوارد (Inbox)

`webhook_events` (الهجرة `0009` + `0010`):

| العمود | الغرض |
|---|---|
| `organization_id`, `store_id` | الهوية بعد الربط؛ `NULL` للتسليم غير القابل للربط |
| `provider` | `salla` (يسمح بمزوّد ثانٍ لاحقًا بنفس الجدول) |
| `event_name`, `event_version` | اسم الحدث وإصدار الـ API (يبقى `NULL`: الإصدار معامل تسجيل لا ترويسة تسليم) |
| `external_event_id` | محفوظ لمعرّف مستقبلي — **غير مستخدم اليوم** |
| `external_store_id` | `merchant` كما وصل |
| `signature_strategy` | `Signature` (أو الافتراضي عند غياب الترويسة) |
| `payload_hash` | SHA-256 للجسم الخام (مفتاح منع التكرار) |
| `payload` | إسقاط بقائمة سماح (ADR-047) |
| `status` | `received｜processing｜processed｜failed｜dead_letter｜unmatched｜ignored` (CHECK) |
| `attempt_count` | يزيد عند كل استيلاء (CHECK ≥ 0) |
| `available_at` | متى يصبح الصف قابلًا للاستيلاء |
| `processing_started_at` | بداية المحاولة الحالية (للتأجير) |
| `last_error_code`, `last_error_message` | سبب الفشل بلا بيانات حساسة |
| `result` | ملخّص الإجراء (`action`, `resources`, `runId`, …) |

**الفهارس:** `(provider, payload_hash)` فريد، `(status, available_at)`, `(organization_id, received_at)`, `(store_id, received_at)`, `event_name`, `external_store_id`.

**RLS:** مفعّل ومفروض. ثلاثة سياقات:
- مستأجر (`app.current_org`) — يرى صفوفه فقط.
- عامل (`app.webhook_worker = 'on'`) — يرى الكل ويستولي؛ يُضبط فقط داخل `drainWebhookEvents`.
- استقبال (`app.webhook_ingest = 'on'`) — يرى **فقط** الصفوف بلا مستأجر، ويُضبط فقط في فرع `unmatched`.
- **لا سياسة DELETE.**

---

## 7. منع التكرار

- **المفتاح:** `(provider, payload_hash)`؛ نفس الجسم ⇒ نفس الصف مهما تكرر التسليم.
- **السلوك:** التسليم الثاني يرد `200 { duplicate: true }` ولا يزيد `attempt_count`.
- **التزامن:** تسليمان متطابقان في اللحظة نفسها → `on conflict do nothing` + إعادة قراءة؛ اختبار تكاملي بأربع تسليمات متوازية يثبت صفًا واحدًا.
- **لمَ لا `created_at`؟** لأن حدثين مختلفين قد يقعان في الثانية نفسها، والطابع غير موثوق كمعرّف.
- **REPLAY:** إعادة التشغيل تُبقي نفس `payload_hash` — أي أن إعادة التسليم من Salla تبقى مكرّرة، وإعادة التشغيل الداخلية تبقى حدثًا واحدًا يُعاد فتحه.

---

## 8. إعادة المحاولة والرسائل الميتة

| بعد المحاولة | الحالة | `available_at` |
|---|---|---|
| 1 (فشل قابل للإعادة) | `failed` | +60 ثانية |
| 2 (فشل قابل للإعادة) | `failed` | +5 دقائق |
| 3 | `dead_letter` | — |
| أي محاولة بخطأ غير قابل للإعادة | `dead_letter` | — |

- الأخطاء غير القابلة للإعادة: `INTEGRATION_AUTH_REQUIRED`, `INTEGRATION_NOT_CONNECTED`, `FORBIDDEN`, `UNAUTHENTICATED`, `NOT_FOUND`, `VALIDATION_FAILED`, `TENANT_ISOLATION_VIOLATION`, `CONFIG_INVALID`.
- **هذا ليس سلوك Salla:** إعادة محاولة Salla موثّقة بـ 3 محاولات ~5 دقائق (14.5)؛ جدولنا داخلي ومستقل.
- **المضخّة:** حدث جديد أو إعادة تشغيل تُشغّل العامل مباشرة؛ والاستحقاقات المؤجلة تُعالَج عبر `POST /api/internal/webhooks/drain` برمز حامل (`WEBHOOK_WORKER_TOKEN`، 404 عند عدم ضبطه). بدونه تعمل إعادة المحاولة عند وصول تسليم لاحق فقط — قيد موثّق في §16.
- **إعادة التشغيل:** `POST /api/organizations/current/stores/{storeId}/webhooks/{eventId}/replay` بصلاحية `store:sync`، تحدّث الحالة إلى `received` وتصفّر العدّاد وتكتب تدقيق `webhook.replayed`.

---

## 9. ربط المستأجر

```
envelope.merchant ──▶ app.resolve_salla_store(text) ──▶ (organization_id, store_id, status)
                          │ SECURITY DEFINER
                          └── store_connections(provider='salla', external_store_id)
```

- الربط يستخدم **معرّف المتجر التجاري** فقط، وهو قيمة كُتبت في `store_connections` أثناء OAuth مكتمل.
- لا يُشتق المستأجر من `data.id` ولا من بريد ولا من اسم متجر ولا من أي حقل قابل للتزوير.
- اختبار تكاملي يرسل جسمًا يحمل `organization_id` و`store_id` مزيّفين ويؤكد أنهما لا يُستخدمان ولا يُخزَّنان.
- التسليم غير القابل للربط يُحفظ `unmatched` بلا مستأجر (ADR-051).

---

## 10. التحويل إلى حالة محلية (Sync mapping)

| الحدث | الإجراء |
|---|---|
| 17 حدث طلب | `syncOrders` |
| 9 أحداث منتج حالية + حدثان مهجوران (`product.updated`, `product.available`) | `syncProducts` (المهجور موسوم `deprecated` في النتيجة) |
| `product.quantity.low` | `syncProducts` ثم `syncInventory` |
| `category.created/updated` | `syncCategories` |
| `customer.created/updated` | `syncCustomers` |
| `customer.login`, `customer.otp.request` | تجاهل (`customer_session_signal`) |
| `app.store.authorize` | تسجيل تدقيقي فقط |
| `app.updated` | تسجيل تدقيقي فقط |
| `app.uninstalled` | فصل الاتصال + `not_connected` + احتفاظ بالبيانات |
| بقية `app.*` | تجاهل (`lifecycle_not_actionable`) |
| أسرة موثّقة غير مستهلكة (شحن، شحنات، علامات، فروع، سلات، فواتير، عروض، مراجعات) — 24 اسمًا | تجاهل (`documented_not_consumed`) + 2xx |
| أي اسم غير موثّق | تجاهل (`unknown_event`) + 2xx |

- كل مورد يُقرأ عبر الـ API الرسمي، لا من الحمولة. بنود الطلب تبقى بقائمة سماح Phase 05 (ADR-043).
- المزامنة تعمل بسياق نظام: `initiated_by_user_id = NULL` و`trigger = 'webhook'`، ولا تنتحل مستخدمًا.
- **الدمج:** حدث لاحق لنفس `(store, resource)` لا يعيد النداء إذا نجح تشغيل بدأ بعده؛ الفشل لا يُعدّ تغطية.

---

## 11. الواجهة (عربية RTL)

`/app/webhooks` — يظهر في شريط التنقل وبادئة المتجر:

- عدّادات حقيقية: محفوظ، تمت معالجته، بانتظار إعادة، فاشل نهائيًا، غير مرتبط، قيد المعالجة، متجاهَل.
- جدول أحدث الأحداث: الاسم، الحالة، عدد المحاولات، وقت الوصول/المعالجة، الإجراء، ورمز الخطأ عند الفشل.
- زر «إعادة تشغيل» يظهر فقط في `failed`/`dead_letter` ولمن يملك `store:sync`؛ غياب الصلاحية يعرض تنبيهًا بدل زر معطّل بلا سبب.
- لا بيانات وهمية: الصفحة تعرض ما في PostgreSQL فقط، ورسالة صريحة عند عدم وصول أي حدث.
- المكوّن `SimulatorNotice` يوضّح أن مصدر البيانات محاكي عند تشغيل البيئة على محاكي.

---

## 12. الخصوصية والتدقيق

- لا يُحفظ الجسم. الإسقاط يشمل `event`, `merchant`, `created_at`, `data.id` فقط (+`scope/expires/token_type` لحدث التفويض).
- لا رموز ولا توقيعات في أي عمود أو سجل أو تدقيق.
- أحداث التدقيق الجديدة: `webhook.received`, `webhook.processed`, `webhook.failed`, `webhook.dead_letter`, `webhook.replayed`, `webhook.unmatched`, `salla.app.authorized`, `salla.app.updated`, `salla.app.uninstalled`.
- التدقيق يخزّن اسم الحدث والرموز (codes) وعدد المحاولات والمدد — لا محتوى.

---

## 13. قاعدة البيانات والهجرات

| الهجرة | المحتوى |
|---|---|
| `0009_webhook_events` | الجدول + مفتاح أجنبي للمؤسسة/المتجر (cascade) + 6 فهارس |
| `0010_webhook_events_rls` | CHECK للحالة والعدّاد، `app.is_webhook_worker()`, `app.is_webhook_ingest()`, `app.resolve_salla_store()`, تفعيل RLS وفرضه، سياسات select/insert/update، بلا DELETE |

- لم تُعدَّل أي هجرة سابقة، ولم تُحذف أي بيانات.
- **إثبات الهجرة على قاعدة جديدة:** مجموعة التكامل تُنشئ قاعدة فارغة ثم تُطبّق الهجرات الإحدى عشرة كلها قبل أي اختبار.
- `drizzle/meta` يحتوي لقطة `0009`؛ `0010` مكتوبة يدويًا (كما `0005`/`0007`) فلا لقطة لها.

---

## 14. الاختبارات

**وحدة (4 ملفات، 119 اختبارًا):**

| الملف | ما يثبته |
|---|---|
| `signature.test.ts` | 26 حالة: بذرة `openssl` مستقلة (HMAC لا SHA256 غير مفتاحي)، صحيح/خاطئ، جسم معدَّل، توقيع معدَّل، مفتاح آخر، توقيع ناقص، استراتيجية غائبة، `Token`/`HMAC`/`None`، جسم خام مقابل معاد التسلسل، فروق تنسيق JSON، سرّ غائب، توقيت ثابت، عدم تسريب، صيغة مشوّهة، `safeEqualString` |
| `events.test.ts` | 65 حالة: 47 حدثًا (17 طلب، 11 منتج، 2 تصنيف، 4 عميل، 13 تطبيق)، وسم الحدثين المهجورين، `quantity.low` → منتجات+مخزون، 24 اسمًا موثّقًا غير مستهلك، غير المعروف، أسماء متشابهة البادئة، اتساق موارد المزامنة |
| `status.test.ts` | مطابقة جدول الانتقالات لكل زوج، منع عودة الحالات النهائية، الاستيلاء على `received`/`failed` فقط، جدول التأخير، الرسالة الميتة عند 3، تصنيف الأخطاء |
| `payload.test.ts` | الغلاف، تطبيع `merchant`، الحقول الزائدة، إسقاط بلا PII ولا رموز، `containsRedactedKey` مع الدوران، ثبات البصمة وحساسيتها للبايتات |

**تكامل (40 اختبارًا في ملف واحد، على PostgreSQL حقيقي بدور غير مُميّز وRLS):**

- إقرار بلا أي نداء إلى المزوّد (لا مزامنة قبل الإقرار).
- توقيع خاطئ/ناقص/استراتيجية `Token`/JSON مشوّه/نوع محتوى/حجم كبير/سرّ غائب.
- عقد الاستراتيجية: `Token`/`HMAC`/`None`/`Signature,Token` تُرفض **مع توقيع صحيح**؛ غياب الترويسة يُقبل كافتراضي `Signature` بشرط صحّة التوقيع ويُخزَّن `signatureStrategy = "Signature"`.
- الجسم الخام: توقيع صحيح على جسم، ثم إرسال نسخة pretty أو مع مفاتيح معاد ترتيبها ⇒ 401.
- توقيع غير hex بطول صحيح ⇒ 401 قبل أي مقارنة.
- ربط المستأجر، تجاهل الحقول المزيّفة، تسليم غير قابل للربط، تكرار متسلسل ومتوازٍ.
- **Org A / Org B معرّفات مزيّفة:** `organization_id`/`store_id`/`user_id` في الجسم **وفي سلسلة الاستعلام** لا تغيّر المستأجر؛ الحدث يبقى في Org A، وOrg B لا ترى شيئًا، ولا تُخزَّن أي معرّفات لها.
- إسقاط بلا PII في الصف المخزَّن.
- معالجة منتج وطلب فعليًا، حدث غير معروف ⇒ `ignored`، دمج ثلاثة أحداث منتج في تشغيل واحد.
- إعادة محاولة كاملة حتى `dead_letter` ثم إعادة تشغيل تنجح بعد إصلاح العطل، وعدم الاستيلاء قبل الاستحقاق.
- ثلاثة عمال متوازين: كل حدث يُعالَج مرة واحدة.
- دورة حياة التطبيق: فصل مع احتفاظ بالبيانات، تفويض بلا لمس الرموز، تحديث تطبيق بلا كتابة فوق الحالة.
- RBAC: مشاهد يقرأ السجل ولا يعيد التشغيل (403).
- **Org A / Org B:** 404 للسجل وإعادة التشغيل عبر متجر الآخر أو بمعرّف حدث أجنبي، وRLS تمنع القراءة والتحديث عبر المستأجرين.
- مضخّة العامل: 404 بلا رمز مُهيأ، 401 برمز خاطئ، استنزاف فعلي بالرمز الصحيح.
- لا سرّ ولا توقيع في قاعدة البيانات ولا في التدقيق.

**المجموع بعد تصحيح Phase 06:** 440 اختبارًا (298 وحدة + 142 تكامل).

---

## 15. التحقق اليدوي (Smoke)

1. `POST /api/webhooks/salla` بتوقيع صحيح ⇒ 200 وصف جديد `received`.
2. توقيع خاطئ ⇒ 401 `Unauthorized webhook` بلا صف.
3. نفس الجسم مرتين ⇒ 200 ثم 200 مع `duplicate: true`.
4. حدث غير معروف ⇒ 200 ثم `ignored`.
5. تعطيل المزوّد (محاكي يرد 500) ⇒ `failed` ثم `dead_letter` بعد 3 محاولات، ثم إعادة تشغيل من `/app/webhooks` بعد الإصلاح ⇒ `processed`.
6. `/app/webhooks` تعرض الأحداث والعدّادات، وزر إعادة التشغيل يعمل لمن يملك `store:sync`.
7. لا 500 غير متوقع في أي من الحالات أعلاه.
8. سكربت المحاكي: `node scripts/simulate-webhook.mjs --scenario valid|invalid-signature|duplicate|malformed|unknown-event|uninstalled`.

---

## 16. القيود المعروفة

1. **الاستحقاقات المؤجلة تحتاج مضخّة:** بلا `WEBHOOK_WORKER_TOKEN` ومهمة مجدولة، تُستهلك إعادة المحاولة عند وصول تسليم لاحق فقط. العامل نفسه جاهز؛ ما ينقص هو المجدول (Phase 07+).
2. **`unmatched` نهائي:** إذا رُبط المتجر بعد وصول الحدث فلا مسار اليوم لإعادة ربطه بمستأجر. الأثر: الحدث محفوظ ومتاح للتدقيق لكنه غير معالَج.
3. **استراتيجية `Token` غير مدعومة:** تُرفض صراحةً؛ دعمها يحتاج توثيقًا لترويساتها.
4. **لا يُثبت ترتيب الأحداث:** كل حدث يقرأ الحالة الحالية، فالترتيب غير مهم لكن «الأحدث يفوز» يعتمد على آخر قراءة لا على ترتيب الوصول.
5. **لا مزامنة كاملة عند الإلغاء/إعادة الربط:** لا إعادة مزامنة تلقائية بعد استعادة الاتصال؛ الأزرار اليدوية تبقى المسار.
6. **`external_event_id` غير مستخدم:** يبقى `NULL` حتى توثّق Salla معرّف حدث.
7. **حد الجسم 256 KiB:** كافٍ لأحداث Salla الموثّقة، لكنه قرار محلي لا موثّق من المزوّد.
8. **السجلات تُحفظ بلا سياسة احتفاظ:** لا تنظيف تلقائي للصندوق بعد (مقصود: التدقيق أهم من التوفير الآن).

---

## 17. التوافق مع المراحل السابقة

- Phase 01–05 لم تُعد كتابتها؛ التغيير الوحيد على كود سابق هو إضافة `actorUserId`/`trigger` كحقلين اختياريين في `SyncRuntime` و`DataSyncRuntime` (سلوك المزامنة اليدوية كما هو).
- `AUDIT_ACTIONS` وُسّع بأحداث `webhook.*` و`salla.app.*` فقط.
- مسارات المزامنة اليدوية لم تتغيّر.
- كل اختبارات المراحل السابقة تمر كما هي (179 وحدة + 102 تكامل سابقة).

---

## 18. الخطوة التالية

Phase 07 فقط، وبعد مراجعة المالك. لا يبدأ أي عمل تحليلي قبل هذه المراجعة.

# Phase 03 — Salla OAuth + Store Connection

> **الهدف الوحيد:** ربط سجل متجر داخلي بمتجر Salla رسميًا وبأمان، عبر مسار:
> مستخدم مُصادَق → مؤسسة مُصرَّح لها → متجر → تفويض تطبيق Salla → OAuth → تبادل الرمز → تخزين مشفّر → هوية متجر Salla → اتصال.
>
> **خارج النطاق صراحةً:** أي مزامنة منتجات/تصنيفات/طلبات/عملاء/مخزون/تقييمات، أي Webhooks، SEO، Search Console، تحليلات، تسويق، وكيل ذكاء اصطناعي، حملات، أسعار، عروض، دليل هدايا. ولا أي عملية كتابة إلى Salla.

---

## 1. قرار وضع OAuth (Easy Mode مقابل Custom Mode)

| البند | Easy Mode | Custom Mode |
|---|---|---|
| كيف تُستلم الرموز | Webhook `app.store.authorize` بعد التثبيت | Redirect إلى callback يحمل `code`، ثم تبادل عبر `/oauth2/token` |
| هل يوجد callback | **لا** | نعم، رابط مسجّل مسبقًا |
| ما تقوله الوثائق | «الطريقة الوحيدة المسموح بها للتطبيقات المنشورة» | «يمكنك تنفيذها لأغراض الاختبار فقط» |
| الاستخدام في هذا المشروع | هدف الإنتاج عند النشر في App Store | المنفّذ الآن (Phase 03) |

**القرار (ADR-034):**

1. **الآن / التطوير والاختبار:** Custom Mode + `state` + callback. هو المسار الوحيد القابل للتحقق آليًا ضمن حدود المرحلة.
2. **الإنتاج:** Easy Mode إلزامي عند النشر. لا ندّعي أنه منفّذ: عند `SALLA_OAUTH_MODE=easy` يعيد `/api/health` القيمة `oauthImplemented=false`، وتُظهر بطاقة الربط تنبيهًا بدل زر غير عامل.
3. **المعمارية محصّنة ضد الترقية:** الـ callback ليس جزءًا من نموذج البيانات. كل ما يلزم لتخزين اتصال هو `TokenSet + MerchantIdentity`، ويُستهلك عبر `saveAuthorizedConnection()` نفسها التي سيستدعيها معالج Webhook لاحقًا. لذلك الانتقال إلى Easy Mode = إضافة مسار استقبال، لا إعادة بناء.

**لماذا لا Easy Mode الآن؟** لأنه يستلزم بناء استقبال Webhook والتحقق من التوقيع ومكافحة التكرار — وهو ما تمنعه تعليمات المرحلة صراحةً ("إذا تطلّب Easy Mode حدث Webhook، نفّذ الحد الأدنى فقط وأوثّق الاعتماد").

**القيود المترتبة على الإنتاج (موثّقة ولا تُخفى):** مع Easy Mode لا يُستهلك `state` ولا callback؛ تُستبدل بحماية Webhook (توقيع + منع تكرار). ولهذا وُضع نموذج الاتصال بحيث لا يعتمد على أي منهما في طبقة التخزين.

---

## 2. المراجع الرسمية

كل حقيقة في هذه المرحلة مسجّلة في `docs/salla-reference.md` §8 بصيغة **Claim / Source / URL / Verified At / Implementation Impact**، والتعارضات في §9. الجدول التالي ملخّص للمراجع المستخدمة:

| المرجع | ما أُخذ منه | تاريخ التحقق |
|---|---|---|
| [Authorization — Salla OAuth 2.0](https://docs.salla.dev/doc-421118) | الروابط، المعاملات، Easy/Custom، 14 يومًا/شهر، `offline_access`، قواعد التجديد | 2026-10-22 |
| [App Events](https://docs.salla.dev/421413m0) | حمولة `app.store.authorize` (للمسار المستقبلي) | 2026-10-22 |
| [User Information Details](https://docs.salla.dev/merchants/user-info) | `data.merchant.id` وهوية المفوِّض | 2026-10-22 |
| [Store Information](https://docs.salla.dev/merchants/store-info) | `data.id` وبيانات المتجر (غير مستخدمة في هذه المرحلة) | 2026-10-22 |
| [Responses](https://docs.salla.dev/responses) | شكل `invalid_grant` | 2026-10-22 |
| [Rate Limiting](https://docs.salla.dev/rate-limiting) | حدود الخطة (سياق لاحق) | 2026-10-22 |
| [SallaApp/oauth2-merchant](https://github.com/SallaApp/oauth2-merchant) | دليل ثانوي على ترميز جسم طلب الرمز | 2026-10-22 |

**ما لم يُتحقق منه ولم يُستخدم:** لا نعرف من الوثائق المقروءة هيكل استجابة `/oauth2/token` الكامل (حقول إضافية محتملة)؛ لذلك نقرأ الحقول الموثّقة فقط ونتجاهل غيرها (`passthrough`) بدل رفض الاستجابة. ولا نعرف سلوك `scope` عند الرفض الجزئي؛ نُخزّن ما تعيده Salla فعلًا.

---

## 3. نطاق الصلاحيات (Scopes)

```ts
export const SALLA_REQUIRED_SCOPES = ["offline_access"] as const;
```

- `offline_access` مطلوب وموثّق للحصول على refresh token، وهو **الشرط الوحيد**.
- هوية المتجر تأتي من `GET /oauth2/user/info`، ولا تحتاج سكوبًا إضافيًا حسب صفحتها الرسمية.
- لا `settings.read` ولا `products.read` ولا `webhooks.read_write` "للاحقًا". كل سكوب إضافي يوسّع الثقة بلا حاجة الآن.
- ما تُعيده Salla يُطبَّع ويُخزَّن في `store_connections.scopes` كما هو، ويُعرض في الواجهة كملخّص شفاف.

---

## 4. دورة حياة الرمز

| الخاصية | القيمة | المصدر |
|---|---|---|
| Access token | 14 يومًا | Authorization |
| Refresh token | شهر واحد (نافذة التجديد) | Get Started |
| Refresh token | **أحادي الاستخدام + تدوير إجباري** | Authorization |
| إعادة استخدام refresh | إبطال المنحة وكل access tokens المشتقة، ثم إعادة تثبيت التطبيق | Authorization |
| خطأ دائم | HTTP 401 + `{"error":"invalid_grant"}` | Responses |

**التجديد الاستباقي:** يُعتبر الرمز غير صالح إذا بقي أقل من **60 ثانية** على انتهائه (`ACCESS_TOKEN_SKEW_MS`).

**تفسير الانتهاء:** نقبل `expires_in` (ثوانٍ من الآن) و`expires` (Unix seconds)، مع تحمّل المللي ثانية، ونرجع إلى 14 يومًا الموثّقة عند غياب الاثنين. القاعدة في `src/modules/integrations/salla/domain/tokens.ts` ومغطّاة باختبارات.

---

## 5. تخزين الرموز والتشفير

### 5.1 المخطط

| العمود | الغرض |
|---|---|
| `access_token_ciphertext` | رمز الوصول مشفّرًا |
| `refresh_token_ciphertext` | رمز التجديد مشفّرًا (قد يكون `null` نظريًا فقط) |
| `access_token_expires_at` / `refresh_token_expires_at` | حساب التجديد بلا فك تشفير |
| `token_version` | كشف التجديد المتزامن |
| `last_refresh_at` | تشخيص/تدقيق |

**لا يوجد أي عمود نصّي للرمز**، ولا أثر للرمز في `stores` ولا في `audit_logs`.

### 5.2 الخوارزمية

- **AES-256-GCM**، مفتاح 32 بايت من `ENCRYPTION_KEY` (64 حرفًا hex).
- **IV عشوائي 12 بايت لكل قيمة**، ووسم مصادقة 16 بايت.
- **AAD** = `provider=salla;org=<uuid>;store=<uuid>` — نسخ صف إلى مستأجر آخر يجعل فك التشفير يفشل.
- الصيغة `v1.<iv>.<tag>.<ciphertext>` بترميز base64url.
- لا مفتاح افتراضي ولا اشتقاق ضعيف: غياب `ENCRYPTION_KEY` = `CONFIG_INVALID` صريح.
- أي فشل تحقق (تلاعب، مفتاح خاطئ، AAD خاطئ) يُترجم إلى خطأ داخلي بلا صدى للقيمة.

### 5.3 ما لا يُخزَّن

- `authorization code` — يُستهلك داخل الطلب فقط، ولا يُحفظ ولا يُسجَّل.
- `client_secret` — بيئة الخادم فقط؛ لا يُرسَل إلى المتصفح ولا يظهر في أي استجابة.
- أي جسم استجابة خام من Salla.

---

## 6. حالة OAuth (`state`)

| الخاصية | التنفيذ |
|---|---|
| العشوائية | 32 بايت من `crypto.randomBytes` ⇒ 256 بت |
| الشكل | base64url، 43 حرفًا |
| التخزين | HMAC-SHA256 فقط في `oauth_states.state_hash` (فريد) |
| الصلاحية | 10 دقائق (`expires_at`) |
| الربط | `user_id` + `organization_id` + `store_id` + `provider` |
| الاستخدام | مرة واحدة عبر `UPDATE … WHERE used_at IS NULL` (ذرّي) |
| الإبطال | بدء ربط جديد يُبطل أي state معلّق لنفس المتجر |

**سلسلة التحقق في الـ callback (بالترتيب):**

1. وجود `state` وشكله.
2. جلسة قائمة (وإلا تحويل إلى `/login` مع `next`، والـ state يبقى غير مستهلك).
3. البحث عن الحالة بـ HMAC فقط — سياسة RLS لا تُظهر إلا الصف المطابق للـ hash.
4. `used_at` ⇒ `state_replayed`.
5. `expires_at` ⇒ `state_expired`.
6. `user_id` يجب أن يطابق صاحب الجلسة ⇒ `session_mismatch`.
7. استهلاك ذرّي (`used_at` يُضبط مرة واحدة).
8. عضوية نشطة + صلاحية `store:connect` ⇒ `not_member` / `forbidden`.
9. المتجر موجود وداخل نفس المؤسسة.

لا يوجد أي `if (state exists)`؛ كل خطوة صريحة ومغطّاة باختبار.

---

## 7. قفل التجديد (Single-Flight)

```
getAccessToken()
 ├─ رمز صالح؟ → فك تشفير وإرجاع (بلا شبكة)
 ├─ لا refresh token / منتهٍ؟ → reauth_required
 ├─ محاولة الحصول على lease: UPDATE … SET refresh_lock_id=$1, refresh_lock_expires_at=now()+30s
 │    WHERE id=$2 AND (refresh_lock_id IS NULL OR refresh_lock_expires_at < now())
 ├─ فشل؟ → انتظار 100ms (حتى 5 ثوانٍ) ثم فحص: هل تجدّد الرمز؟ ارجعه
 ├─ إعادة قراءة الصف بعد القفل (token_version تغيّر؟ ⇒ لا تجديد)
 ├─ فك تشفير refresh ⇒ نداء واحد إلى /oauth2/token
 ├─ حفظ الزوج الجديد WHERE refresh_lock_id=$lock AND token_version=$expected
 └─ تحرير القفل (أو يتحرر تلقائيًا بعد 30 ثانية)
```

- **لا يمكن نداءان متزامنان** لأن الـ lease في قاعدة البيانات، لا في ذاكرة العملية.
- **لا إعادة استخدام** لأن كل نجاح يخزّن الـ refresh الجديد ويرفع `token_version`.
- **لا إعادة محاولة عمياء** على `POST /oauth2/token`؛ أي فشل شبكي يترك الرموز كما هي ويحرر القفل.
- الاختبار يثبت: 10 طلبات متزامنة ⇒ **نداء تجديد واحد**، وكل الطلبات تُرجع نفس الرمز، والموجة التالية لا تُجدد مرة أخرى.

### 7.1 تصنيف الفشل

| النوع | الأمثلة | السلوك |
|---|---|---|
| مؤقت | انقطاع شبكة، 5xx، 429 | الحالة تبقى `connected`، الرموز محفوظة، خطأ قابل لإعادة المحاولة، `last_error_code` يوثّق السبب |
| دائم | `invalid_grant`, انتهاء refresh, إلغاء التثبيت, بيانات عميل خاطئة | الحالة `reauth_required`، **مسح الرموز**، لا محاولات لاحقة، تدقيق `salla.token.refresh_failed` |

---

## 8. حالات الاتصال

| الحالة | المعنى | ما تراه الواجهة |
|---|---|---|
| `authorizing` | بدأ التفويض ولم يعد بعد | بانتظار تفويض Salla |
| `connected` | رموز صالحة وهوية متجر مؤكدة | متصل (+ تاريخ، سكوبات) |
| `refreshing` | تجديد جارٍ (نافذة قصيرة) | جارٍ تحديث الرمز |
| `reauth_required` | رفض دائم من Salla | يتطلب إعادة تفويض + زر إعادة الربط |
| `revoked` | أُبطل من مزوّد/إدارة (محجوز) | ملغى |
| `error` | فشل تفويض أولي | خطأ في الاتصال |
| `disconnected` | فصل محلي ومسح رموز | غير متصل + زر ربط |

`stores.status` يبقى انعكاسًا مشتقًا فقط (`connected` / `not_connected`) ولا يحمل أسرارًا.

---

## 9. نموذج البيانات والهجرات

### 9.1 `store_connections`

- `id`, `organization_id`, `store_id`, `provider`, `status`.
- الهوية الخارجية: `external_store_id` (من `merchant.id`)، `external_user_id` (من `data.id` — المفوِّض، قد يكون عضو فريق)، `external_store_name`.
- `scopes text[]`، `access_token_ciphertext`, `refresh_token_ciphertext`.
- `access_token_expires_at`, `refresh_token_expires_at`, `token_version`, `connected_at`, `last_refresh_at`, `revoked_at`, `last_error_code`.
- القفل: `refresh_lock_id`, `refresh_lock_expires_at`.
- القيود:
  - `UNIQUE (store_id, provider)` — اتصال واحد لكل متجر داخلي.
  - `UNIQUE (provider, external_store_id) WHERE external_store_id IS NOT NULL` — لا يُربط متجر Salla واحد بمتجرين داخليين.
  - فهارس على `(organization_id, status)` و`access_token_expires_at`.

### 9.2 `oauth_states`

`state_hash` (فريد)، `user_id`, `organization_id`, `store_id`, `provider`, `expires_at`, `used_at`, `created_at`.

### 9.3 الهجرات

| الملف | المحتوى |
|---|---|
| `0002_store_connections.sql` | نوعا enum، الجدولان، الفهارس، إسقاط `stores.external_store_id` |
| `0003_salla_rls.sql` | RLS + `FORCE` على الجدولين، وسياسات القراءة/الكتابة، ودالة `app.current_oauth_state_hash()` |

- **تُطبَّق من قاعدة فارغة** في كل تشغيل لاختبارات التكامل (global setup يعيد إنشاء القاعدة ثم يشغّل الهجرات).
- حذف `stores.external_store_id` آمن لأنه لم يُكتب فيه أي صف في Phase 02 (كان احتياطًا مصرّحًا به). لا توجد بيانات إنتاج بعد؛ ولأي بيئة لاحقة تُنقل القيم إلى `store_connections` قبل الحذف.
- سياسة الهجرة إلى الأمام: كل تغيير لاحق = هجرة جديدة، ولا تُعدَّل هجرة مطبقة.

### 9.4 RLS للـ callback

الـ callback يحتاج قراءة state قبل معرفة المؤسسة. الحل: دالة `app.current_oauth_state_hash()` وسماح قراءة/تحديث **للصف المطابق للـ hash فقط**، ثم `bindOrganization()` من الصف نفسه قبل الاستهلاك. لا تُوسَّع السياسة لغير ذلك، ولا يُستخدم اتصال مالك القاعدة.

---

## 10. الواجهات (API)

| Method | المسار | الصلاحية | الوصف |
|---|---|---|---|
| `POST` | `/api/organizations/current/stores/{storeId}/salla/authorize` | `store:connect` + CSRF | ينشئ state/صف اتصال ويعيد `authorizationUrl` |
| `GET` | `/api/integrations/salla/callback` | جلسة (غير إلزامية للتحويل) | يتحقق، يبادل، يشفّر، يخزّن، يحوّل |
| `GET` | `/api/organizations/current/stores/{storeId}/salla/connection` | عضو مؤسسة | حالة الاتصال الآمنة (بلا رموز) |
| `DELETE` | `/api/organizations/current/stores/{storeId}/salla/connection` | `store:disconnect` + CSRF | فصل محلي ومسح رموز |
| `GET` | `/api/organizations/current/stores/{storeId}` | عضو مؤسسة | سجل المتجر + ملخص الاتصال |
| `GET` | `/api/health` | عام | `configured`, `oauthMode`, `oauthImplemented` — بلا أسرار ولا بيانات مستأجر (ADR-037) |

**حدود المعدل:** بدء التفويض 10/ساعة لكل (مؤسسة، متجر) — حماية من توليد states بلا حدود.

**أخطاء الـ callback:** تُحوَّل دائمًا إلى `?salla_error=<reason>` برسالة عربية عامة. `error_description` القادم من Salla **لا يُعرض ولا يُسجَّل**.

---

## 11. الأمان

| التهديد | الدفاع |
|---|---|
| CSRF على بدء/فصل الربط | `assertCsrf` (Origin + double-submit) |
| تخمين state | 256 بت + HMAC + عمر 10 دقائق |
| إعادة استخدام state | استهلاك ذرّي + رفض `used_at IS NOT NULL` |
| سرقة state من قاعدة البيانات | لا يُخزَّن إلا HMAC |
| ربط حساب مهاجم بحساب الضحية | state مربوط بـ user + session + org + store |
| عبور المستأجرين | كل الاستعلامات داخل `withTenantTransaction` + RLS + 404 |
| تصعيد صلاحيات | `store:connect`/`store:disconnect` تُفحص في الخادم، وViewer ممنوع (اختبار) |
| رابط callback مفتوح | لا يبدأ أي شيء بلا state صالح لجلسة قائمة |
| تزوير رد Salla | TLS + التحقق من المخطط (`zod`) + رفض `redirect: "error"` |
| تسريب الرموز في السجلات | لا تُسجَّل أبدًا؛ `redact` طبقة ثانية؛ الاختبارات تفتش سجلات التدقيق والاستجابات |
| إعادة تشغيل التشفير | AAD يربط الصف بالمستأجر؛ تغيير متجر ⇒ فشل فك التشفير |
| تجديد متوازٍ | lease في قاعدة البيانات + `token_version` |

**حدود معروفة:** لا يوجد تدوير تلقائي لمفتاح `ENCRYPTION_KEY` (موثّق كمهمة مستقبلية)، ولا `keychain`/KMS في هذه المرحلة.

---

## 12. الاختبارات

### 12.1 الوحدة (42 اختبارًا جديدًا)

- `crypto.test.ts` — round-trip، nonce فريد، تلاعب، تبديل tag، AAD لمستأجر آخر، مفتاح خاطئ، صيغ تالفة، مفتاح غير صالح، رفض الفارغ.
- `tokens.test.ts` — `expires_in`/`expires`/مللي ثانية/fallback 14 يومًا، نافذة الانحراف، صلاحية الحالات.
- `state.test.ts` — العشوائية، HMAC الحتمي، سر مختلف، مقارنة زمنية آمنة، الانتهاء، رفض القيم التالفة.
- `scopes.test.ts` — الفاصلان، إزالة التكرار، `offline_access` فقط، التسلسل.
- `config.test.ts` — غير مهيأ، الوضع الافتراضي custom، Easy Mode غير منفّذ، تجاوزات التطوير، فرض مضيفي Salla في الإنتاج، رفض redirect غير مسجّل، عدم تسريب الأسرار في health.

### 12.2 التكامل (32 اختبارًا على PostgreSQL حقيقي)

`src/test/integration/salla.integration.test.ts` (25): بدء التفويض (المعاملات، السكوب، عدم وجود السر في الرابط)، صف `authorizing`، تدقيق بلا أسرار، منع Viewer، 404 عبر المستأجرين، عدم التهيئة، نجاح الربط والتحقق من التشفير وAAD وتحديث `stores`، عدم وجود أي رمز/code في الاستجابة، replay، انتهاء، جلسة أخرى، state مزوّر، رفض المزوّد، code مفقود، `invalid_grant`، callback بلا جلسة ثم إكمال، إعادة استخدام code، منع متجرين، إعادة الربط بلا تكرار، الفصل ومسح الرموز، منع Viewer من الفصل، إخفاء اتصال مستأجر آخر، منع `Host` مزوّر من تحويل الـ callback، سماح Admin بالربط، وصدق `/api/health`.

`src/test/integration/salla-token.integration.test.ts` (7): بلا تجديد عند الصلاحية، تجديد واحد وتخزين الزوج المدوّر، **10 متزامنة ⇒ تجديد واحد**، `invalid_grant` ⇒ `reauth_required` وتوقف النداءات، فشل الشبكة يحفظ الاتصال والرموز ثم يتعافى، لا رمز في التدقيق/الأعمدة، رفض الاتصال المفصول.

### 12.3 المحاكي

`src/test/integration/mock-salla-server.ts` — خادم HTTP محلي يطبّق: `application/x-www-form-urlencoded`، `invalid_client`، `invalid_grant`، تدوير refresh واكتشاف إعادة الاستخدام، `user/info` بهوية `merchant.id`. **لا تتصل أي اختبار بـ Salla أو بالمتجر الحقيقي**؛ وفي الإنتاج تُفرض مضيفات Salla الرسمية وتُتجاهل تجاوزات البيئة.

---

## 13. متغيّرات البيئة

| المتغيّر | إلزامي | ملاحظات |
|---|---|---|
| `ENCRYPTION_KEY` | من Phase 02 (يُستخدم فعليًا الآن) | 64 hex = 32 بايت، بلا قيمة افتراضية |
| `SALLA_CLIENT_ID` | Phase 03 | من بوابة Salla Partners |
| `SALLA_CLIENT_SECRET` | Phase 03 | خادم فقط |
| `SALLA_REDIRECT_URI` | Phase 03 | يجب أن يطابق المسجّل تمامًا |
| `SALLA_OAUTH_MODE` | اختياري (`custom` افتراضي) | `easy` يُعلن كغير منفّذ |
| `SALLA_AUTH_URL`, `SALLA_TOKEN_URL`, `SALLA_USERINFO_URL` | تطوير/اختبار فقط | تُتجاهل إجباريًا في `NODE_ENV=production` |

في الإنتاج: يرفض التحميل أي `SALLA_REDIRECT_URI` غير `https` أو لا يطابق `/api/integrations/salla/callback` على نفس مضيف `APP_URL`.

---

## 14. الصلاحيات وأحداث التدقيق

- `store:connect` — Owner/Admin فقط (Viewer/Analyst/Manager ممنوعون، بحسب مصفوفة Phase 02).
- `store:disconnect` — Owner/Admin فقط.
- الأحداث: `salla.authorization.started|succeeded|failed`، `salla.connection.created|updated|disconnected`، `salla.token.refreshed`، `salla.token.refresh_failed`.
- كل حدث يُسجَّل عبر `recordAudit` داخل نفس المعاملة، والـ metadata تحتوي معرّفات وسببًا/سكوبات فقط — لا رموز ولا أكواد ولا `client_secret`.

---

## 15. الواجهة

- بطاقة «ربط Salla» داخل `/app/stores/[storeId]` فقط: الحالة، معرّف Salla، الاسم، تاريخ الربط، انتهاء الوصول، ملخص السكوبات.
- أزرار: «ربط Salla» / «إعادة الربط» / «فصل الربط» حسب الحالة والصلاحية.
- رسائل الفشل عربية عامة (`callbackReasonToMessage`)، والتفاصيل التقنية تبقى في الخادم.
- تنبيه صريح: **فصل الربط لا يزيل التطبيق من متجر Salla** — يمسح بيانات الاعتماد من خوادمنا فقط.
- لا تُعرض أي رموز أو أجزاء منها، ولا أسرار، ولا بيانات أعمال.

---

## 16. القيود المعروفة

1. **Easy Mode غير منفّذ:** النشر في App Store يتطلب استقبال `app.store.authorize`. مُوثَّق كاعتماد، ومحجوز لمرحلة Webhooks.
2. **لا اختبار حقيقي مع Salla:** لا توجد مفاتيح تطبيق ولا Demo Store في هذه البيئة. الاختبارات بروتوكولية ضد محاكي. لذلك: *"OAuth implementation is ready and protocol-tested, but live Salla authorization remains unverified."*
3. **لا تدوير لمفتاح التشفير:** تغيير `ENCRYPTION_KEY` يتطلب إعادة ربط المتاجر (أو مهمة إعادة تشفير) — لم تُبنَ عمدًا.
4. **حالة `revoked` محجوزة:** لا مسار يضبطها اليوم؛ تُضبط عند بناء استقبال إلغاء التثبيت.
5. **`/store/info` غير مستخدم:** الهوية من `user/info` وحدها، لأنها كافية وموثّقة.
6. **حدود المعدل في الذاكرة** (كما في Phase 02)؛ تجديد الرموز لا يمر بها أصلًا.
7. **لا واجهة لإعادة المحاولة اليدوية للتجديد:** أي محاولة قراءة لاحقة في مرحلة تالية ستُطلق التجديد تلقائيًا.

---

## 17. جاهزية Phase 04

- `getAccessToken(organizationId, connectionId)` هي البوابة الوحيدة لأي نداء Merchant API لاحق؛ لا كود خارجها يلمس الرموز.
- `store_connections.external_store_id` هو المفتاح الذي ستُربط به بيانات Salla في المراحل القادمة.
- `SallaRateLimitError` و`SallaInvalidResponseError` (بصيغة `sallaKind`) جاهزتان لطبقة API القراءة.
- ما يجب إضافته في Phase 04: عميل قراءة للمنتجات/التصنيفات فقط عند الموافقة، مع تسجيل كل Endpoint في `docs/salla-reference.md` §2 قبل الاستخدام.

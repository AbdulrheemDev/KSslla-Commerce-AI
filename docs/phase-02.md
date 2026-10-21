# Phase 02 — Authentication + Multi-Tenancy

> **الحالة:** منفّذة تقنيًا وبانتظار مراجعة المالك (2026-10-21).  
> **الهدف:** هوية آمنة، مؤسسات، أدوار، وعزل بيانات مثبت بالاختبارات على PostgreSQL حقيقي.  
> **خارج النطاق:** Salla OAuth، أي اتصال بمتجر، أي بيانات تجارية، AI، Dashboard كاملة.

---

## 1. المخرجات

1. PostgreSQL + Drizzle + أولى الهجرات.
2. تسجيل/دخول/خروج بجلسات قابلة للإبطال.
3. إنشاء مؤسسة + دعوات + أدوار.
4. `TenantContext` مركزي + RLS على الجداول المؤسسية.
5. واجهة محمية بسيطة (RTL) + هيكل تطبيق فارغ.
6. اختبارات وحدة + تكامل + أمن.
7. تحديث الوثائق وADRs عند أي انحراف عن الخطة.

---

## 2. نموذج البيانات الأولي

### 2.1 الجداول

#### `users`

| العمود | النوع | ملاحظات |
|---|---|---|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `email` | `citext` / `text` | فريد، مُطبَّع lowercase |
| `name` | `text` | إلزامي، 1–120 |
| `password_hash` | `text` | `scrypt$N$r$p$salt$hash` |
| `email_verified_at` | `timestamptz` | مطلوب قبل ربط متجر |
| `status` | enum | `active`, `suspended`, `deleted` |
| `created_at` / `updated_at` | `timestamptz` | UTC |
| `last_login_at` | `timestamptz` | nullable |

#### `organizations`

| العمود | النوع | ملاحظات |
|---|---|---|
| `id` | `uuid` PK | |
| `name` | `text` | 1–120 |
| `slug` | `text` | فريد، للاستخدام المستقبلي |
| `created_by` | `uuid` FK users | |
| `created_at` / `updated_at` | `timestamptz` | |

#### `organization_members`

| العمود | النوع | ملاحظات |
|---|---|---|
| `id` | `uuid` PK | |
| `organization_id` | `uuid` FK | |
| `user_id` | `uuid` FK | |
| `role` | enum | `owner`, `admin`, `manager`, `analyst`, `viewer` |
| `status` | enum | `active`, `invited`, `removed` |
| `created_at` | `timestamptz` | |
| — | unique | `(organization_id, user_id)` |
| — | partial unique | مالك نشط واحد على الأقل: `unique (organization_id) where role='owner' and status='active'` |

#### `invitations`

| العمود | النوع | ملاحظات |
|---|---|---|
| `id` | `uuid` PK | |
| `organization_id` | `uuid` FK | |
| `email` | `citext` | |
| `role` | enum | لا يمكن دعوة `owner` مباشرة |
| `token_hash` | `text` | HMAC-SHA256(token, `AUTH_SECRET`) |
| `expires_at` | `timestamptz` | 7 أيام |
| `accepted_at` | `timestamptz` | nullable |
| `invited_by` | `uuid` FK | |
| `created_at` | `timestamptz` | |

#### `stores`

| العمود | النوع | ملاحظات |
|---|---|---|
| `id` | `uuid` PK | **المعرّف الداخلي الوحيد** |
| `organization_id` | `uuid` FK | |
| `name` | `text` | يبدأ فارغًا؛ يُملأ من Salla في Phase 03 |
| `platform` | enum | `salla` (قابل للتوسع) |
| `external_store_id` | `text` | nullable حتى الربط |
| `currency` | `text` | nullable |
| `status` | enum | `pending_connection`, `connected`, `disconnected` |
| `created_at` / `updated_at` | `timestamptz` | |
| — | unique | `(platform, external_store_id)` where not null |
| — | unique | `(organization_id, id)` لدعم FKs المركّبة لاحقًا |

#### `sessions`

| العمود | النوع | ملاحظات |
|---|---|---|
| `id` | `uuid` PK | |
| `user_id` | `uuid` FK | |
| `token_hash` | `text` unique | HMAC-SHA256(token, `AUTH_SECRET`) |
| `active_organization_id` | `uuid` | nullable |
| `expires_at` | `timestamptz` | خمول 7 أيام |
| `absolute_expires_at` | `timestamptz` | 30 يومًا |
| `last_used_at` | `timestamptz` | تحديث مخفّف |
| `revoked_at` | `timestamptz` | nullable |
| `ip_hash` / `user_agent` | `text` | IP مجزّأ، UA مختصر |
| `created_at` | `timestamptz` | |

#### `audit_logs`

| العمود | النوع | ملاحظات |
|---|---|---|
| `id` | `uuid` PK | |
| `organization_id` | `uuid` | nullable لعمليات الحساب |
| `actor_user_id` | `uuid` | nullable |
| `action` | `text` | مثل `auth.login.success` |
| `entity_type` / `entity_id` | `text` | |
| `metadata` | `jsonb` | بلا أسرار أو PII كاملة |
| `request_id` | `text` | |
| `ip_hash` | `text` | |
| `created_at` | `timestamptz` | |

> **Append-only**: لا `UPDATE`/`DELETE` من التطبيق. تُمنح صلاحية insert/select فقط لدور التطبيق في الإنتاج.

### 2.2 ما لا يُنشأ الآن

`products`, `orders`, `customers`, `salla_connections`, `oauth_tokens`, `webhook_events`, `recommendations`, وغيرها. تُضاف في مراحلها.

---

## 3. المصادقة

### 3.1 كلمة المرور

- الحد الأدنى 12 حرفًا، الأقصى 128، بلا قيود تعقيد مسيئة.
- `scrypt` من Node:
  - `N=16384`, `r=8`, `p=1`, `keylen=64`, salt 16 بايت.
  - `maxmem=64MB`.
  - معايرة زمن التحقق المستهدف 100–250ms على بيئة الإنتاج.
- تُخزَّن بالصيغة `scrypt$N$r$p$salt_base64$hash_base64`، مع التحقق من المعاملات عند القراءة لدعم الترقية.
- مقارنة `timingSafeEqual`.
- لا تسجيل لكلمة المرور أو الـ hash.

### 3.2 الجلسة

- Token عشوائي 32 بايت (base64url).
- يُخزَّن **HMAC-SHA256(token, AUTH_SECRET)** فقط في القاعدة.
- الكوكي: `__Host-ksh_session`؛ `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`؛ بلا `Domain`.
- خمول 7 أيام، حد أقصى 30 يومًا.
- تدوير عند تسجيل الدخول وعند تغيير كلمة المرور/الأدوار.
- إبطال فوري (logout، logout-all، تعليق الحساب).
- فحص `Origin` على POST cookie-authenticated.

### 3.3 تدفقات

| التدفق | الخطوات |
|---|---|
| Signup | تحقق Zod → تطبيع البريد → فحص التكرار (رسالة عامة) → hash → إنشاء user + org + membership(owner) في معاملة واحدة |
| Login | rate limit → جلب user → scrypt verify → إنشاء session → set cookie → audit |
| Logout | إبطال session الحالية + حذف cookie |
| Logout all | إبطال كل جلسات المستخدم |
| Switch org | التحقق من العضوية النشطة → تحديث `active_organization_id` |
| Invite | عضوية admin+ → token عشوائي → تخزين hash → بريد (عبر port) |
| Accept invite | token → hash → فحص الصلاحية/الانتهاء → إنشاء membership |

### 3.4 إرسال البريد

- Port: `EmailSender`.
- Phase 02: `ConsoleEmailSender` مسموح في `development`/`test` فقط، ويفشل في الإنتاج.
- المزوّد الحقيقي يُختار قبل الإنتاج (Phase 25). لا أسرار بريد الآن.

### 3.5 Rate limiting

- تسجيل الدخول: 10 محاولات/15 دقيقة لكل IP، و5 لكل حساب.
- Signup: 5/ساعة لكل IP.
- Invitations: 20/ساعة لكل مؤسسة.
- In-memory الآن (مبرر: نشر واحد)، مع port `RateLimiter` للتبديل إلى Redis/Postgres في Phase 06.
- لا كشف لوجود الحساب (نفس الرسالة والزمن تقريبًا).

---

## 4. التفويض والأدوار

### 4.1 الصلاحيات

```text
store:read          store:connect        store:disconnect
member:read         member:invite        member:remove
role:update         audit:read
recommendation:read recommendation:decide
action:approve:low  action:approve:high
billing:manage
```

### 4.2 المصفوفة

| الصلاحية | Owner | Admin | Manager | Analyst | Viewer |
|---|:--:|:--:|:--:|:--:|:--:|
| `store:read` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `store:connect` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `store:disconnect` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `member:read` | ✅ | ✅ | ✅ | ❌ | ❌ |
| `member:invite` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `member:remove` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `role:update` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `audit:read` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `recommendation:read` | ✅ | ✅ | ✅ | ✅ | ❌ |
| `recommendation:decide` | ✅ | ✅ | ✅ | ❌ | ❌ |
| `action:approve:low` | ✅ | ✅ | ✅ | ❌ | ❌ |
| `action:approve:high` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `billing:manage` | ✅ | ❌ | ❌ | ❌ | ❌ |

### 4.3 قواعد

- لا يمكن إزالة آخر Owner.
- لا يمكن ترقية عضو إلى Owner عبر الدعوة؛ نقل الملكية عملية صريحة منفصلة.
- المدير لا يمنح صلاحيات كتابة عالية.
- الفحص داخل use case، لا middleware فقط.

---

## 5. سياق المستأجر وRLS

### 5.1 النوع

```ts
interface TenantContext {
  userId: string;
  organizationId: string;
  storeId?: string;   // عند العمل على متجر محدد
  role: MembershipRole;
  requestId: string;
}
```

### 5.2 الخوارزمية

```text
session cookie
  → hash token
  → load session (unexpired, not revoked)
  → load user (active)
  → load memberships (active)
  → choose active organization (session value or first)
  → if requested store: verify it belongs to organization
  → build TenantContext
  → begin transaction + SET LOCAL app.current_user / app.current_org
  → execute use case
```

### 5.3 سياسات RLS (Phase 02)

تُفعَّل على: `organization_members`, `stores`, `invitations`, `audit_logs`.

```sql
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;

CREATE POLICY stores_isolation ON stores
USING (organization_id = nullif(current_setting('app.current_org', true), '')::uuid)
WITH CHECK (organization_id = nullif(current_setting('app.current_org', true), '')::uuid);
```

- `current_setting(..., true)` يمنع الخطأ عند غياب السياق، لكن السياسة تصبح false.
- `users` و`sessions` تُدار عبر repository محصور قبل وجود السياق؛ **تُستثنى من RLS الآن** وتُشدَّد في Phase 24 بأدوار قاعدة بيانات منفصلة.
- اختبار RLS إلزامي: اتصالان بسياقين مختلفين، ومحاولة قراءة/كتابة عابرة.

### 5.4 الثوابت

- كل repository method لمستأجر تستقبل `organizationId`/`storeId` إلزاميًا.
- لا `findById(id)` بلا سياق.
- لا كاش عابر.
- لا `store_id` من العميل كدليل صلاحية.

---

## 6. الواجهات

### 6.1 Route Handlers

| Method | المسار | الوصف |
|---|---|---|
| POST | `/api/auth/signup` | حساب + مؤسسة أولية |
| POST | `/api/auth/login` | جلسة |
| POST | `/api/auth/logout` | إبطال |
| POST | `/api/auth/logout-all` | إبطال الكل |
| GET | `/api/me` | المستخدم + العضويات + المؤسسة النشطة |
| POST | `/api/session/organization` | تبديل المؤسسة |
| GET | `/api/organizations/:id/members` | قائمة الأعضاء |
| POST | `/api/organizations/:id/invitations` | دعوة |
| POST | `/api/invitations/accept` | قبول دعوة |
| PATCH | `/api/organizations/:id/members/:memberId` | تغيير دور |
| DELETE | `/api/organizations/:id/members/:memberId` | إزالة عضو |
| GET | `/api/health` | موسّع: db + migrations |

### 6.2 الصفحات

- `/login`, `/signup`
- `/onboarding` — إنشاء مؤسسة (أو دعوة)
- `/app` — هيكل محمي بحالة فارغة صادقة («لا يوجد متجر مربوط بعد»)
- `/app/settings/members` — إدارة الأعضاء
- `/invite/[token]` — قبول دعوة

### 6.3 الحماية

- Middleware يفحص **وجود** الكوكي فقط (توجيه)، والتحقق الحقيقي في server components/use cases.
- لا تُعرض بيانات مؤسسة قبل التحقق من العضوية.
- صفحات `noindex`.

---

## 7. التحقق من المدخلات

- Zod لكل body/query/params.
- تطبيع البريد lowercase + trim.
- كلمة المرور: 12–128، لا تُقطع.
- رسائل الأخطاء عامة عند تسجيل الدخول/التسجيل.
- حد حجم الطلب (Phase 24 إن لم يتوفر الآن).
- لا تسجيل لأي جسم طلب يحتوي كلمة مرور.

---

## 8. سجل التدقيق

أحداث Phase 02:

```text
auth.signup            auth.login.success     auth.login.failure
auth.logout            auth.logout_all        session.rotated
org.created            org.updated
member.invited         member.joined          member.removed
role.changed           invitation.revoked
```

خصائص: actor، org، request_id، IP مجزّأ، metadata محدودة. فشل تسجيل الدخول يُسجَّل بلا بريد كامل (hash/كود).

---

## 9. الاختبارات

### 9.1 وحدة

- scrypt: hash/verify، معاملات خاطئة، salt مختلف.
- token: entropy/طول، hash ثابت، انتهاء.
- permission matrix: كل دور × كل صلاحية.
- tenant resolver: حالات (بلا جلسة، بلا عضوية، متجر خارج المؤسسة، دور منخفض).

### 9.2 تكامل

- signup → org → owner membership في معاملة واحدة.
- login/session/expiry/revocation.
- دعوات: صلاحية، انتهاء، استخدام مرة واحدة.
- قيود فريدة (بريد، عضوية، مالك واحد).
- RLS بسياقين.

### 9.3 أمن

| الاختبار | المتوقع |
|---|---|
| قراءة عضو من مؤسسة أخرى | 404 |
| تعديل دور في مؤسسة أخرى | 404 |
| استخدام `store_id` لمتجر آخر | 404 |
| POST بلا `Origin` صحيح | 403 |
| إعادة استخدام token جلسة ملغاة | 401 |
| تخمين كلمة المرور | rate limit + زمن ثابت نسبيًا |
| تعداد البريد | نفس الاستجابة |
| حقن SQL في الحقول | لا تأثير (parameterized) |
| XSS في الاسم | يُعرض كنص |

### 9.4 E2E (Playwright)

`signup → create org → invite → accept in second context → switch org → logout → login`.

---

## 10. متغيرات البيئة الجديدة

```bash
DATABASE_URL=postgresql://...
AUTH_SECRET=<openssl rand -base64 32>
```

`ENCRYPTION_KEY` يبقى اختياريًا حتى Phase 03.

---

## 11. الهجرات والتشغيل

- Drizzle Kit لتوليد SQL، ومراجعة كل migration يدويًا.
- سكربتات: `db:generate`, `db:migrate`, `db:studio` (تطوير فقط).
- **لا migration تلقائي عند الإقلاع.**
- Seeds تطوير فقط، ببيانات اصطناعية موسومة، وممنوعة في الإنتاج.
- نسخة احتياطية قبل أول migration إنتاجية.

---

## 12. ترتيب التنفيذ

1. إعداد Postgres محلي/CI + Drizzle + أول migration.
2. جداول `users`/`sessions` + scrypt + تسجيل/دخول.
3. `organizations`/`organization_members` + إنشاء مؤسسة.
4. `TenantContext` + حراسة المسارات + `/api/me`.
5. RLS + اختبارات العزل.
6. الدعوات + البريد (port).
7. إدارة الأعضاء/الأدوار + قواعد المالك.
8. سجل التدقيق.
9. واجهة محمية + هيكل التطبيق.
10. E2E + مراجعة أمنية + تحديث الوثائق.

---

## 13. معايير الخروج

- [ ] `npm run verify` ناجح (lint, typecheck, tests, secrets, build).
- [ ] جميع اختبارات العزل تمر.
- [ ] لا يمكن الوصول لأي كيان عبر مؤسسة أخرى.
- [ ] جلسة تُبطل فورًا، وتدور عند تغيير الصلاحيات.
- [ ] كلمات المرور/الجلسات لا تظهر في السجلات.
- [ ] RLS مفعّلة ومختبرة على الجداول المؤسسية.
- [ ] سجل تدقيق يحتوي الأحداث المحددة.
- [ ] لا اتصال Salla ولا بيانات تجارية.
- [ ] تحديث `decision`/`architecture` إن تغيّر شيء.

---

## 14. تقدير مبدئي

6–9 أيام عمل لمهندس واحد، دون احتساب وقت المراجعة/الاعتماد. التقدير غير ملزم.

---

## 15. مخاطر Phase 02

| الخطر | التخفيف |
|---|---|
| بناء مصادقة مخصّصة يخفي ثغرات | قائمة ASVS + اختبارات + مراجعة خارجية قبل الإنتاج |
| RLS تعطي ثقة زائفة | اختبارات اتصالين + repositories مقيدة |
| الدعوات تكشف البريد | رسائل عامة، تحديد معدل |
| فيضان جلسات/كتابات `last_used_at` | تحديث مخفّف (≤ كل 5 دقائق) |
| غياب بريد حقيقي | port + قناة تطوير فقط، والإنتاج لاحقًا |
| انحراف عن Phase 01 | أي تغيير معماري يحتاج ADR |

---

## 16. ملاحظات التنفيذ الفعلية (2026-10-21)

ما بُني مطابق للخطة أعلاه إلا في النقاط التالية، وكل انحراف موثّق في `docs/decisions.md`:

| الموضوع | الخطة | التنفيذ | السبب |
|---|---|---|---|
| RLS | جداول مؤسسية | `organization_members`, `stores`, `invitations`, `audit_logs` فقط؛ `users`/`sessions` مؤجّلة | ADR-029: لا سياق مستأجر طبيعي لهما |
| حالة المتجر | `pending_connection` | `not_connected` | يطابق متطلبات Phase 02 الصريحة |
| الصلاحيات | 13 صلاحية | + `organization:read`, `organization:update` | الحاجة لقراءة/تحديث بيانات المؤسسة |
| CSRF | فحص Origin | Origin/Referer + double-submit token في كوكي `__Host-ksh_csrf` | ADR-031: دفاعان مستقلان |
| Rate limiting | port فقط | in-memory فعلي بحدود موثّقة | ADR-032: نشر أحادي قبل Phase 06 |
| إرسال الدعوة | `EmailSender` | رابط يظهر مرة واحدة للمالك | ADR-033: لا مزوّد بريد في النطاق |
| التحقق من البريد | مطلوب قبل ربط متجر | العمود موجود، التحقق غير منفّذ | يلزم في Phase 03 فقط |
| نقل الملكية | عملية صريحة منفصلة | غير منفّذ | خارج نطاق Phase 02 |
| آخر مالك | قيد unique جزئي | فحص تطبيقي بعد قفل صفوف المؤسسة + منع إزالة الذات | القيد الجزئي يمنع تعدّد الملاك |

**ملفات الهجرة:** `drizzle/0000_init.sql` (البنية) و`drizzle/0001_rls.sql` (السياسات، مكتوبة يدويًا).

**الاختبارات الفعلية:** 64 اختبار وحدة + 32 اختبار تكامل/أمن على PostgreSQL 18.4 (embedded محليًا، `postgres:16` في CI).

**ما لم يُبنَ عمدًا:** أي اتصال Salla، أي بيانات متجر، أي تحليلات أو توصيات.

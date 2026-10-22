"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { apiRequest } from "@/lib/client/api";

const inputClass =
  "w-full rounded-xl border border-line bg-canvas/60 px-3.5 py-2.5 text-[13px] text-ink outline-none transition-colors placeholder:text-muted/60 focus:border-gold/60";

const labelClass = "mb-1.5 block text-[12px] font-medium text-ink";
const hintClass = "mt-1 block text-[10.5px] leading-5 text-muted/80";

export function RegisterForm() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    organizationName: "",
    storeName: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function update(field: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setPending(true);
    setError(null);

    try {
      await apiRequest("/api/auth/register", {
        method: "POST",
        body: {
          name: form.name,
          email: form.email,
          password: form.password,
          organizationName: form.organizationName,
          ...(form.storeName.trim() ? { storeName: form.storeName.trim() } : {}),
        },
      });
      router.push("/onboarding");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذّر إنشاء الحساب.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div>
        <label htmlFor="register-name" className={labelClass}>
          الاسم
        </label>
        <input
          id="register-name"
          type="text"
          autoComplete="name"
          required
          maxLength={120}
          value={form.name}
          onChange={(event) => update("name", event.target.value)}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="register-email" className={labelClass}>
          البريد الإلكتروني
        </label>
        <input
          id="register-email"
          type="email"
          autoComplete="email"
          required
          dir="ltr"
          value={form.email}
          onChange={(event) => update("email", event.target.value)}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="register-password" className={labelClass}>
          كلمة المرور
        </label>
        <input
          id="register-password"
          type="password"
          autoComplete="new-password"
          required
          dir="ltr"
          minLength={12}
          maxLength={128}
          value={form.password}
          onChange={(event) => update("password", event.target.value)}
          className={inputClass}
        />
        <span className={hintClass}>12 حرفًا على الأقل. لا نطلب رموزًا أو أرقامًا إلزامية.</span>
      </div>

      <div>
        <label htmlFor="register-organization" className={labelClass}>
          اسم المؤسسة
        </label>
        <input
          id="register-organization"
          type="text"
          required
          maxLength={120}
          value={form.organizationName}
          onChange={(event) => update("organizationName", event.target.value)}
          className={inputClass}
        />
        <span className={hintClass}>ستكون مالكًا لهذه المؤسسة. يمكنك دعوة الفريق لاحقًا.</span>
      </div>

      <div>
        <label htmlFor="register-store" className={labelClass}>
          اسم المتجر داخليًا <span className="font-normal text-muted">(اختياري)</span>
        </label>
        <input
          id="register-store"
          type="text"
          maxLength={120}
          value={form.storeName}
          onChange={(event) => update("storeName", event.target.value)}
          className={inputClass}
        />
        <span className={hintClass}>
          سجل داخلي فقط. لا يتم الاتصال بـ Salla ولا تُجلب أي بيانات.
        </span>
      </div>

      {error ? (
        <p
          role="alert"
          aria-live="polite"
          className="rounded-xl border border-rose/30 bg-rose/10 px-3.5 py-2.5 text-[12px] leading-6 text-rose"
        >
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-xl bg-gold px-4 py-2.5 text-[13px] font-semibold text-canvas transition-colors hover:bg-gold-soft disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "جارٍ إنشاء الحساب…" : "إنشاء الحساب"}
      </button>
    </form>
  );
}

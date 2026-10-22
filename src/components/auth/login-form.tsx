"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { apiRequest } from "@/lib/client/api";

const inputClass =
  "w-full rounded-xl border border-line bg-canvas/60 px-3.5 py-2.5 text-[13px] text-ink outline-none transition-colors placeholder:text-muted/60 focus:border-gold/60";

const labelClass = "mb-1.5 block text-[12px] font-medium text-ink";

export function LoginForm({ nextPath }: { nextPath?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setPending(true);
    setError(null);

    try {
      await apiRequest("/api/auth/login", {
        method: "POST",
        body: { email, password },
      });
      const destination =
        nextPath && nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/app";
      router.push(destination);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذّر تسجيل الدخول.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div>
        <label htmlFor="login-email" className={labelClass}>
          البريد الإلكتروني
        </label>
        <input
          id="login-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          dir="ltr"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="login-password" className={labelClass}>
          كلمة المرور
        </label>
        <input
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          dir="ltr"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className={inputClass}
        />
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
        {pending ? "جارٍ تسجيل الدخول…" : "تسجيل الدخول"}
      </button>

      <p className="text-[11px] leading-6 text-muted">
        محاولات الدخول محدودة لحماية الحساب. إذا تجاوزت الحد، انتظر بضع دقائق ثم أعد المحاولة.
      </p>
    </form>
  );
}

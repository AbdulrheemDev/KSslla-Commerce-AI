"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { apiRequest } from "@/lib/client/api";

export function CreateStoreForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    setPending(true);
    setError(null);

    try {
      await apiRequest("/api/organizations/current/stores", {
        method: "POST",
        body: { name },
      });
      setName("");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذّر إنشاء المتجر.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
      <div>
        <label htmlFor="store-name" className="mb-1.5 block text-[12px] font-medium text-ink">
          اسم المتجر الداخلي
        </label>
        <input
          id="store-name"
          type="text"
          required
          maxLength={120}
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="w-full rounded-xl border border-line bg-canvas/60 px-3.5 py-2.5 text-[13px] text-ink outline-none transition-colors placeholder:text-muted/60 focus:border-gold/60"
          placeholder="مثال: كشخة"
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="rounded-xl bg-gold px-4 py-2.5 text-[13px] font-semibold text-canvas transition-colors hover:bg-gold-soft disabled:opacity-60"
      >
        {pending ? "جارٍ الإنشاء…" : "إنشاء سجل متجر"}
      </button>

      {error ? (
        <p role="alert" className="text-[12px] text-rose sm:col-span-2">
          {error}
        </p>
      ) : null}
    </form>
  );
}

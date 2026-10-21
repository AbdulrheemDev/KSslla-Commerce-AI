"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { apiRequest } from "@/lib/client/api";

export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    if (pending) return;
    setPending(true);

    try {
      await apiRequest("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={pending}
      className="rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-[11.5px] text-muted transition-colors hover:border-line-strong hover:text-ink disabled:opacity-60"
    >
      {pending ? "جارٍ الخروج…" : "تسجيل الخروج"}
    </button>
  );
}

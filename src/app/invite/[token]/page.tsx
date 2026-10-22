import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AcceptInvite } from "@/components/app/accept-invite";
import { BrandMark } from "@/components/brand-mark";
import { StatusPill } from "@/components/status-pill";
import { readPageSession } from "@/server/pages";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "دعوة للانضمام" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await readPageSession();

  if (!session) {
    redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
  }

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div
        aria-hidden="true"
        className="backdrop-grid pointer-events-none absolute inset-x-0 top-0 h-[380px]"
      />

      <header className="relative mx-auto flex max-w-3xl items-center justify-between gap-4 px-6 py-6">
        <div className="flex items-center gap-3">
          <BrandMark />
          <span className="text-sm font-semibold text-ink">KSHakha Commerce AI</span>
        </div>
        <StatusPill tone="gold">دعوة عضو</StatusPill>
      </header>

      <main className="relative mx-auto max-w-xl px-6 pb-20">
        <div className="mt-10 rounded-3xl border border-line bg-surface/85 p-6 shadow-[0_40px_120px_-80px_rgba(216,180,106,0.75)] sm:p-8">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            دعوة للانضمام إلى مؤسسة
          </h1>
          <p className="mt-2 text-[13px] leading-7 text-muted">
            ستتم إضافتك بعضوية نشطة في المؤسسة التي أرسلت الدعوة، بالدور المحدد في الدعوة.
          </p>

          <div className="mt-5 rounded-xl border border-line/70 bg-canvas/40 px-4 py-3 text-[12px] leading-6 text-muted">
            مسجّل الدخول باسم <span className="ltr text-ink">{session.user.email}</span>
          </div>

          <div className="mt-5">
            <AcceptInvite token={token} />
          </div>

          <p className="mt-5 text-[11px] leading-6 text-muted">
            لا يمنح قبول الدعوة أي اتصال بـ <span className="ltr">Salla</span>. حالة الاتصال تبقى{" "}
            <span className="ltr">Not Connected</span>.
          </p>

          <p className="mt-4 text-[11.5px] text-muted">
            <Link href="/app" className="text-gold-soft hover:text-gold">
              العودة إلى مساحة المؤسسة
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}

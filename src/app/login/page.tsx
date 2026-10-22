import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";
import { readPageSession } from "@/server/pages";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "تسجيل الدخول" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const session = await readPageSession();
  if (session) redirect("/app");

  const { next } = await searchParams;

  return (
    <AuthShell
      title="تسجيل الدخول"
      description="ادخل إلى مؤسستك لإدارة الأعضاء والمتاجر الداخلية."
      footer={
        <>
          ليس لديك حساب؟{" "}
          <Link href="/register" className="font-medium text-gold-soft hover:text-gold">
            أنشئ مؤسسة جديدة
          </Link>
        </>
      }
    >
      <LoginForm nextPath={next} />
    </AuthShell>
  );
}

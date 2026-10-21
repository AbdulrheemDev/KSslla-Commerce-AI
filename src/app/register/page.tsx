import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth/auth-shell";
import { RegisterForm } from "@/components/auth/register-form";
import { readPageSession } from "@/server/pages";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "إنشاء حساب" };

export default async function RegisterPage() {
  const session = await readPageSession();
  if (session) redirect("/app");

  return (
    <AuthShell
      title="إنشاء حساب ومؤسسة"
      description="حسابك يصبح مالكًا لمؤسسة جديدة. لا نطلب أي بيانات متجر في هذه المرحلة."
      footer={
        <>
          لديك حساب بالفعل؟{" "}
          <Link href="/login" className="font-medium text-gold-soft hover:text-gold">
            تسجيل الدخول
          </Link>
        </>
      }
    >
      <RegisterForm />
    </AuthShell>
  );
}

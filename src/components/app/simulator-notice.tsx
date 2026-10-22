import { getSallaHealth } from "@/modules/integrations/salla/config";

/**
 * Labels data that did not come from Salla.
 *
 * When the Merchant API base URL points anywhere but the documented host, the
 * rows on this screen came from the local protocol simulator. Saying so is a
 * product requirement, not a debug aid: a demo must never be mistaken for a
 * merchant's real orders.
 *
 * The component reads configuration on the server only; the URL, host, and any
 * credential stay there. Only a boolean reaches the browser.
 */
export function SimulatorNotice() {
  const health = (() => {
    try {
      return getSallaHealth();
    } catch {
      return null;
    }
  })();

  if (!health?.simulated) return null;

  return (
    <div
      role="note"
      className="rounded-2xl border border-amber/25 bg-amber/10 px-4 py-3 text-[12.5px] leading-6 text-amber"
    >
      <strong className="font-semibold">بيانات محاكي محلي.</strong> هذه الصفوف نتجت عن محاكي
      بروتوكول يعمل على هذا الجهاز، وليست بيانات متجر Salla حقيقي. الأرقام حقيقية داخل قاعدة
      البيانات، لكن مصدرها ليس متجرًا فعليًا.
    </div>
  );
}

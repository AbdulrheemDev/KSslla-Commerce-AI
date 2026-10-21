import type { ConnectionStatus } from "@/db/schema";

/**
 * Client-safe Salla copy.
 *
 * Kept free of server imports so the connection panel can import it without
 * pulling configuration or crypto into the browser bundle.
 */

export type CallbackFailureReason =
  | "access_denied"
  | "invalid_state"
  | "state_expired"
  | "state_replayed"
  | "session_mismatch"
  | "not_member"
  | "forbidden"
  | "missing_code"
  | "exchange_failed"
  | "already_linked"
  | "not_configured"
  | "failed";

export const CONNECTION_STATUS_LABELS_AR: Record<ConnectionStatus, string> = {
  authorizing: "بانتظار تفويض Salla",
  connected: "متصل",
  refreshing: "جارٍ تحديث الرمز",
  reauth_required: "يتطلب إعادة تفويض",
  revoked: "ملغى",
  error: "خطأ في الاتصال",
  disconnected: "غير متصل",
};

export function callbackReasonToMessage(reason: string): string {
  switch (reason) {
    case "access_denied":
      return "تم إلغاء التفويض من Salla. لم يتم ربط المتجر.";
    case "state_expired":
      return "انتهت صلاحية طلب الربط. ابدأ الربط مرة أخرى.";
    case "state_replayed":
      return "تم استخدام طلب الربط مسبقًا. ابدأ من جديد.";
    case "invalid_state":
    case "session_mismatch":
      return "طلب الربط غير صالح. ابدأ من جديد.";
    case "not_member":
    case "forbidden":
      return "لم تعد تملك صلاحية ربط متجر في هذه المؤسسة.";
    case "already_linked":
      return "هذا المتجر مرتبط بمتجر داخلي آخر. افصل الربط هناك أولًا.";
    case "not_configured":
      return "تكامل Salla غير مهيأ حاليًا. تواصل مع مسؤول النظام.";
    case "exchange_failed":
      return "رفضت Salla تبادل رمز التفويض. أعد المحاولة.";
    case "missing_code":
      return "لم تُرجع Salla رمز تفويض. أعد المحاولة.";
    default:
      return "تعذر ربط متجر Salla حاليًا. يرجى المحاولة مرة أخرى.";
  }
}

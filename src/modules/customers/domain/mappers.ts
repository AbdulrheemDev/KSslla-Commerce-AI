import type { SallaCustomerDto } from "@/modules/customers/domain/dto";
import type { CustomerInput } from "@/modules/customers/domain/types";
import { parseSallaTimestamp } from "@/modules/catalog/domain/mappers";

/**
 * Customer DTO → domain mapping.
 *
 * Rules, all driven by the documented payload (docs/salla-reference.md §12.3):
 * - never invent a value: an absent field stays `null`;
 * - `mobile` may be an object or a scalar; both normalise to a string;
 * - `mobile_code` is kept exactly as received (`"+966"` vs `"967"`); the UI
 *   joins the two, so normalising the plus away would corrupt a number;
 * - `country_code` is upper-cased because the provider is inconsistent
 *   (`"SA"` on orders, `"sa"` on customer details); case is presentation, not
 *   data, and upper case is what the orders payload documents;
 * - `birthday` becomes `YYYY-MM-DD` text, because the value is a date without
 *   a documented timezone.
 */

function cleanText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function mobileNumber(value: SallaCustomerDto["mobile"]): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") {
    const raw = value.number;
    return raw === null || raw === undefined ? null : cleanText(String(raw));
  }
  return cleanText(String(value));
}

function mobileCodeFrom(value: SallaCustomerDto["mobile"]): string | null {
  if (value === null || value === undefined || typeof value !== "object") return null;
  return cleanText(value.mobile_code);
}

function birthdayDate(value: SallaCustomerDto["birthday"]): string | null {
  if (value === null || value === undefined) return null;
  const raw = typeof value === "string" ? value : value.date;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw.trim());
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

export function mapCustomer(dto: SallaCustomerDto): CustomerInput {
  return {
    externalCustomerId: dto.id,
    firstName: cleanText(dto.first_name),
    lastName: cleanText(dto.last_name),
    email: cleanText(dto.email),
    mobile: mobileNumber(dto.mobile),
    mobileCode: cleanText(dto.mobile_code) ?? mobileCodeFrom(dto.mobile),
    gender: cleanText(dto.gender),
    birthday: birthdayDate(dto.birthday),
    city: cleanText(dto.city),
    country: cleanText(dto.country),
    countryCode: cleanText(dto.country_code)?.toUpperCase() ?? null,
    currency: cleanText(dto.currency)?.toUpperCase() ?? null,
    language: cleanText(dto.lang),
    customerType: cleanText(dto.type),
    sourceCreatedAt: parseSallaTimestamp(dto.created_at),
    sourceUpdatedAt: parseSallaTimestamp(dto.updated_at),
  };
}

/**
 * Normalises a phone number for comparison only.
 *
 * Not persisted: it exists so the UI and future dedupe logic can reason about
 * `+966 5x…` and `966 5x…` without rewriting what the provider reported.
 */
export function normalizeMobileForDisplay(
  mobile: string | null,
  mobileCode: string | null,
): string | null {
  if (!mobile) return null;
  const digits = mobile.replace(/[^\d]/g, "");
  const code = (mobileCode ?? "").replace(/[^\d]/g, "");
  if (code && digits.startsWith(code)) return `+${digits}`;
  if (code) return `+${code}${digits}`;
  return mobile;
}

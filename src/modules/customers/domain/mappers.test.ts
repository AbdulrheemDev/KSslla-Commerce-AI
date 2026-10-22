import { describe, expect, it } from "vitest";

import { sallaCustomerDtoSchema } from "@/modules/customers/domain/dto";
import { mapCustomer, normalizeMobileForDisplay } from "@/modules/customers/domain/mappers";

/**
 * Customer mapping tests.
 *
 * The payloads below are copies of the documented shapes, including the two
 * inconsistencies Salla documents: `mobile` as an object on orders versus a
 * scalar here, and `country_code` in either case.
 */

describe("customer DTO", () => {
  it("accepts an object mobile and keeps the documented fields", () => {
    const parsed = sallaCustomerDtoSchema.parse({
      id: 123,
      first_name: "نورة",
      last_name: "العتيبي",
      mobile: { number: 512345671, mobile_code: "966" },
      email: "noura@example.test",
      country_code: "sa",
      updated_at: { date: "2026-09-01 10:00:00.000000", timezone: "Asia/Riyadh" },
      groups: [],
    });

    expect(parsed.id).toBe("123");
  });

  it("accepts a scalar mobile", () => {
    const parsed = sallaCustomerDtoSchema.parse({ id: 7, mobile: "512345679" });
    expect(parsed.mobile).toBe("512345679");
  });

  it("rejects a payload without an id", () => {
    expect(() => sallaCustomerDtoSchema.parse({ first_name: "بلا معرّف" })).toThrow();
  });
});

describe("customer mapper", () => {
  it("normalises the documented quirks without inventing values", () => {
    const input = mapCustomer(
      sallaCustomerDtoSchema.parse({
        id: 55,
        first_name: " محمد ",
        last_name: "الشهري",
        mobile: { number: 512345674, mobile_code: "966" },
        email: "m@example.test",
        gender: "male",
        birthday: { date: "1994-03-05", timezone: "Asia/Riyadh" },
        city: "جدة",
        country: "السعودية",
        country_code: "sa",
        currency: "sar",
        lang: "ar",
        type: "user",
        created_at: { date: "2025-02-01 10:00:00.000000" },
        updated_at: { date: "2026-09-02 10:00:00.000000" },
      }),
    );

    expect(input.externalCustomerId).toBe("55");
    expect(input.firstName).toBe("محمد");
    expect(input.mobile).toBe("512345674");
    expect(input.mobileCode).toBe("966");
    expect(input.birthday).toBe("1994-03-05");
    expect(input.countryCode).toBe("SA");
    expect(input.currency).toBe("SAR");
    expect(input.language).toBe("ar");
    expect(input.customerType).toBe("user");
    expect(input.sourceCreatedAt).not.toBeNull();
  });

  it("leaves undocumented fields null instead of guessing", () => {
    const input = mapCustomer(sallaCustomerDtoSchema.parse({ id: 9, first_name: "سارة" }));

    expect(input.lastName).toBeNull();
    expect(input.email).toBeNull();
    expect(input.birthday).toBeNull();
    expect(input.countryCode).toBeNull();
    expect(input.sourceCreatedAt).toBeNull();
  });

  it("formats a phone for display without rewriting the stored value", () => {
    expect(normalizeMobileForDisplay("512345671", "+966")).toBe("+966512345671");
    expect(normalizeMobileForDisplay("512345671", "966")).toBe("+966512345671");
    expect(normalizeMobileForDisplay("966512345671", "966")).toBe("+966512345671");
    expect(normalizeMobileForDisplay(null, "966")).toBeNull();
  });
});

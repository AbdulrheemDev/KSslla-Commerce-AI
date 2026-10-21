import { describe, expect, it } from "vitest";

import {
  isValidEmail,
  isValidSlug,
  normalizeEmail,
  slugifyOrganizationName,
} from "@/modules/identity/domain/identifiers";

describe("identifiers", () => {
  it("trims and lowercases email addresses", () => {
    expect(normalizeEmail("  Owner@Example.COM ")).toBe("owner@example.com");
  });

  it("validates email shape without accepting obvious garbage", () => {
    expect(isValidEmail("owner@example.com")).toBe(true);
    expect(isValidEmail("owner+tag@sub.example.co")).toBe(true);
    expect(isValidEmail("owner@localhost")).toBe(false);
    expect(isValidEmail("owner@example")).toBe(false);
    expect(isValidEmail("no-at-sign.example.com")).toBe(false);
    expect(isValidEmail(`${"a".repeat(250)}@example.com`)).toBe(false);
  });

  it("derives ASCII slugs and falls back for Arabic names", () => {
    expect(slugifyOrganizationName("KSHakha Commerce  AI")).toBe("kshakha-commerce-ai");
    expect(slugifyOrganizationName("Café & Co.")).toBe("cafe-co");

    const arabic = slugifyOrganizationName("كشخة");
    expect(arabic).toMatch(/^org-[0-9a-f]{8}$/);
    expect(isValidSlug(arabic)).toBe(true);
  });

  it("rejects invalid slugs", () => {
    expect(isValidSlug("Upper-Case")).toBe(false);
    expect(isValidSlug("-leading")).toBe(false);
    expect(isValidSlug("trailing-")).toBe(false);
    expect(isValidSlug("double--dash")).toBe(false);
    expect(isValidSlug("a")).toBe(false);
  });
});

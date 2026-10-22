import { describe, expect, it } from "vitest";

import { AppError, isAppError, toAppError, toPublicError } from "@/lib/errors";

describe("AppError", () => {
  it("maps known codes to HTTP statuses", () => {
    const error = new AppError({ code: "UNAUTHENTICATED", message: "Sign in required." });

    expect(error.httpStatus).toBe(401);
    expect(error.retryable).toBe(false);
    expect(error.name).toBe("AppError");
  });

  it("uses 404 for tenant isolation violations to avoid existence leaks", () => {
    const error = new AppError({
      code: "TENANT_ISOLATION_VIOLATION",
      message: "Store not found.",
    });

    expect(error.httpStatus).toBe(404);
  });

  it("allows explicit retryability and details", () => {
    const error = new AppError({
      code: "INTEGRATION_ERROR",
      message: "Salla timed out.",
      retryable: true,
      details: { attempt: 2 },
    });

    expect(error.retryable).toBe(true);
    expect(error.details).toEqual({ attempt: 2 });
  });

  it("serializes without the underlying cause", () => {
    const cause = new Error("database credentials: postgres://secret");
    const error = new AppError({ code: "INTERNAL", message: "Safe message.", cause });
    const serialized = JSON.stringify(error);

    expect(serialized).toContain("Safe message.");
    expect(serialized).not.toContain("postgres://secret");
    expect(error.cause).toBe(cause);
  });
});

describe("error helpers", () => {
  it("recognizes AppError instances", () => {
    expect(isAppError(new AppError({ code: "INTERNAL", message: "x" }))).toBe(true);
    expect(isAppError(new Error("plain"))).toBe(false);
  });

  it("wraps unknown errors as INTERNAL without leaking their message", () => {
    const wrapped = toAppError(new Error("connection string: secret"));

    expect(wrapped.code).toBe("INTERNAL");
    expect(wrapped.message).not.toContain("secret");
    expect(wrapped.cause).toBeInstanceOf(Error);
  });

  it("preserves an existing AppError", () => {
    const original = new AppError({ code: "FORBIDDEN", message: "No access." });

    expect(toAppError(original)).toBe(original);
  });

  it("projects public errors without details or cause", () => {
    const error = new AppError({
      code: "VALIDATION_FAILED",
      message: "Invalid input.",
      details: { internalField: "do-not-expose" },
    });

    const publicError = toPublicError(error);

    expect(publicError).toEqual({
      code: "VALIDATION_FAILED",
      message: "Invalid input.",
      httpStatus: 422,
    });
    expect(publicError).not.toHaveProperty("details");
  });
});

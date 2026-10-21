import type { DestinationStream } from "pino";
import { describe, expect, it } from "vitest";

import { createLogger } from "@/lib/logger";

function createCaptureLogger() {
  const lines: string[] = [];
  const destination = {
    write(chunk: string) {
      lines.push(chunk);
    },
  } as unknown as DestinationStream;

  const logger = createLogger({
    level: "trace",
    destination,
    context: { service: "test-service" },
  });

  const records = (): Array<Record<string, unknown>> =>
    lines.map((line) => JSON.parse(line) as Record<string, unknown>);

  return { logger, lines, records };
}

describe("createLogger", () => {
  it("writes structured JSON with the child context", () => {
    const { logger, records } = createCaptureLogger();

    logger.info({ event: "test.event", organizationId: "org_1", storeId: "store_1" }, "hello");

    const [record] = records();
    expect(record).toMatchObject({
      event: "test.event",
      message: "hello",
      service: "test-service",
      organizationId: "org_1",
      storeId: "store_1",
    });
    expect(typeof record?.time).toBe("string");
  });

  it("redacts tokens, secrets and credentials at multiple depths", () => {
    const { logger, lines, records } = createCaptureLogger();

    logger.info(
      {
        event: "security.test",
        access_token: "top-level-token",
        password: "top-level-password",
        nested: {
          refresh_token: "nested-refresh-token",
          deep: {
            apiKey: "deep-api-key",
            client_secret: "deep-client-secret",
          },
        },
        authorization: "Bearer should-never-appear",
      },
      "redaction test",
    );

    const serialized = lines.join("\n");
    expect(serialized).not.toContain("top-level-token");
    expect(serialized).not.toContain("top-level-password");
    expect(serialized).not.toContain("nested-refresh-token");
    expect(serialized).not.toContain("deep-api-key");
    expect(serialized).not.toContain("deep-client-secret");
    expect(serialized).not.toContain("should-never-appear");

    const [record] = records();
    expect(record?.access_token).toBe("[REDACTED]");
    expect(record?.nested).toMatchObject({
      refresh_token: "[REDACTED]",
      deep: {
        apiKey: "[REDACTED]",
        client_secret: "[REDACTED]",
      },
    });
  });

  it("respects the configured level", () => {
    const { logger, lines } = createCaptureLogger();
    const warnOnly = logger.child({ scope: "level-test" });

    warnOnly.level = "warn";
    warnOnly.info({ event: "ignored" }, "should not be written");
    warnOnly.warn({ event: "kept" }, "should be written");

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({ event: "kept", scope: "level-test" });
  });
});

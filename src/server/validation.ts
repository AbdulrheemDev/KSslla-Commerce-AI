import type { NextRequest } from "next/server";
import type { z } from "zod";

import { AppError } from "@/lib/errors";

/** Parses a JSON body with a Zod schema and reports field-level failures only. */
export async function parseJson<T extends z.ZodType>(
  request: NextRequest,
  schema: T,
): Promise<z.infer<T>> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    throw new AppError({
      code: "VALIDATION_FAILED",
      message: "Request body must be valid JSON.",
    });
  }

  const result = schema.safeParse(body);

  if (!result.success) {
    throw new AppError({
      code: "VALIDATION_FAILED",
      message: "The submitted data is invalid.",
      details: {
        issues: result.error.issues.map((issue) => ({
          field: issue.path.map(String).join(".") || "(root)",
          rule: issue.code,
        })),
      },
    });
  }

  return result.data;
}

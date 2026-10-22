/**
 * Reads the provider `metadata` object that Phase 04 stores verbatim inside
 * `products.metadata.sallaMetadata`.
 *
 * The mapper keeps the object only when the provider sent one (`compact()` drops
 * `null`/`undefined`), so the presence of the key is meaningful:
 * - key present, even as `{}` → the provider returned a metadata object;
 * - key absent → no object was returned for this product.
 *
 * The function never throws on unexpected shapes: a non-object, an array, or a
 * numeric field yields `null` for that field. Nothing is coerced into a string.
 */

export interface ProviderMetadata {
  readonly stored: boolean;
  readonly title: string | null;
  readonly description: string | null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function readProviderMetadata(raw: unknown): ProviderMetadata {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { stored: false, title: null, description: null };
  }

  const record = raw as Record<string, unknown>;
  if (!("sallaMetadata" in record)) {
    return { stored: false, title: null, description: null };
  }

  const metadata = record.sallaMetadata;
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
    return { stored: false, title: null, description: null };
  }

  const fields = metadata as Record<string, unknown>;

  return {
    stored: true,
    title: readString(fields.title),
    description: readString(fields.description),
  };
}

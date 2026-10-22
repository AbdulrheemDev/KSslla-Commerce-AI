import { sallaApiError, sallaInvalidResponse } from "@/modules/integrations/salla/domain/errors";
import {
  sallaCategoryListSchema,
  sallaProductListSchema,
  type SallaCategoryDto,
  type SallaProductDto,
} from "@/modules/catalog/domain/dto";
import type { PageMeta } from "@/modules/catalog/domain/pagination";
import { requestJson } from "@/modules/integrations/salla/infrastructure/http";
import { requireSallaConfig } from "@/modules/integrations/salla/config";

/**
 * Read-only Merchant API client for the catalogue.
 *
 * One method per documented endpoint; no generic escape hatch, so no other
 * endpoint can be reached from the sync code. The access token arrives as an
 * argument — this module never reads the token store.
 *
 * Documented endpoints (docs/salla-reference.md §2.2–2.3):
 * - GET /admin/v2/products   (products.read)
 * - GET /admin/v2/categories (categories.read)
 */

export interface CatalogPage<T> {
  items: T[];
  meta: PageMeta;
}

export interface SallaCatalogClient {
  listProducts(input: { page: number; perPage: number }): Promise<CatalogPage<SallaProductDto>>;
  listCategories(input: { page: number; perPage: number }): Promise<CatalogPage<SallaCategoryDto>>;
}

interface ListEnvelope<T> {
  data: T[];
  pagination: {
    currentPage: number;
    totalPages: number;
    perPage?: number;
    total?: number;
  };
}

function parseEnvelope<T>(
  body: unknown,
  schema: typeof sallaProductListSchema | typeof sallaCategoryListSchema,
  field: string,
): ListEnvelope<T> {
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    // Only the failing field path is reported; the payload is never attached.
    throw sallaInvalidResponse(field);
  }

  return parsed.data as ListEnvelope<T>;
}

export function createSallaCatalogClient(options: {
  accessToken: string;
  baseUrl?: string;
}): SallaCatalogClient {
  const baseUrl = options.baseUrl ?? requireSallaConfig().endpoints.apiBaseUrl;
  const authorization = `Bearer ${options.accessToken}`;

  async function get(path: string, page: number, perPage: number): Promise<unknown> {
    const url = new URL(`${baseUrl.replace(/\/+$/, "")}/${path}`);
    url.searchParams.set("page", String(page));
    url.searchParams.set("per_page", String(perPage));

    const response = await requestJson(url.toString(), {
      method: "GET",
      headers: { authorization, accept: "application/json" },
    });

    if (response.status < 200 || response.status >= 300) {
      // 401 is handled by the token manager (refresh once); 4xx is permanent.
      throw sallaApiError(response.status);
    }

    return response.body;
  }

  return {
    async listProducts({ page, perPage }) {
      const body = await get("products", page, perPage);
      const envelope = parseEnvelope<SallaProductDto>(
        body,
        sallaProductListSchema,
        "products.data",
      );

      return {
        items: envelope.data,
        meta: {
          currentPage: envelope.pagination.currentPage,
          totalPages: envelope.pagination.totalPages,
          perPage: envelope.pagination.perPage,
          total: envelope.pagination.total,
        },
      };
    },

    async listCategories({ page, perPage }) {
      const body = await get("categories", page, perPage);
      const envelope = parseEnvelope<SallaCategoryDto>(
        body,
        sallaCategoryListSchema,
        "categories.data",
      );

      return {
        items: envelope.data,
        meta: {
          currentPage: envelope.pagination.currentPage,
          totalPages: envelope.pagination.totalPages,
          perPage: envelope.pagination.perPage,
          total: envelope.pagination.total,
        },
      };
    },
  };
}

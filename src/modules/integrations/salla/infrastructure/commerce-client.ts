import { sallaApiError, sallaInvalidResponse } from "@/modules/integrations/salla/domain/errors";
import { requireSallaConfig } from "@/modules/integrations/salla/config";
import { requestJson } from "@/modules/integrations/salla/infrastructure/http";
import type { PageMeta } from "@/modules/catalog/domain/pagination";
import { sallaCustomerListSchema, type SallaCustomerDto } from "@/modules/customers/domain/dto";
import { sallaOrderListSchema, type SallaOrderDto } from "@/modules/orders/domain/dto";
import { sallaQuantityListSchema, type SallaQuantityDto } from "@/modules/inventory/domain/dto";
import type { z } from "zod";

/**
 * Read-only Merchant API client for orders, customers, and inventory.
 *
 * One method per documented endpoint and no generic escape hatch, so no other
 * endpoint can be reached from the sync code. The access token arrives as an
 * argument — this module never reads the token store.
 *
 * Documented endpoints (docs/salla-reference.md §12):
 * - GET /admin/v2/orders               (orders.read)
 * - GET /admin/v2/customers            (customers.read)
 * - GET /admin/v2/products/quantities  (products.read)
 *
 * `expanded=true` is never sent: Salla documents it as unsupported for apps
 * created after 15 August 2024 and removed on 1 September 2026.
 */

export interface CommercePage<T> {
  items: T[];
  meta: PageMeta;
}

export interface ListOrdersInput {
  page: number;
  perPage: number;
  fromDate?: string;
  toDate?: string;
}

export interface SallaCommerceClient {
  listOrders(input: ListOrdersInput): Promise<CommercePage<SallaOrderDto>>;
  listCustomers(input: { page: number; perPage: number }): Promise<CommercePage<SallaCustomerDto>>;
  listProductQuantities(input: {
    page: number;
    perPage: number;
  }): Promise<CommercePage<SallaQuantityDto>>;
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
  schema: z.ZodType<ListEnvelope<T>>,
  field: string,
): ListEnvelope<T> {
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    // Only the failing field path is reported; the payload is never attached.
    throw sallaInvalidResponse(field);
  }

  return parsed.data;
}

function metaOf(envelope: ListEnvelope<unknown>): PageMeta {
  return {
    currentPage: envelope.pagination.currentPage,
    totalPages: envelope.pagination.totalPages,
    perPage: envelope.pagination.perPage,
    total: envelope.pagination.total,
  };
}

export function createSallaCommerceClient(options: {
  accessToken: string;
  baseUrl?: string;
}): SallaCommerceClient {
  const baseUrl = options.baseUrl ?? requireSallaConfig().endpoints.apiBaseUrl;
  const authorization = `Bearer ${options.accessToken}`;

  async function get(path: string, params: Record<string, string | undefined>): Promise<unknown> {
    const url = new URL(`${baseUrl.replace(/\/+$/, "")}/${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") url.searchParams.set(key, value);
    }

    const response = await requestJson(url.toString(), {
      method: "GET",
      headers: { authorization, accept: "application/json" },
    });

    if (response.status < 200 || response.status >= 300) {
      // 401 is handled by the sync runner (refresh once); 4xx is permanent.
      throw sallaApiError(response.status);
    }

    return response.body;
  }

  return {
    async listOrders({ page, perPage, fromDate, toDate }) {
      const body = await get("orders", {
        page: String(page),
        per_page: String(perPage),
        from_date: fromDate,
        to_date: toDate,
      });

      const envelope = parseEnvelope<SallaOrderDto>(body, sallaOrderListSchema, "orders.data");
      return { items: envelope.data, meta: metaOf(envelope) };
    },

    async listCustomers({ page, perPage }) {
      const body = await get("customers", {
        page: String(page),
        per_page: String(perPage),
      });

      const envelope = parseEnvelope<SallaCustomerDto>(
        body,
        sallaCustomerListSchema,
        "customers.data",
      );
      return { items: envelope.data, meta: metaOf(envelope) };
    },

    async listProductQuantities({ page, perPage }) {
      const body = await get("products/quantities", {
        page: String(page),
        per_page: String(perPage),
      });

      const envelope = parseEnvelope<SallaQuantityDto>(
        body,
        sallaQuantityListSchema,
        "products.quantities.data",
      );
      return { items: envelope.data, meta: metaOf(envelope) };
    },
  };
}

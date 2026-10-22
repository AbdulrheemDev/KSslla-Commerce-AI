import type { CustomerInput } from "@/modules/customers/domain/types";

/**
 * Order domain types.
 *
 * `OrderItemInput` is deliberately sparse. The documented list payload cannot
 * supply a product id, SKU, unit price, or line total (see
 * docs/salla-reference.md §12.2), so every one of those fields is nullable and
 * the mapper reports why it is empty through `linkStatus`.
 */

export const ORDER_ITEM_LINK_STATUSES = [
  "linked",
  "product_not_found",
  "no_product_reference",
] as const;
export type OrderItemLinkStatus = (typeof ORDER_ITEM_LINK_STATUSES)[number];

/** Local link resolution state, recorded per line and per link attempt. */
export interface OrderItemInput {
  lineNumber: number;
  externalProductId: string | null;
  externalSkuId: string | null;
  productName: string;
  sku: string | null;
  quantity: number;
  unitPrice: string | null;
  totalPrice: string | null;
  thumbnailUrl: string | null;
  linkStatus: OrderItemLinkStatus;
  /** Set by the repository once a local product is resolved. */
  productId?: string | null;
}

export interface OrderInput {
  externalOrderId: string;
  externalReferenceId: string | null;
  referenceId: string | null;
  statusId: string | null;
  statusName: string | null;
  statusSlug: string | null;
  source: string | null;
  totalAmount: string | null;
  currency: string | null;
  paymentMethod: string | null;
  isPendingPayment: boolean;
  draft: boolean;
  /** Wall-clock order time as reported; parsed deterministically, never shifted. */
  orderDate: Date | null;
  orderTimezone: string | null;
  customerExternalId: string | null;
  /** Embedded customer, used to create a missing row (idempotently). */
  customer: CustomerInput | null;
  items: OrderItemInput[];
  /**
   * Allowlisted provider snapshot — documented keys only, with the customer
   * object and every payment/notes field removed (ADR-043).
   */
  rawPayload: Record<string, unknown> | null;
}

export interface PersistedOrder {
  id: string;
  externalOrderId: string;
  statusName: string | null;
  statusSlug: string | null;
  totalAmount: string | null;
  currency: string | null;
  isPendingPayment: boolean;
  draft: boolean;
  /**
   * Wall clock exactly as Salla reported it, `YYYY-MM-DD HH:mm`.
   *
   * Deliberately not an instant: the provider sends a local wall clock plus an
   * IANA zone, and converting it here would invent an offset. The UI renders
   * this string verbatim.
   */
  orderDate: string | null;
  orderTimezone: string | null;
  customerName: string | null;
  itemsCount: number;
  lastSeenAt: string;
}

export interface OrderPageResult {
  items: PersistedOrder[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface OrderStats {
  total: number;
  lastOrderAt: string | null;
  drafts: number;
  pendingPayment: number;
}

/**
 * Customer domain types.
 *
 * Framework-free: no Drizzle, no fetch, no Next.js. The sync service and the
 * repository depend on these shapes, never on the provider payload.
 */

export interface CustomerInput {
  externalCustomerId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  mobile: string | null;
  mobileCode: string | null;
  gender: string | null;
  /** `YYYY-MM-DD`, as documented; never a guessed instant. */
  birthday: string | null;
  city: string | null;
  country: string | null;
  countryCode: string | null;
  currency: string | null;
  language: string | null;
  customerType: string | null;
  sourceCreatedAt: Date | null;
  sourceUpdatedAt: Date | null;
}

export interface PersistedCustomer {
  id: string;
  externalCustomerId: string;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  email: string | null;
  mobile: string | null;
  mobileCode: string | null;
  gender: string | null;
  birthday: string | null;
  city: string | null;
  country: string | null;
  countryCode: string | null;
  currency: string | null;
  language: string | null;
  customerType: string | null;
  /** From Salla when the orders payload provides it; the customer list does not. */
  sourceCreatedAt: string | null;
  orderCount: number | null;
  lastSeenAt: string;
  updatedAt: string;
}

export interface CustomerPage {
  items: PersistedCustomer[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

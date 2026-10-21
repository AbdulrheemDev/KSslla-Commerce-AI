import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { registerAccount } from "@/modules/identity/application/auth-service";
import { closeTestDb, getTestDb, resetDatabase } from "@/test/db/client";
import { withTenantTransaction } from "@/db/tenant";

const meta = { ipHash: null, userAgent: "vitest", requestId: "test-request" };

async function createTenant(label: string) {
  const result = await registerAccount(
    getTestDb(),
    {
      email: `${label}@example.com`,
      password: "correct horse battery staple",
      name: `${label} owner`,
      organizationName: `${label} org`,
    },
    meta,
  );

  return result;
}

describe("database harness", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await closeTestDb();
  });

  it("connects as an unprivileged role so RLS is enforced", async () => {
    const rows = await getTestDb().execute<{ current_user: string }>(sql`select current_user`);
    expect(rows[0]?.current_user).toBe("ksh_app");
  });

  it("applies the schema migrations", async () => {
    const rows = await getTestDb().execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables
          where table_schema = 'public' and table_name in
          ('users','organizations','organization_members','invitations','stores','sessions','audit_logs')`,
    );

    expect(rows.map((row) => row.table_name).sort()).toEqual([
      "audit_logs",
      "invitations",
      "organization_members",
      "organizations",
      "sessions",
      "stores",
      "users",
    ]);
  });

  it("isolates tenant rows in both directions", async () => {
    const tenantA = await createTenant("alpha");
    const tenantB = await createTenant("beta");

    const visibleToA = await withTenantTransaction(
      getTestDb(),
      { userId: tenantA.user.id, organizationId: tenantA.organization.id },
      (tx) => tx.execute<{ organization_id: string }>(sql`select organization_id from stores`),
    );

    // Neither tenant created a store, so seed one in each.
    await withTenantTransaction(
      getTestDb(),
      { userId: tenantA.user.id, organizationId: tenantA.organization.id },
      (tx) =>
        tx.execute(
          sql`insert into stores (organization_id, name, slug) values (${tenantA.organization.id}, 'A store', 'a-store')`,
        ),
    );
    await withTenantTransaction(
      getTestDb(),
      { userId: tenantB.user.id, organizationId: tenantB.organization.id },
      (tx) =>
        tx.execute(
          sql`insert into stores (organization_id, name, slug) values (${tenantB.organization.id}, 'B store', 'b-store')`,
        ),
    );

    const storesSeenByA = await withTenantTransaction(
      getTestDb(),
      { userId: tenantA.user.id, organizationId: tenantA.organization.id },
      (tx) => tx.execute<{ name: string }>(sql`select name from stores`),
    );

    expect(storesSeenByA.map((row) => row.name)).toEqual(["A store"]);
    expect(visibleToA).toHaveLength(0);

    const membersSeenByB = await withTenantTransaction(
      getTestDb(),
      { userId: tenantB.user.id, organizationId: tenantB.organization.id },
      (tx) =>
        tx.execute<{ organization_id: string }>(
          sql`select organization_id from organization_members`,
        ),
    );

    expect(membersSeenByB.every((row) => row.organization_id === tenantB.organization.id)).toBe(
      true,
    );

    // Writing into another tenant is rejected by the policy.
    await expect(
      withTenantTransaction(
        getTestDb(),
        { userId: tenantA.user.id, organizationId: tenantA.organization.id },
        (tx) =>
          tx.execute(
            sql`insert into stores (organization_id, name, slug) values (${tenantB.organization.id}, 'Smuggled', 'smuggled')`,
          ),
      ),
    ).rejects.toThrow();
  });
});

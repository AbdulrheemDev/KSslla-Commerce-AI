import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { closeTestDb, executeAsAdmin } from "@/test/db/client";
import { findMembershipId, inviteAndAccept } from "@/test/integration/fixtures";
import { registerViaApi, resetState } from "@/test/integration/helpers";

describe("multi-tenancy and roles", () => {
  beforeEach(resetState);
  afterAll(closeTestDb);

  it("creates internal stores as not_connected and isolates them by organization", async () => {
    const alpha = await registerViaApi({ email: "alpha@example.com", organizationName: "Alpha" });
    const beta = await registerViaApi({ email: "beta@example.com", organizationName: "Beta" });

    const created = await alpha.client.post<{
      store: { id: string; status: string; platform: string };
    }>("/api/organizations/current/stores", { name: "كشخة" });

    expect(created.status).toBe(201);
    expect(created.body.data?.store.status).toBe("not_connected");
    expect(created.body.data?.store.platform).toBe("salla");

    const storeId = created.body.data!.store.id;

    const own = await alpha.client.get<{
      store: { id: string; connection: { state: string } };
    }>(`/api/organizations/current/stores/${storeId}`);
    expect(own.status).toBe(200);
    expect(own.body.data?.store.connection.state).toBe("not_connected");

    const foreign = await beta.client.get(`/api/organizations/current/stores/${storeId}`);
    expect(foreign.status).toBe(404);
    expect(foreign.body.error?.code).toBe("TENANT_ISOLATION_VIOLATION");

    const betaStores = await beta.client.get<{ stores: unknown[] }>(
      "/api/organizations/current/stores",
    );
    expect(betaStores.body.data?.stores).toEqual([]);

    const betaList = await beta.client.get<{ stores: unknown[] }>(
      "/api/organizations/current/stores",
    );
    expect(betaList.body.data?.stores).toHaveLength(0);
  });

  it("enforces member:read and organization:update per role", async () => {
    const owner = await registerViaApi({
      email: "rbac-owner@example.com",
      organizationName: "RBAC",
    });
    const manager = await inviteAndAccept(owner, "rbac-manager@example.com", "manager");
    const viewer = await inviteAndAccept(owner, "rbac-viewer@example.com", "viewer");

    const ownerMembers = await owner.client.get<{ members: unknown[] }>(
      "/api/organizations/current/members",
    );
    expect(ownerMembers.status).toBe(200);
    expect(ownerMembers.body.data?.members).toHaveLength(3);

    const managerMembers = await manager.client.get("/api/organizations/current/members");
    expect(managerMembers.status).toBe(200);

    const viewerMembers = await viewer.client.get("/api/organizations/current/members");
    expect(viewerMembers.status).toBe(403);

    const managerStoreCreate = await manager.client.post("/api/organizations/current/stores", {
      name: "Manager store",
    });
    expect(managerStoreCreate.status).toBe(403);

    const viewerStores = await viewer.client.get("/api/organizations/current/stores");
    expect(viewerStores.status).toBe(200);
  });

  it("prevents duplicate memberships and owner invitations", async () => {
    const owner = await registerViaApi({
      email: "conflict-owner@example.com",
      organizationName: "Conflicts",
    });
    const existing = await inviteAndAccept(owner, "conflict-member@example.com", "viewer");

    const duplicateMember = await owner.client.post("/api/organizations/current/members", {
      email: existing.email,
      role: "viewer",
    });
    expect(duplicateMember.status).toBe(409);

    const ownerInvite = await owner.client.post("/api/organizations/current/members", {
      email: "new-owner@example.com",
      role: "owner",
    });
    expect(ownerInvite.status).toBe(403);

    const pending = await owner.client.post("/api/organizations/current/members", {
      email: "pending@example.com",
      role: "viewer",
    });
    expect(pending.status).toBe(201);

    const duplicatePending = await owner.client.post("/api/organizations/current/members", {
      email: "pending@example.com",
      role: "viewer",
    });
    expect(duplicatePending.status).toBe(409);
  });

  it("allows an invitation exactly once", async () => {
    const owner = await registerViaApi({
      email: "once-owner@example.com",
      organizationName: "Once",
    });

    const invite = await owner.client.post<{ invitePath: string }>(
      "/api/organizations/current/members",
      { email: "once-invitee@example.com", role: "analyst" },
    );
    const token = invite.body.data!.invitePath.split("/").pop()!;

    const invitee = await registerViaApi({
      email: "once-invitee@example.com",
      organizationName: "Invitee own org",
    });

    const first = await invitee.client.post("/api/invitations/accept", { token });
    expect(first.status).toBe(200);

    const second = await invitee.client.post("/api/invitations/accept", { token });
    expect(second.status).toBe(404);
  });

  it("rejects expired invitations", async () => {
    const owner = await registerViaApi({
      email: "expiry-owner@example.com",
      organizationName: "Expiry",
    });

    const invite = await owner.client.post<{ invitePath: string }>(
      "/api/organizations/current/members",
      { email: "expiry-invitee@example.com", role: "viewer" },
    );
    const token = invite.body.data!.invitePath.split("/").pop()!;

    await executeAsAdmin("update invitations set expires_at = now() - interval '1 day'");

    const invitee = await registerViaApi({
      email: "expiry-invitee@example.com",
      organizationName: "Expiry invitee org",
    });

    const accepted = await invitee.client.post("/api/invitations/accept", { token });
    expect(accepted.status).toBe(404);
    expect(accepted.body.error?.code).toBe("NOT_FOUND");
  });

  it("binds an invitation to the invited email address", async () => {
    const owner = await registerViaApi({
      email: "bind-owner@example.com",
      organizationName: "Binding",
    });

    const invite = await owner.client.post<{ invitePath: string }>(
      "/api/organizations/current/members",
      { email: "intended@example.com", role: "viewer" },
    );
    const token = invite.body.data!.invitePath.split("/").pop()!;

    const other = await registerViaApi({
      email: "someone-else@example.com",
      organizationName: "Someone else org",
    });

    const accepted = await other.client.post("/api/invitations/accept", { token });
    expect(accepted.status).toBe(404);
  });

  it("changes roles only downward and never on yourself", async () => {
    const owner = await registerViaApi({
      email: "roles-owner@example.com",
      organizationName: "Roles",
    });
    const manager = await inviteAndAccept(owner, "roles-manager@example.com", "manager");

    const ownerMembership = await findMembershipId(owner, owner.email);

    const selfChange = await owner.client.patch(
      `/api/organizations/current/members/${ownerMembership}`,
      { role: "admin" },
    );
    expect(selfChange.status).toBe(403);

    const promoteToOwner = await owner.client.patch(
      `/api/organizations/current/members/${manager.membershipId}`,
      { role: "owner" },
    );
    expect(promoteToOwner.status).toBe(403);

    const managerCannotManage = await manager.client.patch(
      `/api/organizations/current/members/${ownerMembership}`,
      { role: "viewer" },
    );
    expect(managerCannotManage.status).toBe(403);

    const demote = await owner.client.patch(
      `/api/organizations/current/members/${manager.membershipId}`,
      { role: "analyst" },
    );
    expect(demote.status).toBe(200);

    const members = await owner.client.get<{
      members: Array<{ email: string; role: string }>;
    }>("/api/organizations/current/members");
    const updated = members.body.data?.members.find(
      (member) => member.email === "roles-manager@example.com",
    );
    expect(updated?.role).toBe("analyst");
  });

  it("stops admins from granting peer or owner roles or touching owners", async () => {
    const owner = await registerViaApi({
      email: "admin-owner@example.com",
      organizationName: "Admin limits",
    });
    const admin = await inviteAndAccept(owner, "admin-user@example.com", "admin");
    const ownerMembership = await findMembershipId(owner, owner.email);

    const grantAdmin = await admin.client.post("/api/organizations/current/members", {
      email: "peer@example.com",
      role: "admin",
    });
    expect(grantAdmin.status).toBe(403);

    const grantOwner = await admin.client.post("/api/organizations/current/members", {
      email: "owner-two@example.com",
      role: "owner",
    });
    expect(grantOwner.status).toBe(403);

    const lowerRole = await admin.client.post("/api/organizations/current/members", {
      email: "viewer-two@example.com",
      role: "viewer",
    });
    expect(lowerRole.status).toBe(201);

    const changeOwner = await admin.client.patch(
      `/api/organizations/current/members/${ownerMembership}`,
      { role: "viewer" },
    );
    expect(changeOwner.status).toBe(403);

    const removeOwner = await admin.client.delete(
      `/api/organizations/current/members/${ownerMembership}`,
    );
    expect(removeOwner.status).toBe(403);
  });

  it("removes access immediately when a member is removed", async () => {
    const owner = await registerViaApi({
      email: "remove-owner@example.com",
      organizationName: "Removals",
    });
    const viewer = await inviteAndAccept(owner, "remove-viewer@example.com", "viewer");

    const before = await viewer.client.get<{ organization: { id: string } }>(
      "/api/organizations/current",
    );
    expect(before.body.data?.organization.id).toBe(owner.organizationId);

    const removed = await owner.client.delete(
      `/api/organizations/current/members/${viewer.membershipId}`,
    );
    expect(removed.status).toBe(200);

    // The session survives, but the active organization falls back to the
    // member's own organization, so no access to the previous tenant remains.
    const after = await viewer.client.get<{ organization: { id: string } }>(
      "/api/organizations/current",
    );
    expect(after.body.data?.organization.id).not.toBe(owner.organizationId);

    const switchBack = await viewer.client.post("/api/organizations/switch", {
      organizationId: owner.organizationId,
    });
    expect(switchBack.status).toBe(404);

    const selfRemove = await owner.client.delete(
      `/api/organizations/current/members/${await findMembershipId(owner, owner.email)}`,
    );
    expect(selfRemove.status).toBe(403);
  });

  it("never leaves the organization without an owner", async () => {
    const owner = await registerViaApi({
      email: "owner-guard@example.com",
      organizationName: "Owner guard",
    });
    const admin = await inviteAndAccept(owner, "owner-guard-admin@example.com", "admin");

    // Simulate a second owner (ownership transfer itself is a later phase).
    await executeAsAdmin(
      `update organization_members set role = 'owner' where id = '${admin.membershipId}'`,
    );

    const adminTriesOwner = await admin.client.delete(
      `/api/organizations/current/members/${admin.membershipId}`,
    );
    expect(adminTriesOwner.status).toBe(403);

    const ownerRemovesPeer = await owner.client.delete(
      `/api/organizations/current/members/${admin.membershipId}`,
    );
    expect(ownerRemovesPeer.status).toBe(200);

    const members = await owner.client.get<{ members: Array<{ role: string }> }>(
      "/api/organizations/current/members",
    );
    expect(members.body.data?.members.filter((member) => member.role === "owner")).toHaveLength(1);
  });

  it("does not resolve membership ids across tenants", async () => {
    const alpha = await registerViaApi({
      email: "xt-alpha@example.com",
      organizationName: "Cross alpha",
    });
    const beta = await registerViaApi({
      email: "xt-beta@example.com",
      organizationName: "Cross beta",
    });

    const betaMembership = await findMembershipId(beta, beta.email);

    const patch = await alpha.client.patch(`/api/organizations/current/members/${betaMembership}`, {
      role: "viewer",
    });
    expect(patch.status).toBe(404);

    const remove = await alpha.client.delete(
      `/api/organizations/current/members/${betaMembership}`,
    );
    expect(remove.status).toBe(404);

    const random = await alpha.client.patch(`/api/organizations/current/members/${randomUUID()}`, {
      role: "viewer",
    });
    expect(random.status).toBe(404);
  });

  it("switches organizations only for active memberships", async () => {
    const owner = await registerViaApi({
      email: "switch-owner@example.com",
      organizationName: "Switch owner",
    });
    const member = await inviteAndAccept(owner, "switch-member@example.com", "viewer");

    const switchBack = await member.client.post<{ organization: { id: string } }>(
      "/api/organizations/switch",
      { organizationId: member.organizationId },
    );
    expect(switchBack.status).toBe(200);
    expect(switchBack.body.data?.organization.id).toBe(member.organizationId);

    const stranger = await registerViaApi({
      email: "switch-stranger@example.com",
      organizationName: "Stranger org",
    });

    const forbidden = await member.client.post("/api/organizations/switch", {
      organizationId: stranger.organizationId,
    });
    expect(forbidden.status).toBe(404);

    const unknown = await member.client.post("/api/organizations/switch", {
      organizationId: randomUUID(),
    });
    expect(unknown.status).toBe(404);
  });

  it("exposes the audit trail only to roles with audit:read", async () => {
    const owner = await registerViaApi({
      email: "audit-owner@example.com",
      organizationName: "Audit org",
    });
    const manager = await inviteAndAccept(owner, "audit-manager@example.com", "manager");

    await owner.client.post("/api/organizations/current/stores", { name: "Audited store" });

    const ownerAudit = await owner.client.get<{ entries: Array<{ action: string }> }>(
      "/api/organizations/current/audit",
    );
    expect(ownerAudit.status).toBe(200);

    const actions = ownerAudit.body.data?.entries.map((entry) => entry.action) ?? [];
    expect(actions).toEqual(
      expect.arrayContaining([
        "user.registered",
        "organization.created",
        "store.created",
        "member.invited",
        "member.accepted",
      ]),
    );

    const serialized = JSON.stringify(ownerAudit.body);
    expect(serialized).not.toContain("scrypt$");
    expect(serialized).not.toContain("ksh_session");

    const managerAudit = await manager.client.get("/api/organizations/current/audit");
    expect(managerAudit.status).toBe(403);
  });
});

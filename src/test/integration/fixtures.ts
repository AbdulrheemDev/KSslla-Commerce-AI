import type { MembershipRole } from "@/modules/identity/domain/permissions";
import { registerViaApi, type RegisteredUser } from "@/test/integration/helpers";

export interface MemberFixture extends RegisteredUser {
  membershipId: string;
}

/** Invites an email, registers that user, and accepts the invitation. */
export async function inviteAndAccept(
  owner: RegisteredUser,
  email: string,
  role: MembershipRole,
): Promise<MemberFixture> {
  const invite = await owner.client.post<{ invitePath: string; invitationId: string }>(
    "/api/organizations/current/members",
    { email, role },
  );

  if (invite.status !== 201 || !invite.body.data) {
    throw new Error(`invite failed: ${JSON.stringify(invite.body)}`);
  }

  const token = invite.body.data.invitePath.split("/").pop();
  if (!token) throw new Error("invite token missing");

  const invitee = await registerViaApi({
    email,
    name: `عضو ${email}`,
    organizationName: `مؤسسة ${email}`,
  });

  const accepted = await invitee.client.post("/api/invitations/accept", { token });
  if (accepted.status !== 200) {
    throw new Error(`accept failed: ${JSON.stringify(accepted.body)}`);
  }

  const membershipId = await findMembershipId(owner, email);

  return { ...invitee, membershipId };
}

export async function findMembershipId(owner: RegisteredUser, email: string): Promise<string> {
  const members = await owner.client.get<{
    members: Array<{ membershipId: string; email: string }>;
  }>("/api/organizations/current/members");

  const match = members.body.data?.members.find((member) => member.email === email.toLowerCase());

  if (!match) throw new Error(`membership for ${email} not found`);
  return match.membershipId;
}

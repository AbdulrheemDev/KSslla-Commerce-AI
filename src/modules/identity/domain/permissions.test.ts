import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  MEMBERSHIP_ROLES,
  PERMISSIONS,
  ROLE_LABELS_AR,
  ROLE_PERMISSIONS,
  ROLE_RANK,
  hasPermission,
  outranks,
  permissionsForRole,
  type MembershipRole,
} from "@/modules/identity/domain/permissions";

const ROLE_COLUMNS: MembershipRole[] = ["owner", "admin", "manager", "analyst", "viewer"];

function documentedMatrix(): Map<string, Record<MembershipRole, boolean>> {
  const document = readFileSync(join(process.cwd(), "docs/phase-02.md"), "utf8");
  const rows = new Map<string, Record<MembershipRole, boolean>>();

  for (const line of document.split("\n")) {
    const match = line.match(/^\|\s*`([a-z:]+)`\s*\|(.+)\|\s*$/);
    if (!match) continue;

    const permission = match[1]!;
    const cells = match[2]!
      .split("|")
      .map((cell) => cell.trim())
      .filter(Boolean);

    if (cells.length !== 5) continue;

    const assignment = {} as Record<MembershipRole, boolean>;
    ROLE_COLUMNS.forEach((role, index) => {
      assignment[role] = cells[index] === "✅";
    });

    rows.set(permission, assignment);
  }

  return rows;
}

describe("permission matrix", () => {
  it("matches the documented role matrix in docs/phase-02.md", () => {
    const documented = documentedMatrix();
    expect(documented.size).toBeGreaterThanOrEqual(13);

    for (const [permission, assignment] of documented) {
      for (const role of ROLE_COLUMNS) {
        const expected = assignment[role];
        const actual = ROLE_PERMISSIONS[role].includes(permission as never);
        expect(actual, `${role} → ${permission}`).toBe(expected);
      }
    }
  });

  it("gives every role a documented label and rank", () => {
    for (const role of MEMBERSHIP_ROLES) {
      expect(ROLE_LABELS_AR[role].length).toBeGreaterThan(0);
      expect(ROLE_RANK[role]).toBeGreaterThan(0);
      expect(permissionsForRole(role).length).toBeGreaterThan(0);
    }

    expect(ROLE_RANK.owner).toBeGreaterThan(ROLE_RANK.admin);
    expect(ROLE_RANK.admin).toBeGreaterThan(ROLE_RANK.manager);
    expect(ROLE_RANK.manager).toBeGreaterThan(ROLE_RANK.analyst);
    expect(ROLE_RANK.analyst).toBeGreaterThan(ROLE_RANK.viewer);
  });

  it("keeps billing and ownership controls with the owner", () => {
    expect(hasPermission("owner", "billing:manage")).toBe(true);
    for (const role of MEMBERSHIP_ROLES.filter((item) => item !== "owner")) {
      expect(hasPermission(role, "billing:manage")).toBe(false);
    }
  });

  it("never lets a role outrank itself", () => {
    for (const role of MEMBERSHIP_ROLES) {
      expect(outranks(role, role)).toBe(false);
    }
  });

  it("exposes no duplicates and returns copies", () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);

    const permissions = permissionsForRole("admin");
    permissions.push("billing:manage");
    expect(permissionsForRole("admin")).not.toContain("billing:manage");
  });
});

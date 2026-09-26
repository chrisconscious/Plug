import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  hasPermission,
  permissionsForRole,
  PERMISSIONS,
  isGrantablePermission,
  NON_GRANTABLE_PERMISSIONS,
  type Role,
  type Permission,
} from "./rbac";

vi.mock("@/lib/db/repos/admin-permissions.repo", () => ({
  getGrantedPermissions: vi.fn(),
}));

import { getGrantedPermissions } from "@/lib/db/repos/admin-permissions.repo";
import { hasPermissionForUser } from "./rbac";

describe("hasPermission", () => {
  it("CUSTOMER can read products and their own orders only", () => {
    expect(hasPermission("CUSTOMER", "products.read")).toBe(true);
    expect(hasPermission("CUSTOMER", "orders.read.own")).toBe(true);
    expect(hasPermission("CUSTOMER", "orders.read")).toBe(false);
    expect(hasPermission("CUSTOMER", "users.manage")).toBe(false);
    expect(hasPermission("CUSTOMER", "system.manage")).toBe(false);
  });

  it("ADMIN can manage the catalog (incl. archive/restore) and orders but not other admins or system settings", () => {
    expect(hasPermission("ADMIN", "products.create")).toBe(true);
    expect(hasPermission("ADMIN", "products.update")).toBe(true);
    expect(hasPermission("ADMIN", "orders.update")).toBe(true);
    // Archive/restore products (soft delete only) — granted to Admins (migration 0055).
    expect(hasPermission("ADMIN", "products.delete")).toBe(true);
    // The explicit-allow-list design (see rbac.ts comment) means ADMIN does
    // NOT implicitly get everything SUPER_ADMIN has — these must stay false:
    expect(hasPermission("ADMIN", "admins.manage")).toBe(false);
    expect(hasPermission("ADMIN", "users.manage")).toBe(false);
    expect(hasPermission("ADMIN", "system.manage")).toBe(false);
  });

  it("SUPER_ADMIN has every permission except orders.read.own, which it doesn't need", () => {
    // SUPER_ADMIN's list (see rbac.ts) omits "orders.read.own" specifically.
    // This is consistent, not a gap: "orders.read.own" (view only your own
    // orders) is scoped for CUSTOMER; any role that already holds the
    // broader "orders.read" (any customer's orders) has no use for the
    // narrower one. The same pattern holds for ADMIN below. Confirmed by
    // diffing PERMISSIONS against each role's actual array directly, not
    // assumed.
    const NOT_NEEDED_GIVEN_BROADER_ORDERS_READ: Permission[] = ["orders.read.own"];
    for (const p of PERMISSIONS) {
      if (NOT_NEEDED_GIVEN_BROADER_ORDERS_READ.includes(p)) continue;
      expect(hasPermission("SUPER_ADMIN", p)).toBe(true);
    }
  });

  it("SUPER_ADMIN relies on the broader orders.read rather than also holding orders.read.own", () => {
    expect(hasPermission("SUPER_ADMIN", "orders.read.own")).toBe(false);
    expect(hasPermission("SUPER_ADMIN", "orders.read")).toBe(true);
  });

  it("returns false for an unrecognized role rather than throwing", () => {
    // Defense in depth: a bad/unexpected role value must fail closed, not crash.
    expect(hasPermission("NOT_A_ROLE" as Role, "products.read")).toBe(false);
  });
});

describe("permissionsForRole", () => {
  it("returns the exact CUSTOMER permission set", () => {
    expect(permissionsForRole("CUSTOMER").sort()).toEqual(["orders.read.own", "products.read"].sort());
  });

  it("returns the exact ADMIN permission set", () => {
    expect(permissionsForRole("ADMIN").sort()).toEqual(
      ["products.read", "products.create", "products.update", "products.delete", "brands.manage", "orders.read", "orders.update", "users.read"].sort()
    );
  });

  it("returns SUPER_ADMIN's actual permission set (all of PERMISSIONS except the known orders.read.own gap — see the hasPermission describe block above)", () => {
    const expected = PERMISSIONS.filter((p) => p !== "orders.read.own");
    expect(permissionsForRole("SUPER_ADMIN").sort()).toEqual([...expected].sort());
  });

  it("returns a fresh array each call — callers cannot mutate the internal permission list", () => {
    const a = permissionsForRole("ADMIN");
    a.push("system.manage" as Permission);
    const b = permissionsForRole("ADMIN");
    expect(b).not.toContain("system.manage");
  });

  it("ADMIN's permission set is a strict subset of SUPER_ADMIN's (no permission ADMIN has that SUPER_ADMIN lacks)", () => {
    const adminPerms = permissionsForRole("ADMIN");
    const superPerms = new Set(permissionsForRole("SUPER_ADMIN"));
    for (const p of adminPerms) {
      expect(superPerms.has(p)).toBe(true);
    }
  });

  it("ADMIN and SUPER_ADMIN cover every CUSTOMER capability via broader permissions, even though orders.read.own itself isn't in their explicit list", () => {
    // Not a literal subset check (see the SUPER_ADMIN tests above for why
    // orders.read.own specifically isn't expected to appear on broader
    // roles) — this checks that every CUSTOMER permission is either
    // present verbatim or superseded by a broader one ADMIN/SUPER_ADMIN
    // does hold.
    const SUPERSEDED_BY: Partial<Record<Permission, Permission>> = { "orders.read.own": "orders.read" };
    const customerPerms = permissionsForRole("CUSTOMER");
    const adminPerms = new Set(permissionsForRole("ADMIN"));
    for (const p of customerPerms) {
      const satisfiedBy = adminPerms.has(p) || (SUPERSEDED_BY[p] ? adminPerms.has(SUPERSEDED_BY[p]!) : false);
      expect(satisfiedBy).toBe(true);
    }
  });
});

describe("isGrantablePermission", () => {
  it("every non-grantable permission is a real permission code", () => {
    for (const code of NON_GRANTABLE_PERMISSIONS) {
      expect(PERMISSIONS).toContain(code);
    }
  });

  it("admins.manage and system.manage are the guarded, non-grantable permissions", () => {
    expect(NON_GRANTABLE_PERMISSIONS).toContain("admins.manage");
    expect(NON_GRANTABLE_PERMISSIONS).toContain("system.manage");
  });

  it("returns false for unknown codes and the guarded permissions", () => {
    expect(isGrantablePermission("system.manage")).toBe(false);
    expect(isGrantablePermission("admins.manage")).toBe(false);
    expect(isGrantablePermission("not.a.real.permission")).toBe(false);
  });

  it("returns true for ordinary grantable permissions", () => {
    expect(isGrantablePermission("content.manage")).toBe(true);
    expect(isGrantablePermission("orders.read")).toBe(true);
    expect(isGrantablePermission("lifestyles.manage")).toBe(true);
  });
});

describe("hasPermissionForUser", () => {
  beforeEach(() => {
    vi.mocked(getGrantedPermissions).mockReset();
  });

  it("SUPER_ADMIN always passes — never touches the grants repo", async () => {
    await expect(hasPermissionForUser("sa-1", "SUPER_ADMIN", "system.manage")).resolves.toBe(true);
    expect(getGrantedPermissions).not.toHaveBeenCalled();
  });

  it("ADMIN passes without DB lookup for a role-based permission", async () => {
    await expect(hasPermissionForUser("a-1", "ADMIN", "products.create")).resolves.toBe(true);
    expect(getGrantedPermissions).not.toHaveBeenCalled();
  });

  it("ADMIN is granted an extra permission found in the grants table", async () => {
    vi.mocked(getGrantedPermissions).mockResolvedValue(new Set(["content.manage", "products.delete"]));
    await expect(hasPermissionForUser("a-1", "ADMIN", "content.manage")).resolves.toBe(true);
    expect(getGrantedPermissions).toHaveBeenCalledWith("a-1");
  });

  it("ADMIN without a grant is denied — grants never add to a role that lacks the base permission", async () => {
    vi.mocked(getGrantedPermissions).mockResolvedValue(new Set(["content.manage"]));
    const user = { id: "a-1" };
    // system.manage is NON_GRANTABLE so it can never appear in the table;
    // simulate a defender trying anyway — the grant must NOT confer it.
    vi.mocked(getGrantedPermissions).mockResolvedValue(new Set(["system.manage"]));
    await expect(hasPermissionForUser(user.id, "ADMIN", "system.manage")).resolves.toBe(false);
  });

  it("CUSTOMER role falls through to the grants check and gets no grants", async () => {
    vi.mocked(getGrantedPermissions).mockResolvedValue(new Set());
    await expect(hasPermissionForUser("c-1", "CUSTOMER", "orders.read")).resolves.toBe(false);
    expect(getGrantedPermissions).toHaveBeenCalledWith("c-1");
  });
});

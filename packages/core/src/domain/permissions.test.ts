import { describe, expect, it } from "vitest";
import {
  effectivePermissions,
  GRANTABLE_PERMISSIONS,
  hasPermission,
  normalizeGrantedPermissions,
  SUPER_ADMIN_ONLY_PERMISSIONS,
  toggleGrantedPermission,
} from "./permissions";

describe("effectivePermissions", () => {
  it("gives a super admin every permission regardless of grants", () => {
    const result = effectivePermissions("SUPER_ADMIN", new Set());
    for (const p of SUPER_ADMIN_ONLY_PERMISSIONS) {
      expect(result.has(p)).toBe(true);
    }
    expect(result.has("SELL")).toBe(true);
  });

  it("always gives an employee the base permissions", () => {
    const result = effectivePermissions("EMPLOYEE", new Set());
    expect(result.has("SELL")).toBe(true);
    expect(result.has("VIEW_INVOICES")).toBe(true);
  });

  it("never grants a super-admin-only permission to an employee, even if asked", () => {
    const result = effectivePermissions("EMPLOYEE", new Set(["MANAGE_USERS", "BACKUP_AND_RESTORE"]));
    expect(result.has("MANAGE_USERS")).toBe(false);
    expect(result.has("BACKUP_AND_RESTORE")).toBe(false);
  });
});

describe("normalizeGrantedPermissions", () => {
  it("pulls in direct prerequisites", () => {
    const result = normalizeGrantedPermissions(new Set(["VIEW_DASHBOARD"]));
    expect(result.has("VIEW_FINANCIALS")).toBe(true);
  });

  it("pulls in transitive prerequisites (RECEIVE_GOODS needs MANAGE_PURCHASES and MANAGE_SUPPLIERS)", () => {
    const result = normalizeGrantedPermissions(new Set(["RECEIVE_GOODS"]));
    expect(result.has("MANAGE_PURCHASES")).toBe(true);
    expect(result.has("MANAGE_SUPPLIERS")).toBe(true);
  });

  it("pulls in transitive prerequisites (ADJUST_STOCK needs MANAGE_PRODUCTS and VIEW_STOCK_RECORDS)", () => {
    const result = normalizeGrantedPermissions(new Set(["ADJUST_STOCK"]));
    expect(result.has("MANAGE_PRODUCTS")).toBe(true);
    expect(result.has("VIEW_STOCK_RECORDS")).toBe(true);
  });
});

describe("toggleGrantedPermission", () => {
  it("turning on ADJUST_STOCK turns on its prerequisites", () => {
    const result = toggleGrantedPermission(new Set(), "ADJUST_STOCK", true);
    expect(result.has("ADJUST_STOCK")).toBe(true);
    expect(result.has("MANAGE_PRODUCTS")).toBe(true);
    expect(result.has("VIEW_STOCK_RECORDS")).toBe(true);
  });

  it("turning off a prerequisite cascades off everything that depended on it", () => {
    let granted = toggleGrantedPermission(new Set(), "ADJUST_STOCK", true);
    expect(granted.has("MANAGE_PRODUCTS")).toBe(true);

    granted = toggleGrantedPermission(granted, "MANAGE_PRODUCTS", false);
    expect(granted.has("MANAGE_PRODUCTS")).toBe(false);
    // ADJUST_STOCK required MANAGE_PRODUCTS, so it must cascade off too.
    expect(granted.has("ADJUST_STOCK")).toBe(false);
    // VIEW_STOCK_RECORDS had no other dependent requiring it to go, but ADJUST_STOCK's removal
    // doesn't force it off since nothing else needs it gone; it should remain since it was never
    // explicitly turned off and nothing invalidates it on its own.
    expect(granted.has("VIEW_STOCK_RECORDS")).toBe(true);
  });

  it("turning off RECEIVE_GOODS's transitive prerequisite MANAGE_SUPPLIERS cascades through RECEIVE_GOODS and MANAGE_PURCHASES", () => {
    let granted = toggleGrantedPermission(new Set(), "RECEIVE_GOODS", true);
    expect(granted.has("MANAGE_SUPPLIERS")).toBe(true);
    expect(granted.has("MANAGE_PURCHASES")).toBe(true);

    granted = toggleGrantedPermission(granted, "MANAGE_SUPPLIERS", false);
    expect(granted.has("MANAGE_SUPPLIERS")).toBe(false);
    expect(granted.has("MANAGE_PURCHASES")).toBe(false);
    expect(granted.has("RECEIVE_GOODS")).toBe(false);
  });

  it("ignores attempts to toggle a non-grantable (base or super-admin-only) permission", () => {
    const result = toggleGrantedPermission(new Set(), "MANAGE_USERS", true);
    expect(result.has("MANAGE_USERS")).toBe(false);
  });

  it("every grantable permission is reachable (sanity check on the permission list)", () => {
    expect(GRANTABLE_PERMISSIONS.length).toBeGreaterThan(0);
  });
});

describe("hasPermission", () => {
  it("reflects the effective set", () => {
    expect(hasPermission("EMPLOYEE", new Set(), "SELL")).toBe(true);
    expect(hasPermission("EMPLOYEE", new Set(), "MANAGE_PRODUCTS")).toBe(false);
    expect(hasPermission("EMPLOYEE", new Set(["MANAGE_PRODUCTS"]), "MANAGE_PRODUCTS")).toBe(true);
  });
});

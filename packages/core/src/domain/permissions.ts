import type { Permission, Role } from "./entities";

/**
 * Permission model, ported exactly from the Android app's `Permission.kt` / `PermissionOptions`
 * (see docs — extracted from `Roybabu/Auxo`, branch `temp`). Two roles: SUPER_ADMIN (every
 * permission, unconditionally) and EMPLOYEE (BASE ∪ normalized grants).
 */

export const ALL_PERMISSIONS: readonly Permission[] = [
  "SELL",
  "VIEW_INVOICES",
  "PROCESS_RETURN",
  "CLOSE_DAY",
  "VIEW_FINANCIALS",
  "VIEW_REPORTS",
  "GST_REPORT",
  "MANAGE_LOYALTY",
  "UNLIMITED_DISCOUNT",
  "VIEW_DASHBOARD",
  "MANAGE_PRODUCTS",
  "ADJUST_STOCK",
  "VIEW_STOCK_RECORDS",
  "MANAGE_CUSTOMERS",
  "RECEIVE_ACCOUNT_PAYMENT",
  "MANAGE_SUPPLIERS",
  "MANAGE_PURCHASES",
  "RECEIVE_GOODS",
  "MANAGE_SETTINGS",
  "BACKUP_AND_RESTORE",
  "MANAGE_USERS",
  "VIEW_ACTIVITY_LOG",
];

/** Always on for any employee; never shown as a toggle. */
export const BASE_PERMISSIONS: readonly Permission[] = ["SELL", "VIEW_INVOICES"];

/** Never grantable to an employee — Super Admin only, always. */
export const SUPER_ADMIN_ONLY_PERMISSIONS: readonly Permission[] = [
  "GST_REPORT",
  "MANAGE_LOYALTY",
  "UNLIMITED_DISCOUNT",
  "BACKUP_AND_RESTORE",
  "MANAGE_USERS",
];

const baseSet = new Set(BASE_PERMISSIONS);
const superAdminOnlySet = new Set(SUPER_ADMIN_ONLY_PERMISSIONS);

export const GRANTABLE_PERMISSIONS: readonly Permission[] = ALL_PERMISSIONS.filter(
  (p) => !baseSet.has(p) && !superAdminOnlySet.has(p),
);

export type PermissionGroupName = "SALES" | "FIGURES" | "INVENTORY" | "CUSTOMERS" | "PURCHASING" | "SHOP";

/** Grouping for the employee-permission admin UI, matching the Android app's grouping. */
export const PERMISSION_GROUPS: Record<PermissionGroupName, readonly Permission[]> = {
  SALES: ["PROCESS_RETURN", "CLOSE_DAY"],
  FIGURES: ["VIEW_DASHBOARD", "VIEW_FINANCIALS", "VIEW_REPORTS"],
  INVENTORY: ["MANAGE_PRODUCTS", "VIEW_STOCK_RECORDS", "ADJUST_STOCK"],
  CUSTOMERS: ["MANAGE_CUSTOMERS", "RECEIVE_ACCOUNT_PAYMENT"],
  PURCHASING: ["MANAGE_SUPPLIERS", "MANAGE_PURCHASES", "RECEIVE_GOODS"],
  SHOP: ["MANAGE_SETTINGS", "VIEW_ACTIVITY_LOG"],
};

/**
 * Direct prerequisites for each permission: turning the key ON must also turn its values ON;
 * turning any of a permission's prerequisites OFF must also turn the permission OFF (cascades
 * transitively via `toggleGrantedPermission`).
 */
const IMPLIES: Partial<Record<Permission, readonly Permission[]>> = {
  VIEW_DASHBOARD: ["VIEW_FINANCIALS"],
  VIEW_REPORTS: ["VIEW_FINANCIALS"],
  MANAGE_PRODUCTS: ["VIEW_STOCK_RECORDS"],
  ADJUST_STOCK: ["MANAGE_PRODUCTS", "VIEW_STOCK_RECORDS"],
  RECEIVE_ACCOUNT_PAYMENT: ["MANAGE_CUSTOMERS"],
  MANAGE_PURCHASES: ["MANAGE_SUPPLIERS"],
  RECEIVE_GOODS: ["MANAGE_PURCHASES", "MANAGE_SUPPLIERS"],
};

/** Adds every transitive prerequisite of each permission already in `granted`. */
export function normalizeGrantedPermissions(granted: ReadonlySet<Permission>): Set<Permission> {
  const result = new Set<Permission>();
  for (const p of granted) {
    if (GRANTABLE_PERMISSIONS.includes(p)) result.add(p);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of [...result]) {
      for (const prereq of IMPLIES[p] ?? []) {
        if (!result.has(prereq)) {
          result.add(prereq);
          changed = true;
        }
      }
    }
  }
  return result;
}

/**
 * Toggles a single permission on/off within a granted set, applying implication rules: turning
 * one on pulls in its prerequisites; turning one off cascades off anything that now has an
 * unmet prerequisite. Returns a new set; `granted` is not mutated.
 */
export function toggleGrantedPermission(
  granted: ReadonlySet<Permission>,
  permission: Permission,
  enabled: boolean,
): Set<Permission> {
  if (!GRANTABLE_PERMISSIONS.includes(permission)) {
    return new Set(granted);
  }
  const next = new Set(granted);
  if (enabled) {
    next.add(permission);
    return normalizeGrantedPermissions(next);
  }

  next.delete(permission);
  // Cascade off: repeatedly drop any permission whose prerequisites are no longer fully met.
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of [...next]) {
      const prereqs = IMPLIES[p];
      if (prereqs && !prereqs.every((req) => next.has(req))) {
        next.delete(p);
        changed = true;
      }
    }
  }
  return next;
}

/** The full set of permissions a user effectively has, given their role and (for employees) grants. */
export function effectivePermissions(role: Role, granted: ReadonlySet<Permission>): Set<Permission> {
  if (role === "SUPER_ADMIN") {
    return new Set(ALL_PERMISSIONS);
  }
  const result = normalizeGrantedPermissions(granted);
  for (const p of BASE_PERMISSIONS) result.add(p);
  return result;
}

export function hasPermission(role: Role, granted: ReadonlySet<Permission>, permission: Permission): boolean {
  return effectivePermissions(role, granted).has(permission);
}

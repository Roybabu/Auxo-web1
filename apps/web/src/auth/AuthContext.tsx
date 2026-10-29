import {
  effectivePermissions,
  hashPin,
  generateRecoveryCodes,
  verifyPin,
  type Permission,
  type ShopCategoryType,
  type User,
} from "@auxo/core";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useDatabase } from "../db/DatabaseContext";
import { ShopRepository, type ShopSettings } from "../db/shopRepository";
import { UserRepository } from "../db/userRepository";

export type BootstrapStatus =
  | "checking"
  | "needs-setup"
  | "awaiting-recovery-ack"
  | "needs-sign-in"
  | "signed-in";

interface AuthState {
  status: BootstrapStatus;
  currentUser: User | null;
  users: User[];
  shop: ShopSettings | null;
  permissions: Set<Permission>;
  error: string | null;
}

interface AuthContextValue extends AuthState {
  completeSetup(input: {
    storeName: string;
    categories: ShopCategoryType[];
    adminName: string;
    pin: string;
  }): Promise<{ recoveryCodes: string[] }>;
  acknowledgeRecoveryCodes(): void;
  signIn(userId: string, pin: string): Promise<boolean>;
  signOut(): void;
  addEmployee(input: { name: string; pin: string; grantedPermissions: Permission[] }): Promise<void>;
  refreshUsers(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function newId(): string {
  return crypto.randomUUID();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { status: dbStatus, db } = useDatabase();
  const [state, setState] = useState<AuthState>({
    status: "checking",
    currentUser: null,
    users: [],
    shop: null,
    permissions: new Set(),
    error: null,
  });

  async function loadBootstrapState(): Promise<void> {
    if (!db) return;
    const userRepo = new UserRepository(db);
    const shopRepo = new ShopRepository(db);
    const [hasAdmin, users, shop] = await Promise.all([
      userRepo.hasAnySuperAdmin(),
      userRepo.listActive(),
      shopRepo.get(),
    ]);
    setState((prev) => ({
      ...prev,
      status: hasAdmin ? "needs-sign-in" : "needs-setup",
      users,
      shop,
    }));
  }

  useEffect(() => {
    if (dbStatus === "ready") {
      void loadBootstrapState();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbStatus, db]);

  async function completeSetup(input: {
    storeName: string;
    categories: ShopCategoryType[];
    adminName: string;
    pin: string;
  }): Promise<{ recoveryCodes: string[] }> {
    if (!db) throw new Error("Database is not ready");
    const now = Date.now();
    const { pinHash, pinSalt } = await hashPin(input.pin);
    const { plaintext: recoveryCodes, hashes: recoveryCodeHashes } = await generateRecoveryCodes();

    const admin: User = {
      id: newId(),
      androidId: null,
      name: input.adminName,
      role: "SUPER_ADMIN",
      grantedPermissions: [],
      pinHash,
      pinSalt,
      recoveryCodeHashes,
      active: true,
      lastSignedInAt: now,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };

    const userRepo = new UserRepository(db);
    const shopRepo = new ShopRepository(db);
    await userRepo.create(admin);
    await shopRepo.save({ storeName: input.storeName, categories: input.categories, createdAt: now });

    setState({
      status: "awaiting-recovery-ack",
      currentUser: admin,
      users: [admin],
      shop: { storeName: input.storeName, categories: input.categories, createdAt: now },
      permissions: effectivePermissions(admin.role, new Set(admin.grantedPermissions)),
      error: null,
    });

    return { recoveryCodes };
  }

  function acknowledgeRecoveryCodes(): void {
    setState((prev) => (prev.status === "awaiting-recovery-ack" ? { ...prev, status: "signed-in" } : prev));
  }

  async function signIn(userId: string, pin: string): Promise<boolean> {
    if (!db) return false;
    const userRepo = new UserRepository(db);
    const user = await userRepo.findById(userId);
    if (!user || !user.active) return false;
    const ok = await verifyPin(pin, { pinHash: user.pinHash, pinSalt: user.pinSalt });
    if (!ok) return false;

    const updated: User = { ...user, lastSignedInAt: Date.now(), updatedAt: Date.now() };
    await userRepo.update(updated);
    setState((prev) => ({
      ...prev,
      status: "signed-in",
      currentUser: updated,
      permissions: effectivePermissions(updated.role, new Set(updated.grantedPermissions)),
    }));
    return true;
  }

  function signOut(): void {
    setState((prev) => ({ ...prev, status: "needs-sign-in", currentUser: null, permissions: new Set() }));
  }

  async function addEmployee(input: {
    name: string;
    pin: string;
    grantedPermissions: Permission[];
  }): Promise<void> {
    if (!db) throw new Error("Database is not ready");
    const now = Date.now();
    const { pinHash, pinSalt } = await hashPin(input.pin);
    const employee: User = {
      id: newId(),
      androidId: null,
      name: input.name,
      role: "EMPLOYEE",
      grantedPermissions: input.grantedPermissions,
      pinHash,
      pinSalt,
      recoveryCodeHashes: [],
      active: true,
      lastSignedInAt: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    const userRepo = new UserRepository(db);
    await userRepo.create(employee);
    await loadBootstrapState();
  }

  async function refreshUsers(): Promise<void> {
    await loadBootstrapState();
  }

  const value: AuthContextValue = {
    ...state,
    completeSetup,
    acknowledgeRecoveryCodes,
    signIn,
    signOut,
    addEmployee,
    refreshUsers,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}

import { useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { UserManagementScreen } from "./UserManagementScreen";
import styles from "./HomeScreen.module.css";

export function HomeScreen() {
  const { currentUser, shop, permissions, signOut } = useAuth();
  const [showUserManagement, setShowUserManagement] = useState(false);

  if (showUserManagement) {
    return <UserManagementScreen onBack={() => setShowUserManagement(false)} />;
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.greeting}>{shop?.storeName}</h1>
          <p className={styles.role}>
            Signed in as {currentUser?.name} ({currentUser?.role === "SUPER_ADMIN" ? "Owner" : "Employee"})
          </p>
        </div>
        <div className={styles.actions}>
          {permissions.has("MANAGE_USERS") && (
            <button type="button" className={styles.linkButton} onClick={() => setShowUserManagement(true)}>
              Manage users
            </button>
          )}
          <button type="button" className={styles.linkButton} onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>

      <div className={styles.card}>
        <p className={styles.cardTitle}>Your permissions</p>
        <div className={styles.permissionList}>
          {[...permissions].sort().map((p) => (
            <span key={p} className={styles.permissionBadge}>
              {p}
            </span>
          ))}
        </div>
      </div>
    </main>
  );
}

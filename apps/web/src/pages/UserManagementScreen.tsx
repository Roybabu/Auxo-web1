import { PERMISSION_GROUPS, toggleGrantedPermission, validatePinFormat, type Permission } from "@auxo/core";
import { useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthContext";
import styles from "./UserManagementScreen.module.css";

const GROUP_LABELS: Record<keyof typeof PERMISSION_GROUPS, string> = {
  SALES: "Sales",
  FIGURES: "Figures",
  INVENTORY: "Inventory",
  CUSTOMERS: "Customers",
  PURCHASING: "Purchasing",
  SHOP: "Shop",
};

export function UserManagementScreen({ onBack }: { onBack: () => void }) {
  const { users, addEmployee } = useAuth();
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [granted, setGranted] = useState<Set<Permission>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function toggle(permission: Permission) {
    setGranted((prev) => toggleGrantedPermission(prev, permission, !prev.has(permission)));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (name.trim().length === 0) return setError("Enter a name");
    const pinError = validatePinFormat(pin);
    if (pinError) return setError(pinError);

    setSubmitting(true);
    try {
      await addEmployee({ name: name.trim(), pin, grantedPermissions: [...granted] });
      setName("");
      setPin("");
      setGranted(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <button type="button" className={styles.backButton} onClick={onBack}>
          ← Back
        </button>
        <h1 className={styles.title}>Users</h1>
      </header>

      <div className={styles.list}>
        {users.map((user) => (
          <div key={user.id} className={styles.listItem}>
            <span>
              <span className={styles.listItemName}>{user.name}</span>
              <span className={styles.listItemRole}>
                {user.role === "SUPER_ADMIN" ? "Owner" : "Employee"}
              </span>
            </span>
          </div>
        ))}
      </div>

      <form className={styles.form} onSubmit={handleSubmit}>
        <p className={styles.formTitle}>Add employee</p>
        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.field}>
          <label className={styles.label} htmlFor="employeeName">
            Name
          </label>
          <input
            id="employeeName"
            className={styles.input}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="employeePin">
            PIN (4-8 digits)
          </label>
          <input
            id="employeePin"
            className={styles.input}
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          />
        </div>

        {(Object.keys(PERMISSION_GROUPS) as (keyof typeof PERMISSION_GROUPS)[]).map((group) => (
          <div key={group}>
            <p className={styles.groupTitle}>{GROUP_LABELS[group]}</p>
            {PERMISSION_GROUPS[group].map((permission) => (
              <label key={permission} className={styles.permissionRow}>
                <input
                  type="checkbox"
                  checked={granted.has(permission)}
                  onChange={() => toggle(permission)}
                />
                <span className={styles.permissionLabel}>{permission}</span>
              </label>
            ))}
          </div>
        ))}

        <button type="submit" className={styles.button} disabled={submitting}>
          {submitting ? "Adding…" : "Add employee"}
        </button>
      </form>
    </main>
  );
}

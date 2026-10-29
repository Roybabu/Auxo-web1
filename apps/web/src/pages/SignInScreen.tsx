import { useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { PinPad } from "../components/PinPad";
import styles from "./SignInScreen.module.css";

export function SignInScreen() {
  const { users, shop, signIn } = useAuth();
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handlePin(pin: string) {
    if (!selectedUserId) return;
    const ok = await signIn(selectedUserId, pin);
    if (!ok) setError("Wrong PIN");
    else setError(null);
  }

  if (!selectedUserId) {
    return (
      <main className={styles.page}>
        <div className={styles.card}>
          <h1 className={styles.title}>{shop?.storeName ?? "Sign in"}</h1>
          <div className={styles.userGrid}>
            {users.map((user) => (
              <button
                key={user.id}
                type="button"
                className={styles.userButton}
                onClick={() => setSelectedUserId(user.id)}
              >
                {user.name}
                <span className={styles.userRole}>
                  {user.role === "SUPER_ADMIN" ? "Owner" : "Employee"}
                </span>
              </button>
            ))}
          </div>
        </div>
      </main>
    );
  }

  const selectedUser = users.find((u) => u.id === selectedUserId);

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <button type="button" className={styles.backButton} onClick={() => setSelectedUserId(null)}>
          ← Back
        </button>
        <h1 className={styles.title}>{selectedUser?.name}</h1>
        <PinPad errorMessage={error} onSubmit={handlePin} />
      </div>
    </main>
  );
}

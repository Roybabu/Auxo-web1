import { formatMinorUnits, money, type Customer } from "@auxo/core";
import { useEffect, useState, type FormEvent } from "react";
import { useDatabase } from "../db/DatabaseContext";
import { CustomerLedgerRepository, CustomerRepository } from "../db/customerRepository";
import { CustomerDetailScreen } from "./CustomerDetailScreen";
import styles from "./CustomerListScreen.module.css";

function rupees(m: number): string {
  return `₹${formatMinorUnits(money(m))}`;
}

function newId(): string {
  return crypto.randomUUID();
}

export function CustomersScreen({ onBack }: { onBack: () => void }) {
  const { db } = useDatabase();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [adding, setAdding] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [creditLimit, setCreditLimit] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function reload() {
    if (!db) return;
    const repo = new CustomerRepository(db);
    const list = await repo.listActive();
    setCustomers(list);
    const ledgerRepo = new CustomerLedgerRepository(db);
    const entries = await Promise.all(list.map((c) => ledgerRepo.aging(c.id)));
    const map: Record<string, number> = {};
    list.forEach((c, i) => {
      map[c.id] = entries[i]!.balanceMinor as number;
    });
    setBalances(map);
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (name.trim().length === 0) return setError("Enter a name");
    if (!db) return;

    setSubmitting(true);
    try {
      const now = Date.now();
      const customer: Customer = {
        id: newId(),
        androidId: null,
        name: name.trim(),
        phone: phone.trim() || null,
        email: null,
        gstin: null,
        stateCode: null,
        address: null,
        creditLimitMinor: creditLimit.trim() ? money(Math.round(Number.parseFloat(creditLimit) * 100)) : null,
        notes: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      await new CustomerRepository(db).create(customer);
      setName("");
      setPhone("");
      setCreditLimit("");
      setAdding(false);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (selectedId) {
    return (
      <CustomerDetailScreen
        customerId={selectedId}
        onBack={() => {
          setSelectedId(null);
          void reload();
        }}
      />
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <button type="button" className={styles.backButton} onClick={onBack}>
            ← Back
          </button>
          <h1 className={styles.title}>Customers</h1>
        </div>
        <button type="button" className={styles.addButton} onClick={() => setAdding((v) => !v)}>
          {adding ? "Cancel" : "Add customer"}
        </button>
      </header>

      {adding && (
        <form className={styles.form} onSubmit={handleSubmit}>
          {error && <p className={styles.error}>{error}</p>}
          <div className={styles.field}>
            <label className={styles.label} htmlFor="custName">
              Name
            </label>
            <input id="custName" className={styles.input} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="custPhone">
              Phone
            </label>
            <input id="custPhone" className={styles.input} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="custCreditLimit">
              Credit limit (₹, leave blank for no limit)
            </label>
            <input
              id="custCreditLimit"
              className={styles.input}
              inputMode="decimal"
              value={creditLimit}
              onChange={(e) => setCreditLimit(e.target.value)}
            />
          </div>
          <button type="submit" className={styles.button} disabled={submitting}>
            {submitting ? "Saving…" : "Save customer"}
          </button>
        </form>
      )}

      {customers.length === 0 ? (
        <p className={styles.empty}>No customers yet.</p>
      ) : (
        <div>
          {customers.map((c) => {
            const balance = balances[c.id] ?? 0;
            return (
              <button key={c.id} type="button" className={styles.row} onClick={() => setSelectedId(c.id)}>
                <div>
                  <p className={styles.rowName}>{c.name}</p>
                  {c.phone && <p className={styles.rowMeta}>{c.phone}</p>}
                </div>
                <span className={[styles.balance, balance > 0 ? styles.balanceOwed : styles.balanceClear].join(" ")}>
                  {balance > 0 ? rupees(balance) : "settled"}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </main>
  );
}

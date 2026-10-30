import { formatMinorUnits, money, type Customer, type CustomerLedgerEntry } from "@auxo/core";
import { useEffect, useState } from "react";
import { useDatabase } from "../db/DatabaseContext";
import { CustomerLedgerRepository, CustomerRepository } from "../db/customerRepository";
import styles from "./CustomerDetailScreen.module.css";

function rupees(m: number): string {
  return `₹${formatMinorUnits(money(m))}`;
}

function newId(): string {
  return crypto.randomUUID();
}

export function CustomerDetailScreen({ customerId, onBack }: { customerId: string; onBack: () => void }) {
  const { db } = useDatabase();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [entries, setEntries] = useState<CustomerLedgerEntry[]>([]);
  const [balance, setBalance] = useState(0);
  const [buckets, setBuckets] = useState({ upTo7DaysMinor: 0, upTo30DaysMinor: 0, over30DaysMinor: 0 });

  async function reload() {
    if (!db) return;
    const customerRepo = new CustomerRepository(db);
    const ledgerRepo = new CustomerLedgerRepository(db);
    const [c, ledgerEntries, aging] = await Promise.all([
      customerRepo.findById(customerId),
      ledgerRepo.listForCustomer(customerId),
      ledgerRepo.aging(customerId),
    ]);
    setCustomer(c);
    setEntries([...ledgerEntries].reverse());
    setBalance(aging.balanceMinor as unknown as number);
    setBuckets({
      upTo7DaysMinor: aging.buckets.upTo7DaysMinor as unknown as number,
      upTo30DaysMinor: aging.buckets.upTo30DaysMinor as unknown as number,
      over30DaysMinor: aging.buckets.over30DaysMinor as unknown as number,
    });
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, customerId]);

  async function handleReceivePayment() {
    if (!db || !customer) return;
    const amountText = window.prompt(`Receive payment from ${customer.name} (₹)`);
    if (!amountText) return;
    const amount = Number.parseFloat(amountText);
    if (!Number.isFinite(amount) || amount <= 0) return;
    if (Math.round(amount * 100) > balance) {
      window.alert("That's more than the customer owes — overpayment isn't allowed.");
      return;
    }

    const now = Date.now();
    const entry: CustomerLedgerEntry = {
      id: newId(),
      androidId: null,
      customerId: customer.id,
      type: "PAYMENT",
      amountMinor: money(-Math.round(amount * 100)),
      invoiceId: null,
      method: "CASH",
      reference: null,
      note: null,
      points: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    await new CustomerLedgerRepository(db).add(entry);
    await reload();
  }

  if (!customer) return null;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <button type="button" className={styles.backButton} onClick={onBack}>
          ← Back
        </button>
        <h1 className={styles.title}>{customer.name}</h1>
      </header>

      <div className={styles.balanceCard}>
        <div>
          <p className={styles.balanceLabel}>{balance > 0 ? "Owes" : "Balance"}</p>
          <p className={[styles.balanceValue, balance > 0 ? styles.balanceOwed : ""].join(" ")}>{rupees(balance)}</p>
        </div>
        {balance > 0 && (
          <button type="button" className={styles.receiveButton} onClick={handleReceivePayment}>
            Receive payment
          </button>
        )}
      </div>

      {balance > 0 && (
        <div className={styles.agingRow}>
          <div className={styles.agingBucket}>
            <p className={styles.agingBucketLabel}>0-7 days</p>
            <p className={styles.agingBucketValue}>{rupees(buckets.upTo7DaysMinor)}</p>
          </div>
          <div className={styles.agingBucket}>
            <p className={styles.agingBucketLabel}>8-30 days</p>
            <p className={styles.agingBucketValue}>{rupees(buckets.upTo30DaysMinor)}</p>
          </div>
          <div className={styles.agingBucket}>
            <p className={styles.agingBucketLabel}>Over 30 days</p>
            <p className={styles.agingBucketValue}>{rupees(buckets.over30DaysMinor)}</p>
          </div>
        </div>
      )}

      <p className={styles.sectionTitle}>History</p>
      {entries.length === 0 ? (
        <p className={styles.ledgerType}>No activity yet.</p>
      ) : (
        entries.map((entry) => {
          const signed = entry.amountMinor as unknown as number;
          const isCharge = signed > 0;
          return (
            <div key={entry.id} className={styles.ledgerRow}>
              <div>
                <span className={styles.ledgerType}>{entry.type.replace(/_/g, " ")}</span>
                <span className={styles.ledgerDate}>{new Date(entry.createdAt).toLocaleDateString()}</span>
              </div>
              <span className={[styles.ledgerAmount, isCharge ? styles.amountCharge : styles.amountSettle].join(" ")}>
                {isCharge ? "+" : "−"}
                {rupees(Math.abs(signed))}
              </span>
            </div>
          );
        })
      )}
    </main>
  );
}

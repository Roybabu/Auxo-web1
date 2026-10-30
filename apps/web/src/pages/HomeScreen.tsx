import { formatMinorUnits, money, resolvePeriodRange, type Permission } from "@auxo/core";
import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { useDatabase } from "../db/DatabaseContext";
import { ReportRepository } from "../db/reportRepository";
import { useTheme, type ThemePreference } from "../theme/useTheme";
import { BackupScreen } from "./BackupScreen";
import { BillingScreen } from "./BillingScreen";
import { CustomersScreen } from "./CustomersScreen";
import { InventoryListScreen } from "./InventoryListScreen";
import { ReportsScreen } from "./ReportsScreen";
import { UserManagementScreen } from "./UserManagementScreen";
import styles from "./HomeScreen.module.css";

type SubScreen = "none" | "users" | "inventory" | "billing" | "customers" | "reports" | "backup";

interface Tile {
  screen: Exclude<SubScreen, "none">;
  label: string;
  hint: string;
  primary?: boolean;
  allowed: (has: (p: Permission) => boolean) => boolean;
}

const TILES: Tile[] = [
  { screen: "billing", label: "New bill", hint: "Ring up a sale", primary: true, allowed: (has) => has("SELL") },
  {
    screen: "inventory",
    label: "Products",
    hint: "Items and stock",
    allowed: (has) => has("MANAGE_PRODUCTS") || has("VIEW_STOCK_RECORDS"),
  },
  { screen: "customers", label: "Customers", hint: "Credit book and dues", allowed: (has) => has("MANAGE_CUSTOMERS") },
  { screen: "reports", label: "Reports", hint: "Sales, stock, GST", allowed: (has) => has("VIEW_REPORTS") },
  { screen: "users", label: "Team", hint: "Staff and permissions", allowed: (has) => has("MANAGE_USERS") },
  { screen: "backup", label: "Backup", hint: "Save or restore data", allowed: (has) => has("BACKUP_AND_RESTORE") },
];

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "system", label: "System" },
];

interface Summary {
  salesTodayMinor: number;
  billsToday: number;
  duesMinor: number;
  lowStockCount: number;
}

function rupees(minor: number): string {
  return `₹${formatMinorUnits(money(minor))}`;
}

export function HomeScreen() {
  const { currentUser, shop, permissions, signOut } = useAuth();
  const { db } = useDatabase();
  const [theme, setTheme] = useTheme();
  const [subScreen, setSubScreen] = useState<SubScreen>("none");
  const [summary, setSummary] = useState<Summary | null>(null);

  const has = (p: Permission) => permissions.has(p);
  const showSummary = has("VIEW_DASHBOARD");

  useEffect(() => {
    if (!db || !showSummary || subScreen !== "none") return;
    let cancelled = false;
    const repo = new ReportRepository(db);
    void Promise.all([
      repo.salesSummary(resolvePeriodRange("TODAY", new Date())),
      repo.customerBalances(),
      repo.lowStock(),
    ]).then(([sales, balances, low]) => {
      if (cancelled) return;
      setSummary({
        salesTodayMinor: sales.grandTotalMinor,
        billsToday: sales.bills,
        duesMinor: balances.reduce((sum, b) => sum + b.balanceMinor, 0),
        lowStockCount: low.length,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [db, showSummary, subScreen]);

  const back = () => setSubScreen("none");
  if (subScreen === "users") return <UserManagementScreen onBack={back} />;
  if (subScreen === "inventory") return <InventoryListScreen onBack={back} />;
  if (subScreen === "billing") return <BillingScreen onBack={back} />;
  if (subScreen === "customers") return <CustomersScreen onBack={back} />;
  if (subScreen === "reports") return <ReportsScreen onBack={back} />;
  if (subScreen === "backup") return <BackupScreen onBack={back} />;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.greeting}>{shop?.storeName}</h1>
          <p className={styles.role}>
            {currentUser?.name} · {currentUser?.role === "SUPER_ADMIN" ? "Owner" : "Employee"}
          </p>
        </div>
        <button type="button" className={styles.signOut} onClick={signOut}>
          Sign out
        </button>
      </header>

      {showSummary && (
        <section className={styles.summary} aria-label="Today at a glance">
          <div className={styles.stat}>
            <p className={styles.statLabel}>Sales today</p>
            <p className={styles.statValue}>{summary ? rupees(summary.salesTodayMinor) : "—"}</p>
            <p className={styles.statMeta}>{summary ? `${summary.billsToday} bills` : ""}</p>
          </div>
          <div className={styles.stat}>
            <p className={styles.statLabel}>Customers owe</p>
            <p className={[styles.statValue, summary && summary.duesMinor > 0 ? styles.owed : ""].join(" ")}>
              {summary ? rupees(summary.duesMinor) : "—"}
            </p>
            <p className={styles.statMeta}>across the credit book</p>
          </div>
          <div className={styles.stat}>
            <p className={styles.statLabel}>Low stock</p>
            <p className={styles.statValue}>{summary ? summary.lowStockCount : "—"}</p>
            <p className={styles.statMeta}>{summary?.lowStockCount === 1 ? "item to reorder" : "items to reorder"}</p>
          </div>
        </section>
      )}

      <nav className={styles.grid} aria-label="Main actions">
        {TILES.filter((t) => t.allowed(has)).map((tile) => (
          <button
            key={tile.screen}
            type="button"
            className={[styles.tile, tile.primary ? styles.tilePrimary : ""].join(" ")}
            onClick={() => setSubScreen(tile.screen)}
          >
            <span className={styles.tileLabel}>{tile.label}</span>
            <span className={styles.tileHint}>{tile.hint}</span>
          </button>
        ))}
      </nav>

      <div className={styles.themeRow} role="group" aria-label="Theme">
        <span className={styles.themeLabel}>Theme</span>
        <div className={styles.segmented}>
          {THEME_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={theme === option.value}
              className={[styles.segment, theme === option.value ? styles.segmentActive : ""].join(" ")}
              onClick={() => setTheme(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}

import { buildCsv, formatCsvDate, formatMinorUnits, money, resolvePeriodRange, type ReportPeriodPreset } from "@auxo/core";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { useDatabase } from "../db/DatabaseContext";
import { ReportRepository } from "../db/reportRepository";
import styles from "./ReportsScreen.module.css";

type ReportType =
  | "SALES_SUMMARY"
  | "ITEM_SALES"
  | "COLLECTIONS"
  | "GST_RATES"
  | "HSN_SUMMARY"
  | "STOCK_MOVEMENTS"
  | "WASTAGE"
  | "STOCK_VALUE"
  | "LOW_STOCK"
  | "EXPIRY"
  | "CUSTOMER_BALANCES"
  | "CUSTOMER_AGING";

const PERIOD_BASED: ReadonlySet<ReportType> = new Set([
  "SALES_SUMMARY",
  "ITEM_SALES",
  "COLLECTIONS",
  "GST_RATES",
  "HSN_SUMMARY",
  "STOCK_MOVEMENTS",
  "WASTAGE",
]);

const REPORT_LABELS: Record<ReportType, string> = {
  SALES_SUMMARY: "Sales summary",
  ITEM_SALES: "Item sales",
  COLLECTIONS: "Collections",
  GST_RATES: "GST by rate",
  HSN_SUMMARY: "HSN summary",
  STOCK_MOVEMENTS: "Stock movements",
  WASTAGE: "Wastage",
  STOCK_VALUE: "Stock value",
  LOW_STOCK: "Low stock",
  EXPIRY: "Expiring soon",
  CUSTOMER_BALANCES: "Customer balances",
  CUSTOMER_AGING: "Customer aging",
};

const PERIOD_LABELS: Record<ReportPeriodPreset, string> = {
  TODAY: "Today",
  YESTERDAY: "Yesterday",
  LAST_7_DAYS: "Last 7 days",
  THIS_MONTH: "This month",
  LAST_MONTH: "Last month",
  THIS_FINANCIAL_YEAR: "This financial year",
  ALL: "All time",
  CUSTOM: "Custom",
};

interface ReportResult {
  headers: string[];
  rows: (string | number)[][];
  summaryCards?: { label: string; value: string }[];
}

function epochDayOf(date: Date): number {
  return Math.floor(date.getTime() / 86_400_000);
}

export function ReportsScreen({ onBack }: { onBack: () => void }) {
  const { db } = useDatabase();
  const { permissions } = useAuth();
  const [reportType, setReportType] = useState<ReportType>("SALES_SUMMARY");
  const [period, setPeriod] = useState<ReportPeriodPreset>("TODAY");
  const [result, setResult] = useState<ReportResult | null>(null);

  const availableTypes = useMemo(() => {
    const all = Object.keys(REPORT_LABELS) as ReportType[];
    if (permissions.has("GST_REPORT")) return all;
    return all.filter((t) => t !== "GST_RATES" && t !== "HSN_SUMMARY");
  }, [permissions]);

  useEffect(() => {
    if (!db) return;
    void loadReport(reportType, period);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, reportType, period]);

  async function loadReport(type: ReportType, periodPreset: ReportPeriodPreset): Promise<void> {
    if (!db) return;
    const repo = new ReportRepository(db);
    const range = resolvePeriodRange(periodPreset, new Date());

    switch (type) {
      case "SALES_SUMMARY": {
        const s = await repo.salesSummary(range);
        setResult({
          headers: [],
          rows: [],
          summaryCards: [
            { label: "Bills", value: String(s.bills) },
            { label: "Subtotal", value: rupees(s.subtotalMinor) },
            { label: "Discount", value: rupees(s.discountMinor) },
            { label: "Tax", value: rupees(s.taxMinor) },
            { label: "Total", value: rupees(s.grandTotalMinor) },
          ],
        });
        return;
      }
      case "ITEM_SALES": {
        const rows = await repo.itemSales(range);
        setResult({
          headers: ["Product", "Quantity", "Revenue"],
          rows: rows.map((r) => [r.productName, r.quantity, rupees(r.revenueMinor)]),
        });
        return;
      }
      case "COLLECTIONS": {
        const rows = await repo.collections(range);
        setResult({ headers: ["Method", "Amount"], rows: rows.map((r) => [r.method, rupees(r.amountMinor)]) });
        return;
      }
      case "GST_RATES": {
        const rows = await repo.gstRates(range);
        setResult({
          headers: ["Rate", "Taxable", "CGST", "SGST", "IGST"],
          rows: rows.map((r) => [
            `${(r.gstRateBp / 100).toFixed(2)}%`,
            rupees(r.taxableMinor),
            rupees(r.cgstMinor),
            rupees(r.sgstMinor),
            rupees(r.igstMinor),
          ]),
        });
        return;
      }
      case "HSN_SUMMARY": {
        const rows = await repo.hsnSummary(range);
        setResult({
          headers: ["HSN", "Taxable", "Tax"],
          rows: rows.map((r) => [r.hsnCode, rupees(r.taxableMinor), rupees(r.taxMinor)]),
        });
        return;
      }
      case "STOCK_MOVEMENTS":
      case "WASTAGE": {
        const rows = await repo.stockMovements(range, type === "WASTAGE" ? "DAMAGED" : undefined);
        setResult({
          headers: ["Date", "Product", "Reason", "Change", "Note"],
          rows: rows.map((r) => [
            new Date(r.createdAt).toLocaleDateString(),
            r.productName,
            r.reason,
            r.quantityChange,
            r.note ?? "",
          ]),
        });
        return;
      }
      case "STOCK_VALUE": {
        const rows = await repo.stockValue();
        const total = rows.reduce((a, r) => a + r.valueMinor, 0);
        setResult({
          headers: ["Product", "Variant", "Quantity", "Unit cost", "Value"],
          rows: rows.map((r) => [r.productName, r.variantLabel ?? "", r.quantity, rupees(r.costMinor), rupees(r.valueMinor)]),
          summaryCards: [{ label: "Total stock value", value: rupees(total) }],
        });
        return;
      }
      case "LOW_STOCK": {
        const rows = await repo.lowStock();
        setResult({
          headers: ["Product", "Variant", "Quantity", "Threshold"],
          rows: rows.map((r) => [r.productName, r.variantLabel ?? "", r.quantity, r.threshold]),
        });
        return;
      }
      case "EXPIRY": {
        const rows = await repo.expiringWithin(30, epochDayOf(new Date()));
        setResult({
          headers: ["Product", "Variant", "Expiry day", "Quantity"],
          rows: rows.map((r) => [r.productName, r.variantLabel ?? "", r.expiryEpochDay, r.quantity]),
        });
        return;
      }
      case "CUSTOMER_BALANCES": {
        const rows = await repo.customerBalances();
        setResult({ headers: ["Customer", "Balance"], rows: rows.map((r) => [r.name, rupees(r.balanceMinor)]) });
        return;
      }
      case "CUSTOMER_AGING": {
        const rows = await repo.customerAging();
        setResult({
          headers: ["Customer", "0-7 days", "8-30 days", "Over 30 days", "Total"],
          rows: rows.map((r) => [
            r.name,
            rupees(r.upTo7DaysMinor),
            rupees(r.upTo30DaysMinor),
            rupees(r.over30DaysMinor),
            rupees(r.balanceMinor),
          ]),
        });
        return;
      }
    }
  }

  function exportCsv(): void {
    if (!result) return;
    const headers = result.summaryCards ? result.summaryCards.map((c) => c.label) : result.headers;
    const rawRows = result.summaryCards ? [result.summaryCards.map((c) => c.value)] : result.rows;
    // Display values are formatted with a ₹ prefix for readability; CSV wants plain 2-decimal
    // amounts (RFC 4180), so strip the currency symbol here rather than carrying it into export.
    const rows = rawRows.map((row) => row.map((cell) => (typeof cell === "string" ? cell.replace(/₹/g, "") : cell)));
    const csv = buildCsv(headers, rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${reportType.toLowerCase()}-${formatCsvDate(Date.now())}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <button type="button" className={styles.backButton} onClick={onBack}>
            ← Back
          </button>
          <h1 className={styles.title}>Reports</h1>
        </div>
      </header>

      <div className={styles.controls}>
        <select className={styles.select} value={reportType} onChange={(e) => setReportType(e.target.value as ReportType)}>
          {availableTypes.map((t) => (
            <option key={t} value={t}>
              {REPORT_LABELS[t]}
            </option>
          ))}
        </select>
        {PERIOD_BASED.has(reportType) && (
          <select className={styles.select} value={period} onChange={(e) => setPeriod(e.target.value as ReportPeriodPreset)}>
            {(Object.keys(PERIOD_LABELS) as ReportPeriodPreset[])
              .filter((p) => p !== "CUSTOM")
              .map((p) => (
                <option key={p} value={p}>
                  {PERIOD_LABELS[p]}
                </option>
              ))}
          </select>
        )}
        <button type="button" className={styles.exportButton} onClick={exportCsv}>
          Export CSV
        </button>
      </div>

      {result?.summaryCards && (
        <div className={styles.summaryRow}>
          {result.summaryCards.map((c) => (
            <div key={c.label} className={styles.summaryCard}>
              <p className={styles.summaryLabel}>{c.label}</p>
              <p className={styles.summaryValue}>{c.value}</p>
            </div>
          ))}
        </div>
      )}

      {result && result.headers.length > 0 && (
        <>
          {result.rows.length === 0 ? (
            <p className={styles.empty}>No data for this period.</p>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  {result.headers.map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td key={j}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </main>
  );
}

function rupees(minor: number): string {
  return `₹${formatMinorUnits(money(minor))}`;
}

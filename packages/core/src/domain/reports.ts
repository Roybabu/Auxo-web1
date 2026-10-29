import { formatMinorUnits, type Money } from "../money";
import { financialYearStart } from "./invoiceNumbering";

/**
 * Report period presets and CSV formatting, matching the extracted feature list: TODAY,
 * YESTERDAY, LAST_7_DAYS, THIS_MONTH, LAST_MONTH, THIS_FINANCIAL_YEAR, ALL, CUSTOM; CSV export
 * per RFC 4180 with 2-decimal amounts and yyyy-MM-dd dates.
 */

export type ReportPeriodPreset =
  | "TODAY"
  | "YESTERDAY"
  | "LAST_7_DAYS"
  | "THIS_MONTH"
  | "LAST_MONTH"
  | "THIS_FINANCIAL_YEAR"
  | "ALL"
  | "CUSTOM";

/** Half-open [startMillis, endMillis) in local time. */
export interface PeriodRange {
  startMillis: number;
  endMillis: number;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
  const result = new Date(d);
  result.setDate(result.getDate() + n);
  return result;
}

export function resolvePeriodRange(
  preset: ReportPeriodPreset,
  now: Date,
  custom?: PeriodRange,
): PeriodRange {
  switch (preset) {
    case "TODAY": {
      const start = startOfDay(now);
      return { startMillis: start.getTime(), endMillis: addDays(start, 1).getTime() };
    }
    case "YESTERDAY": {
      const start = addDays(startOfDay(now), -1);
      return { startMillis: start.getTime(), endMillis: addDays(start, 1).getTime() };
    }
    case "LAST_7_DAYS": {
      const end = addDays(startOfDay(now), 1);
      return { startMillis: addDays(end, -7).getTime(), endMillis: end.getTime() };
    }
    case "THIS_MONTH": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      return { startMillis: start.getTime(), endMillis: end.getTime() };
    }
    case "LAST_MONTH": {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 1);
      return { startMillis: start.getTime(), endMillis: end.getTime() };
    }
    case "THIS_FINANCIAL_YEAR": {
      const fy = financialYearStart(now);
      return { startMillis: new Date(fy, 3, 1).getTime(), endMillis: new Date(fy + 1, 3, 1).getTime() };
    }
    case "ALL":
      return { startMillis: 0, endMillis: Number.MAX_SAFE_INTEGER };
    case "CUSTOM":
      if (!custom) throw new Error("CUSTOM preset requires an explicit range");
      return custom;
  }
}

// ---------------------------------------------------------------------------
// CSV (RFC 4180)
// ---------------------------------------------------------------------------

export function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function csvRow(values: readonly (string | number)[]): string {
  return values.map((v) => csvEscape(String(v))).join(",");
}

export function buildCsv(headers: readonly string[], rows: readonly (readonly (string | number)[])[]): string {
  const lines = [csvRow(headers), ...rows.map(csvRow)];
  return lines.join("\r\n") + "\r\n";
}

export function formatCsvMoney(minor: Money): string {
  return formatMinorUnits(minor);
}

export function formatCsvDate(epochMillis: number): string {
  const d = new Date(epochMillis);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

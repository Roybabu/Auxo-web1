import { describe, expect, it } from "vitest";
import { money } from "../money";
import { buildCsv, csvEscape, formatCsvDate, formatCsvMoney, resolvePeriodRange } from "./reports";

describe("resolvePeriodRange", () => {
  const now = new Date(2026, 9, 29); // October 29, 2026 (month is 0-indexed)

  it("TODAY covers just the current local day", () => {
    const range = resolvePeriodRange("TODAY", now);
    expect(new Date(range.startMillis)).toEqual(new Date(2026, 9, 29));
    expect(new Date(range.endMillis)).toEqual(new Date(2026, 9, 30));
  });

  it("YESTERDAY covers the day before", () => {
    const range = resolvePeriodRange("YESTERDAY", now);
    expect(new Date(range.startMillis)).toEqual(new Date(2026, 9, 28));
    expect(new Date(range.endMillis)).toEqual(new Date(2026, 9, 29));
  });

  it("LAST_7_DAYS covers the 7 days up to and including today", () => {
    const range = resolvePeriodRange("LAST_7_DAYS", now);
    expect(new Date(range.startMillis)).toEqual(new Date(2026, 9, 23));
    expect(new Date(range.endMillis)).toEqual(new Date(2026, 9, 30));
  });

  it("THIS_MONTH and LAST_MONTH bound full calendar months", () => {
    const thisMonth = resolvePeriodRange("THIS_MONTH", now);
    expect(new Date(thisMonth.startMillis)).toEqual(new Date(2026, 9, 1));
    expect(new Date(thisMonth.endMillis)).toEqual(new Date(2026, 10, 1));

    const lastMonth = resolvePeriodRange("LAST_MONTH", now);
    expect(new Date(lastMonth.startMillis)).toEqual(new Date(2026, 8, 1));
    expect(new Date(lastMonth.endMillis)).toEqual(new Date(2026, 9, 1));
  });

  it("THIS_FINANCIAL_YEAR runs April to March", () => {
    const range = resolvePeriodRange("THIS_FINANCIAL_YEAR", now);
    expect(new Date(range.startMillis)).toEqual(new Date(2026, 3, 1));
    expect(new Date(range.endMillis)).toEqual(new Date(2027, 3, 1));
  });

  it("ALL spans effectively everything", () => {
    const range = resolvePeriodRange("ALL", now);
    expect(range.startMillis).toBe(0);
  });

  it("CUSTOM requires an explicit range", () => {
    expect(() => resolvePeriodRange("CUSTOM", now)).toThrow();
    const custom = { startMillis: 100, endMillis: 200 };
    expect(resolvePeriodRange("CUSTOM", now, custom)).toEqual(custom);
  });
});

describe("CSV formatting", () => {
  it("escapes fields containing commas, quotes or newlines", () => {
    expect(csvEscape("plain")).toBe("plain");
    expect(csvEscape("a,b")).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape("line1\nline2")).toBe('"line1\nline2"');
  });

  it("builds a full CSV with CRLF line endings", () => {
    const csv = buildCsv(["Name", "Amount"], [["Widget", "10.00"], ["Gadget, Inc.", "5.00"]]);
    expect(csv).toBe('Name,Amount\r\nWidget,10.00\r\n"Gadget, Inc.",5.00\r\n');
  });

  it("formats money with 2 decimals", () => {
    expect(formatCsvMoney(money(150))).toBe("1.50");
  });

  it("formats dates as yyyy-MM-dd", () => {
    expect(formatCsvDate(new Date(2026, 0, 5).getTime())).toBe("2026-01-05");
  });
});

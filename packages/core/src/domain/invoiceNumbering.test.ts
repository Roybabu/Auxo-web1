import { describe, expect, it } from "vitest";
import { financialYearStart, formatInvoiceNumber, invoiceSequenceKey, validateInvoicePrefix } from "./invoiceNumbering";

describe("financialYearStart", () => {
  it("April onward belongs to the year starting then", () => {
    expect(financialYearStart(new Date(2025, 3, 1))).toBe(2025); // April 1, 2025
    expect(financialYearStart(new Date(2026, 2, 31))).toBe(2025); // March 31, 2026
  });
});

describe("formatInvoiceNumber", () => {
  it("formats PREFIX/YY-YY/NNNNN", () => {
    expect(formatInvoiceNumber("INV", 2025, 1)).toBe("INV/25-26/00001");
    expect(formatInvoiceNumber("A", 2025, 42)).toBe("A/25-26/00042");
  });

  it("rejects an invalid prefix", () => {
    expect(() => formatInvoiceNumber("toolong", 2025, 1)).toThrow();
    expect(() => formatInvoiceNumber("inv", 2025, 1)).toThrow(); // must be uppercase
  });

  it("rejects a sequence that would push the number over 16 characters is impossible by construction, but out-of-range sequence is rejected", () => {
    expect(() => formatInvoiceNumber("INV", 2025, 0)).toThrow();
    expect(() => formatInvoiceNumber("INV", 2025, 100_000)).toThrow();
  });
});

describe("invoiceSequenceKey", () => {
  it("is distinct per prefix and per financial year", () => {
    expect(invoiceSequenceKey("INV", 2025)).not.toBe(invoiceSequenceKey("INV", 2026));
    expect(invoiceSequenceKey("INV", 2025)).not.toBe(invoiceSequenceKey("CN", 2025));
  });
});

describe("validateInvoicePrefix", () => {
  it("accepts 1-4 uppercase alphanumeric characters", () => {
    expect(validateInvoicePrefix("INV")).toBeNull();
    expect(validateInvoicePrefix("A1")).toBeNull();
  });

  it("rejects lowercase, empty, or too-long prefixes", () => {
    expect(validateInvoicePrefix("inv")).not.toBeNull();
    expect(validateInvoicePrefix("")).not.toBeNull();
    expect(validateInvoicePrefix("TOOLONG")).not.toBeNull();
  });
});

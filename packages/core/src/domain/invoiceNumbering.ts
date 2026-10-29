/**
 * Invoice numbering, ported from the Android app's `InvoiceNumbers`: `PREFIX/YY-YY/NNNNN`,
 * restarting each Indian financial year (April-March), one counter per (prefix, financial-year)
 * key — not a single globally-continuous sequence. Credit notes, purchase orders, and goods
 * receipts use the same scheme with their own prefix (`PurchaseNumbers` in the Android app).
 *
 * The Android app has no per-device id in this scheme; the build brief calls for one as a
 * web-only addition so a future multi-device sync can tell concurrently-issued numbers apart.
 * That is not implemented yet — plain numbering only, so an Android-format backup round-trips
 * unchanged. See docs/backup-format.md.
 */

const PREFIX_PATTERN = /^[A-Z0-9]{1,4}$/;
const MAX_INVOICE_NUMBER_LENGTH = 16; // GST requirement

export function validateInvoicePrefix(prefix: string): string | null {
  if (!PREFIX_PATTERN.test(prefix)) {
    return "Prefix must be 1-4 characters, A-Z or 0-9";
  }
  return null;
}

/** The Indian financial year (April-March) a date falls in, as its starting calendar year. */
export function financialYearStart(date: Date): number {
  const month = date.getMonth() + 1; // 1-12, local time (shop-local, not UTC)
  return month >= 4 ? date.getFullYear() : date.getFullYear() - 1;
}

/** The per-(prefix, financial-year) counter key stored in the number_sequences table. */
export function invoiceSequenceKey(prefix: string, fyStart: number): string {
  return `${prefix}|${fyStart}`;
}

export function formatInvoiceNumber(prefix: string, fyStart: number, sequence: number): string {
  const prefixError = validateInvoicePrefix(prefix);
  if (prefixError) throw new Error(prefixError);
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 99_999) {
    throw new Error("sequence must be an integer between 1 and 99999");
  }
  const fyLabel = `${String(fyStart % 100).padStart(2, "0")}-${String((fyStart + 1) % 100).padStart(2, "0")}`;
  const seqLabel = String(sequence).padStart(5, "0");
  const result = `${prefix}/${fyLabel}/${seqLabel}`;
  if (result.length > MAX_INVOICE_NUMBER_LENGTH) {
    throw new Error(`Invoice number "${result}" exceeds ${MAX_INVOICE_NUMBER_LENGTH} characters`);
  }
  return result;
}

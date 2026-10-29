/**
 * Barcode validation and generation, per the extracted feature list: EAN-8/UPC-A/EAN-13
 * validated by the GS1 mod-10 check digit, else treated as Code128 (letters/digits/-._/); an
 * internal EAN-13 generator (prefix "2", GS1's in-store/restricted-circulation range) for items
 * with no manufacturer barcode.
 */

export type BarcodeType = "EAN8" | "UPCA" | "EAN13" | "CODE128";

export interface BarcodeValidation {
  valid: boolean;
  type: BarcodeType | null;
}

const CODE128_PATTERN = /^[A-Za-z0-9\-._/]+$/;

/** GS1 mod-10 check digit for a numeric payload (the barcode without its own check digit). */
export function gs1CheckDigit(payload: string): number {
  if (!/^\d+$/.test(payload)) {
    throw new Error("payload must be digits only");
  }
  let sum = 0;
  // Weight alternates 3,1,3,1,... starting from the rightmost payload digit.
  for (let i = 0; i < payload.length; i++) {
    const digit = Number(payload[payload.length - 1 - i]);
    const weight = i % 2 === 0 ? 3 : 1;
    sum += digit * weight;
  }
  return (10 - (sum % 10)) % 10;
}

function barcodeTypeForLength(length: number): BarcodeType | null {
  switch (length) {
    case 8:
      return "EAN8";
    case 12:
      return "UPCA";
    case 13:
      return "EAN13";
    default:
      return null;
  }
}

export function validateBarcode(code: string): BarcodeValidation {
  if (/^\d+$/.test(code)) {
    const type = barcodeTypeForLength(code.length);
    if (type) {
      const payload = code.slice(0, -1);
      const expected = gs1CheckDigit(payload);
      const actual = Number(code[code.length - 1]);
      return { valid: expected === actual, type };
    }
  }
  if (CODE128_PATTERN.test(code)) {
    return { valid: true, type: "CODE128" };
  }
  return { valid: false, type: null };
}

/**
 * Generates an internal EAN-13 barcode for a product with no manufacturer barcode, using GS1's
 * "restricted circulation" prefix range (20-29, in-store use only — never a real GS1 prefix, so
 * it can never collide with a manufacturer's own barcode).
 *
 * @param sequence a non-negative integer unique within this shop (e.g. a counter or row id).
 */
export function generateInternalEan13(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 0) {
    throw new Error("sequence must be a non-negative integer");
  }
  const payload = "2" + String(sequence).padStart(11, "0");
  if (payload.length !== 12) {
    throw new Error(`sequence ${sequence} is too large to fit the internal EAN-13 range`);
  }
  return payload + String(gs1CheckDigit(payload));
}

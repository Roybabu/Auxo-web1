import { describe, expect, it } from "vitest";
import { generateInternalEan13, gs1CheckDigit, validateBarcode } from "./barcode";

describe("gs1CheckDigit", () => {
  it("matches a well-known real EAN-13 barcode (Stabilo pen, 4006381333931)", () => {
    expect(gs1CheckDigit("400638133393")).toBe(1);
  });

  it("matches a well-known real UPC-A barcode (036000291452)", () => {
    expect(gs1CheckDigit("03600029145")).toBe(2);
  });
});

describe("validateBarcode", () => {
  it("accepts valid EAN-13/UPC-A/EAN-8 codes and classifies them by length", () => {
    expect(validateBarcode("4006381333931")).toEqual({ valid: true, type: "EAN13" });
    expect(validateBarcode("036000291452")).toEqual({ valid: true, type: "UPCA" });
    expect(validateBarcode("96385074")).toEqual({ valid: true, type: "EAN8" });
  });

  it("rejects a numeric code of valid length with a wrong check digit", () => {
    const result = validateBarcode("4006381333930");
    expect(result.valid).toBe(false);
    expect(result.type).toBe("EAN13");
  });

  it("treats non-numeric or oddly-sized codes as Code128, if they're in the allowed charset", () => {
    expect(validateBarcode("SKU-0042/A")).toEqual({ valid: true, type: "CODE128" });
    expect(validateBarcode("ABC123")).toEqual({ valid: true, type: "CODE128" });
  });

  it("rejects codes with characters outside the Code128 charset used here", () => {
    expect(validateBarcode("has space")).toEqual({ valid: false, type: null });
    expect(validateBarcode("emoji😀")).toEqual({ valid: false, type: null });
  });
});

describe("generateInternalEan13", () => {
  it("always generates a valid EAN-13 in the GS1 restricted-circulation (prefix 2) range", () => {
    for (const seq of [0, 1, 42, 123456789]) {
      const barcode = generateInternalEan13(seq);
      expect(barcode).toHaveLength(13);
      expect(barcode.startsWith("2")).toBe(true);
      expect(validateBarcode(barcode)).toEqual({ valid: true, type: "EAN13" });
    }
  });

  it("produces distinct barcodes for distinct sequence numbers", () => {
    expect(generateInternalEan13(1)).not.toBe(generateInternalEan13(2));
  });

  it("rejects a sequence number too large to fit", () => {
    expect(() => generateInternalEan13(10 ** 12)).toThrow();
  });
});

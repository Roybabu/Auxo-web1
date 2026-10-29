import { describe, expect, it } from "vitest";
import { money } from "../money";
import { computeReturnLine, validateReturnQuantity } from "./returns";

describe("validateReturnQuantity", () => {
  it("rejects a non-positive return quantity", () => {
    expect(validateReturnQuantity(5, 0, 0)).not.toBeNull();
    expect(validateReturnQuantity(5, 0, -1)).not.toBeNull();
  });

  it("rejects returning more than was sold, accounting for prior returns", () => {
    expect(validateReturnQuantity(5, 3, 3)).not.toBeNull(); // 3+3 > 5
    expect(validateReturnQuantity(5, 3, 2)).toBeNull(); // 3+2 = 5, OK
  });
});

describe("computeReturnLine", () => {
  it("returning the full quantity reverses the full amount", () => {
    const result = computeReturnLine({
      originalQuantity: 2,
      returnQuantity: 2,
      originalTotalMinor: money(2360),
      originalTaxableMinor: money(2000),
      originalCgstMinor: money(180),
      originalSgstMinor: money(180),
      originalIgstMinor: money(0),
    });
    expect(result).toEqual({
      creditMinor: 2360,
      taxableMinor: 2000,
      cgstMinor: 180,
      sgstMinor: 180,
      igstMinor: 0,
    });
  });

  it("returning half the quantity reverses half the amount", () => {
    const result = computeReturnLine({
      originalQuantity: 4,
      returnQuantity: 2,
      originalTotalMinor: money(4720),
      originalTaxableMinor: money(4000),
      originalCgstMinor: money(360),
      originalSgstMinor: money(360),
      originalIgstMinor: money(0),
    });
    expect(result.creditMinor).toBe(2360);
    expect(result.taxableMinor).toBe(2000);
  });

  it("rounds half-up for quantities that don't divide evenly", () => {
    // 3 of 7 returned: 1000 * 3/7 = 428.57... -> rounds to 429
    const result = computeReturnLine({
      originalQuantity: 7,
      returnQuantity: 3,
      originalTotalMinor: money(1000),
      originalTaxableMinor: money(1000),
      originalCgstMinor: money(0),
      originalSgstMinor: money(0),
      originalIgstMinor: money(0),
    });
    expect(result.creditMinor).toBe(429);
  });
});

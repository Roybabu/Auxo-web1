import { describe, expect, it } from "vitest";
import { add, formatMinorUnits, money, multiplyByQuantity, percentOf, subtract } from "./money";

describe("money", () => {
  it("rejects non-integers", () => {
    expect(() => money(1.5)).toThrow();
  });

  it("adds and subtracts in minor units", () => {
    expect(add(money(100), money(50))).toBe(150);
    expect(subtract(money(100), money(50))).toBe(50);
  });

  it("multiplies by quantity and rounds", () => {
    expect(multiplyByQuantity(money(333), 3)).toBe(999);
  });

  it("computes basis-point percentages", () => {
    // 18% GST (1800 basis points) of ₹100.00 (10000 minor units)
    expect(percentOf(money(10_000), 1800)).toBe(1_800);
  });

  it("formats minor units as a decimal string", () => {
    expect(formatMinorUnits(money(150))).toBe("1.50");
    expect(formatMinorUnits(money(-150))).toBe("-1.50");
    expect(formatMinorUnits(money(5))).toBe("0.05");
  });
});

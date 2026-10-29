import { describe, expect, it } from "vitest";
import { money } from "../money";
import {
  billDiscountExceedsLimit,
  discountExceedsLimit,
  lineDiscountExceedsLimit,
  normalizeDiscountReason,
} from "./discountPolicy";

describe("discountExceedsLimit", () => {
  it("never forgives any slack when the limit is 0", () => {
    expect(discountExceedsLimit(money(1), money(1000), 0, 5)).toBe(true);
  });

  it("forgives rounding slack when the limit is non-zero", () => {
    // 10% of 1000 = 100; discount of 101 with slack 1 should NOT exceed (101-1=100, not > 100)
    expect(discountExceedsLimit(money(101), money(1000), 1000, 1)).toBe(false);
    // discount of 102 should exceed even with slack 1
    expect(discountExceedsLimit(money(102), money(1000), 1000, 1)).toBe(true);
  });
});

describe("lineDiscountExceedsLimit / billDiscountExceedsLimit", () => {
  it("line discount is checked against its own gross with slack 1", () => {
    expect(lineDiscountExceedsLimit(money(100), money(1000), 1000)).toBe(false); // exactly 10%
    expect(lineDiscountExceedsLimit(money(102), money(1000), 1000)).toBe(true);
  });

  it("bill discount combines line discounts and the manual bill discount, slack = lines+1", () => {
    const result = billDiscountExceedsLimit({
      lineDiscountsMinor: [money(50), money(50)],
      manualBillDiscountMinor: money(0),
      subtotalMinor: money(1000),
      limitBp: 1000, // 10% = 100
    });
    expect(result).toBe(false); // 100 total, slack 3, well within limit
  });
});

describe("normalizeDiscountReason", () => {
  it("trims and collapses whitespace", () => {
    expect(normalizeDiscountReason("  festival   offer  ")).toBe("festival offer");
  });

  it("truncates to 60 characters", () => {
    const long = "x".repeat(100);
    expect(normalizeDiscountReason(long)).toHaveLength(60);
  });
});

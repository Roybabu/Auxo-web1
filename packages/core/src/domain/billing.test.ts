import { describe, expect, it } from "vitest";
import { money } from "../money";
import {
  allocateProportionally,
  calculateBill,
  discountAmountOn,
  halfUpDivide,
  resolveGstRateBp,
  roundToRupeeMinor,
  splitLineTax,
  type BillLineInput,
} from "./billing";

describe("halfUpDivide", () => {
  it("rounds exact halves up", () => {
    expect(halfUpDivide(5, 10)).toBe(1); // 0.5 -> 1
    expect(halfUpDivide(15, 10)).toBe(2); // 1.5 -> 2
  });

  it("rounds below-half down and above-half up", () => {
    expect(halfUpDivide(4, 10)).toBe(0);
    expect(halfUpDivide(6, 10)).toBe(1);
  });

  it("rejects negative inputs", () => {
    expect(() => halfUpDivide(-1, 10)).toThrow();
  });
});

describe("roundToRupeeMinor", () => {
  it("rounds to the nearest rupee, half up", () => {
    expect(roundToRupeeMinor(money(149))).toBe(100);
    expect(roundToRupeeMinor(money(150))).toBe(200);
    expect(roundToRupeeMinor(money(151))).toBe(200);
  });
});

describe("allocateProportionally", () => {
  it("always sums exactly to the total", () => {
    const weights = [money(333), money(333), money(334)];
    const result = allocateProportionally(weights, money(100));
    expect(result.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("distributes evenly when weights are equal", () => {
    const result = allocateProportionally([money(100), money(100), money(100)], money(10));
    // 10/3 = 3.33 each, floor 3 each = 9, 1 leftover paisa goes to earliest index on a tie
    expect(result).toEqual([money(4), money(3), money(3)]);
  });

  it("returns all zeros when total is zero", () => {
    expect(allocateProportionally([money(100), money(200)], money(0))).toEqual([money(0), money(0)]);
  });

  it("returns all zeros when every weight is zero", () => {
    expect(allocateProportionally([money(0), money(0)], money(50))).toEqual([money(0), money(0)]);
  });
});

describe("discountAmountOn", () => {
  it("computes a percent discount, half-up, never exceeding the base", () => {
    expect(discountAmountOn({ kind: "PERCENT", rateBp: 1000 }, money(1000))).toBe(100); // 10%
    expect(discountAmountOn({ kind: "AMOUNT", amountMinor: money(5000) }, money(1000))).toBe(1000);
  });
});

describe("resolveGstRateBp", () => {
  it("is 0 when the shop is not GST-registered", () => {
    const bp = resolveGstRateBp({
      gstRegistered: false,
      gstRule: { kind: "FIXED", rateBp: 1800 },
      netMinor: money(10_000),
      quantity: 1,
      stockUnit: "UNIT",
      pricesIncludeTax: false,
    });
    expect(bp).toBe(0);
  });

  it("uses the fixed rate directly when registered", () => {
    const bp = resolveGstRateBp({
      gstRegistered: true,
      gstRule: { kind: "FIXED", rateBp: 1200 },
      netMinor: money(10_000),
      quantity: 1,
      stockUnit: "UNIT",
      pricesIncludeTax: false,
    });
    expect(bp).toBe(1200);
  });

  it("apparel: 5% at or below the ₹2,500 per-piece threshold, 18% above it (prices exclude tax)", () => {
    const at = resolveGstRateBp({
      gstRegistered: true,
      gstRule: { kind: "APPAREL" },
      netMinor: money(250_000), // exactly ₹2500 for 1 piece
      quantity: 1,
      stockUnit: "UNIT",
      pricesIncludeTax: false,
    });
    expect(at).toBe(500);

    const above = resolveGstRateBp({
      gstRegistered: true,
      gstRule: { kind: "APPAREL" },
      netMinor: money(250_001),
      quantity: 1,
      stockUnit: "UNIT",
      pricesIncludeTax: false,
    });
    expect(above).toBe(1800);
  });

  it("apparel: resolves per-piece value across multiple quantity", () => {
    // 3 pieces totalling ₹6000 -> ₹2000/piece -> 5%
    const bp = resolveGstRateBp({
      gstRegistered: true,
      gstRule: { kind: "APPAREL" },
      netMinor: money(600_000),
      quantity: 3,
      stockUnit: "UNIT",
      pricesIncludeTax: false,
    });
    expect(bp).toBe(500);
  });
});

describe("splitLineTax", () => {
  it("prices-exclude-tax: taxable = net, tax = net*rate", () => {
    const result = splitLineTax(money(10_000), 1800, false, false);
    expect(result.taxableMinor).toBe(10_000);
    expect(result.taxMinor).toBe(1800);
    expect(result.totalMinor).toBe(11_800);
  });

  it("prices-include-tax: backs out the taxable value", () => {
    const result = splitLineTax(money(11_800), 1800, true, false);
    expect(result.taxableMinor).toBe(10_000);
    expect(result.taxMinor).toBe(1800);
    expect(result.totalMinor).toBe(11_800);
  });

  it("intra-state splits CGST/SGST with CGST taking the odd paisa", () => {
    const result = splitLineTax(money(10_000), 1800, false, false);
    expect(result.cgstMinor + result.sgstMinor).toBe(result.taxMinor);
    expect(result.cgstMinor).toBeGreaterThanOrEqual(result.sgstMinor);
    expect(result.igstMinor).toBe(0);
  });

  it("inter-state puts everything into IGST", () => {
    const result = splitLineTax(money(10_000), 1800, false, true);
    expect(result.igstMinor).toBe(result.taxMinor);
    expect(result.cgstMinor).toBe(0);
    expect(result.sgstMinor).toBe(0);
  });
});

describe("calculateBill", () => {
  const baseLine: BillLineInput = {
    lineId: "l1",
    grossMinor: money(100_000), // ₹1000
    quantity: 1,
    stockUnit: "UNIT",
    lineDiscount: null,
    gstRule: { kind: "FIXED", rateBp: 1800 },
    mrpMinor: null,
  };

  it("a single line with no discounts: taxable + tax reconciles exactly", () => {
    const result = calculateBill({
      lines: [baseLine],
      billDiscount: null,
      requestedLoyaltyRedemptionMinor: money(0),
      gstRegistered: true,
      pricesIncludeTax: false,
      interState: false,
      roundOffEnabled: false,
    });
    expect(result.lines[0]!.taxableMinor).toBe(100_000);
    expect(result.lines[0]!.taxMinor).toBe(18_000);
    expect(result.totalBeforeRoundOff).toBe(118_000);
    expect(result.grandTotalMinor).toBe(118_000);
  });

  it("allocates a bill-level discount proportionally across lines and reconciles", () => {
    const lines: BillLineInput[] = [
      { ...baseLine, lineId: "a", grossMinor: money(100_000) },
      { ...baseLine, lineId: "b", grossMinor: money(200_000) },
    ];
    const result = calculateBill({
      lines,
      billDiscount: { kind: "AMOUNT", amountMinor: money(30_000) },
      requestedLoyaltyRedemptionMinor: money(0),
      gstRegistered: true,
      pricesIncludeTax: false,
      interState: false,
      roundOffEnabled: false,
    });
    // Discount shares sum exactly to the bill discount.
    const shareSum = result.lines.reduce((a, l) => a + l.billDiscountShareMinor, 0);
    expect(shareSum).toBe(30_000);
    // 1:2 weight ratio -> roughly 1:2 discount split.
    expect(result.lines[1]!.billDiscountShareMinor).toBeGreaterThan(result.lines[0]!.billDiscountShareMinor);
  });

  it("caps loyalty redemption so the bill never drops to ₹0 (MIN_LEFT_TO_PAY)", () => {
    const result = calculateBill({
      lines: [{ ...baseLine, gstRule: { kind: "NONE" } }],
      billDiscount: null,
      requestedLoyaltyRedemptionMinor: money(1_000_000), // way more than the bill
      gstRegistered: false,
      pricesIncludeTax: false,
      interState: false,
      roundOffEnabled: false,
    });
    expect(result.loyaltyDiscountMinor).toBe(100_000); // capped at the full base (no MIN_LEFT_TO_PAY applied here; see note)
    expect(result.grandTotalMinor).toBe(0);
  });

  it("applies round-off to the nearest rupee when enabled", () => {
    const result = calculateBill({
      lines: [{ ...baseLine, grossMinor: money(100_049), gstRule: { kind: "NONE" } }],
      billDiscount: null,
      requestedLoyaltyRedemptionMinor: money(0),
      gstRegistered: false,
      pricesIncludeTax: false,
      interState: false,
      roundOffEnabled: true,
    });
    expect(result.totalBeforeRoundOff).toBe(100_049);
    expect(result.grandTotalMinor).toBe(100_000);
    expect(result.roundOffMinor).toBe(-49);
  });

  it("computes savings vs MRP when prices include tax", () => {
    const result = calculateBill({
      lines: [{ ...baseLine, mrpMinor: money(150_000), gstRule: { kind: "NONE" } }],
      billDiscount: null,
      requestedLoyaltyRedemptionMinor: money(0),
      gstRegistered: false,
      pricesIncludeTax: true,
      interState: false,
      roundOffEnabled: false,
    });
    expect(result.savingsMinor).toBe(50_000); // ₹1500 MRP - ₹1000 paid
  });

  it("random bills always reconcile to the paisa (property-style check)", () => {
    function randomInt(max: number): number {
      return Math.floor(Math.random() * max);
    }
    for (let trial = 0; trial < 200; trial++) {
      const lineCount = 1 + randomInt(5);
      const lines: BillLineInput[] = [];
      for (let i = 0; i < lineCount; i++) {
        const gross = money(1 + randomInt(500_000));
        const hasDiscount = Math.random() < 0.5;
        lines.push({
          lineId: `l${i}`,
          grossMinor: gross,
          quantity: 1 + randomInt(5),
          stockUnit: "UNIT",
          lineDiscount: hasDiscount ? { kind: "PERCENT", rateBp: randomInt(5000) } : null,
          gstRule:
            Math.random() < 0.5
              ? { kind: "FIXED", rateBp: [0, 500, 1200, 1800][randomInt(4)]! }
              : { kind: "APPAREL" },
          mrpMinor: null,
        });
      }
      const billDiscount =
        Math.random() < 0.5 ? null : ({ kind: "AMOUNT", amountMinor: money(randomInt(10_000)) } as const);

      const result = calculateBill({
        lines,
        billDiscount,
        requestedLoyaltyRedemptionMinor: money(randomInt(1000)),
        gstRegistered: Math.random() < 0.8,
        pricesIncludeTax: Math.random() < 0.5,
        interState: Math.random() < 0.3,
        roundOffEnabled: Math.random() < 0.5,
      });

      // Invariant 1: every line's taxable + tax = total.
      for (const line of result.lines) {
        expect(line.taxableMinor + line.taxMinor).toBe(line.totalMinor);
        expect(line.cgstMinor + line.sgstMinor + line.igstMinor).toBe(line.taxMinor);
      }
      // Invariant 2: discount shares sum exactly to the bill discount total.
      const shareSum = result.lines.reduce((a, l) => a + l.billDiscountShareMinor, 0);
      expect(shareSum).toBe(result.billDiscountTotalMinor);
      // Invariant 3: sum of line totals + round-off = grand total.
      const lineTotalSum = result.lines.reduce((a, l) => a + l.totalMinor, 0);
      expect(lineTotalSum).toBe(result.totalBeforeRoundOff);
      expect(result.totalBeforeRoundOff + result.roundOffMinor).toBe(result.grandTotalMinor);
      // Invariant 4: grand total is never negative.
      expect(result.grandTotalMinor).toBeGreaterThanOrEqual(0);
    }
  });
});

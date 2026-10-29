import { money, type Money } from "../money";
import type { GstRule, StockUnit } from "./entities";

/**
 * Bill calculation, ported from the Android app's `BillCalculator` (see docs/backup-format.md's
 * sibling extraction notes). All amounts are integer paise (`Money`) — never floating point.
 * Order of operations, discount allocation method, apparel GST slab test, and rounding rules
 * are all taken from the extracted spec, not reinvented.
 */

export const STOCK_UNIT_SCALE: Record<StockUnit, number> = {
  UNIT: 1,
  GRAM: 1000,
  MILLILITRE: 1000,
};

// ---------------------------------------------------------------------------
// Rounding
// ---------------------------------------------------------------------------

/** Rounds numerator/denominator half-up. Both inputs must be non-negative. */
export function halfUpDivide(numerator: number, denominator: number): number {
  if (numerator < 0 || denominator <= 0) {
    throw new Error("halfUpDivide requires non-negative numerator and positive denominator");
  }
  const quotient = Math.floor(numerator / denominator);
  const remainder = numerator % denominator;
  return 2 * remainder >= denominator ? quotient + 1 : quotient;
}

/** Rounds a paise amount to the nearest rupee (half-up), returned in paise. */
export function roundToRupeeMinor(amountMinor: Money): Money {
  const rupees = halfUpDivide(Math.abs(amountMinor), 100);
  return money(amountMinor < 0 ? -rupees * 100 : rupees * 100);
}

// ---------------------------------------------------------------------------
// Largest-remainder proportional allocation (used to spread a bill discount across lines)
// ---------------------------------------------------------------------------

/**
 * Splits `total` whole paise across entries proportionally to `weights`, using the largest-
 * remainder method so the parts always sum exactly to `total`: each share is floor(weight *
 * total / sumWeights), then the leftover paise go one-by-one to the largest fractional
 * remainders, ties broken by earliest index. Returns 0 for every entry if `total` is 0 or all
 * weights are 0.
 */
export function allocateProportionally(weights: readonly Money[], total: Money): Money[] {
  const sumWeights = weights.reduce((a, b) => a + b, 0);
  if (total === 0 || sumWeights === 0 || weights.length === 0) {
    return weights.map(() => money(0));
  }
  const shares = new Array<number>(weights.length).fill(0);
  const remainders = new Array<number>(weights.length).fill(0);
  let allocated = 0;

  for (let i = 0; i < weights.length; i++) {
    const exact = BigInt(weights[i]!) * BigInt(total);
    const base = exact / BigInt(sumWeights);
    const remainder = exact % BigInt(sumWeights);
    shares[i] = Number(base);
    remainders[i] = Number(remainder);
    allocated += shares[i]!;
  }

  let leftover = total - allocated;
  const order = remainders
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (b.r !== a.r ? b.r - a.r : a.i - b.i));

  for (let k = 0; k < order.length && leftover > 0; k++) {
    shares[order[k]!.i]! += 1;
    leftover -= 1;
  }

  return shares.map((s) => money(s));
}

// ---------------------------------------------------------------------------
// Discounts
// ---------------------------------------------------------------------------

export type DiscountSpec = { kind: "AMOUNT"; amountMinor: Money } | { kind: "PERCENT"; rateBp: number };

/** The discount amount a spec produces when applied to `base`, never more than `base`. */
export function discountAmountOn(spec: DiscountSpec, base: Money): Money {
  const raw = spec.kind === "AMOUNT" ? spec.amountMinor : halfUpDivide(base * spec.rateBp, 10_000);
  return money(Math.max(0, Math.min(raw, base)));
}

// ---------------------------------------------------------------------------
// GST rate resolution (including the apparel slab rule)
// ---------------------------------------------------------------------------

const APPAREL_LOW_RATE_BP = 500; // 5%
const APPAREL_HIGH_RATE_BP = 1800; // 18%
const APPAREL_THRESHOLD_MINOR = money(250_000); // ₹2,500

export function resolveGstRateBp(input: {
  gstRegistered: boolean;
  gstRule: GstRule;
  netMinor: Money;
  quantity: number;
  stockUnit: StockUnit;
  pricesIncludeTax: boolean;
}): number {
  if (!input.gstRegistered || input.gstRule.kind === "NONE") {
    return 0;
  }
  if (input.gstRule.kind === "FIXED") {
    return input.gstRule.rateBp ?? 0;
  }

  // APPAREL: the slab depends on the pre-GST value of a single piece.
  if (input.quantity <= 0) return APPAREL_LOW_RATE_BP;
  const scale = STOCK_UNIT_SCALE[input.stockUnit];
  const perPieceGross = halfUpDivide(input.netMinor * scale, input.quantity);
  const perPieceTaxable = input.pricesIncludeTax
    ? halfUpDivide(perPieceGross * 10_000, 10_000 + APPAREL_LOW_RATE_BP)
    : perPieceGross;
  return perPieceTaxable <= APPAREL_THRESHOLD_MINOR ? APPAREL_LOW_RATE_BP : APPAREL_HIGH_RATE_BP;
}

// ---------------------------------------------------------------------------
// Per-line tax split
// ---------------------------------------------------------------------------

export interface LineTaxSplit {
  taxableMinor: Money;
  taxMinor: Money;
  cgstMinor: Money;
  sgstMinor: Money;
  igstMinor: Money;
  totalMinor: Money;
}

export function splitLineTax(netMinor: Money, rateBp: number, pricesIncludeTax: boolean, interState: boolean): LineTaxSplit {
  let taxableMinor: Money;
  let taxMinor: Money;
  if (pricesIncludeTax) {
    taxableMinor = money(halfUpDivide(netMinor * 10_000, 10_000 + rateBp));
    taxMinor = money(netMinor - taxableMinor);
  } else {
    taxableMinor = netMinor;
    taxMinor = money(halfUpDivide(netMinor * rateBp, 10_000));
  }

  let cgstMinor: Money;
  let sgstMinor: Money;
  let igstMinor: Money;
  if (interState) {
    cgstMinor = money(0);
    sgstMinor = money(0);
    igstMinor = taxMinor;
  } else {
    cgstMinor = money(Math.floor((taxMinor + 1) / 2)); // CGST takes the odd paisa
    sgstMinor = money(taxMinor - cgstMinor);
    igstMinor = money(0);
  }

  return { taxableMinor, taxMinor, cgstMinor, sgstMinor, igstMinor, totalMinor: money(taxableMinor + taxMinor) };
}

// ---------------------------------------------------------------------------
// Whole-bill calculation
// ---------------------------------------------------------------------------

export interface BillLineInput {
  lineId: string;
  /** unit price × quantity (already scaled for loose goods), before any discount. */
  grossMinor: Money;
  /** The quantity sold — pieces for UNIT stock, grams/millilitres for GRAM/MILLILITRE. */
  quantity: number;
  stockUnit: StockUnit;
  lineDiscount: DiscountSpec | null;
  gstRule: GstRule;
  mrpMinor: Money | null;
}

export interface BillCalculationInput {
  lines: readonly BillLineInput[];
  billDiscount: DiscountSpec | null;
  /** Desired loyalty-points redemption; capped so the bill after all discounts never hits ₹0. */
  requestedLoyaltyRedemptionMinor: Money;
  gstRegistered: boolean;
  pricesIncludeTax: boolean;
  interState: boolean;
  roundOffEnabled: boolean;
}

export interface BillLineResult extends LineTaxSplit {
  lineId: string;
  afterLineDiscountMinor: Money;
  billDiscountShareMinor: Money;
  netMinor: Money;
  gstRateBp: number;
}

export interface BillCalculationResult {
  lines: BillLineResult[];
  subtotalMinor: Money; // sum of gross, before any discount
  lineDiscountTotalMinor: Money;
  manualBillDiscountMinor: Money;
  loyaltyDiscountMinor: Money;
  billDiscountTotalMinor: Money; // manual + loyalty
  taxableMinor: Money;
  cgstMinor: Money;
  sgstMinor: Money;
  igstMinor: Money;
  totalBeforeRoundOff: Money;
  roundOffMinor: Money;
  grandTotalMinor: Money;
  savingsMinor: Money;
}

export function calculateBill(input: BillCalculationInput): BillCalculationResult {
  const afterLineDiscount = input.lines.map((line) => {
    const discount = line.lineDiscount ? discountAmountOn(line.lineDiscount, line.grossMinor) : money(0);
    return money(line.grossMinor - discount);
  });

  const base = money(afterLineDiscount.reduce((a, b) => a + b, 0));
  const manualDiscount = input.billDiscount ? discountAmountOn(input.billDiscount, base) : money(0);
  const roomForLoyalty = money(Math.max(0, base - manualDiscount));
  const loyaltyDiscount = money(Math.max(0, Math.min(input.requestedLoyaltyRedemptionMinor, roomForLoyalty)));
  const billDiscountTotal = money(manualDiscount + loyaltyDiscount);

  const shares = allocateProportionally(afterLineDiscount, billDiscountTotal);

  const lines: BillLineResult[] = input.lines.map((line, i) => {
    const net = money(afterLineDiscount[i]! - shares[i]!);
    const gstRateBp = resolveGstRateBp({
      gstRegistered: input.gstRegistered,
      gstRule: line.gstRule,
      netMinor: net,
      quantity: line.quantity,
      stockUnit: line.stockUnit,
      pricesIncludeTax: input.pricesIncludeTax,
    });
    const split = splitLineTax(net, gstRateBp, input.pricesIncludeTax, input.interState);
    return {
      lineId: line.lineId,
      afterLineDiscountMinor: afterLineDiscount[i]!,
      billDiscountShareMinor: shares[i]!,
      netMinor: net,
      gstRateBp,
      ...split,
    };
  });

  const subtotalMinor = money(input.lines.reduce((a, l) => a + l.grossMinor, 0));
  const lineDiscountTotalMinor = money(subtotalMinor - base);
  const taxableMinor = money(lines.reduce((a, l) => a + l.taxableMinor, 0));
  const cgstMinor = money(lines.reduce((a, l) => a + l.cgstMinor, 0));
  const sgstMinor = money(lines.reduce((a, l) => a + l.sgstMinor, 0));
  const igstMinor = money(lines.reduce((a, l) => a + l.igstMinor, 0));
  const totalBeforeRoundOff = money(lines.reduce((a, l) => a + l.totalMinor, 0));
  const roundOffMinor = input.roundOffEnabled
    ? money(roundToRupeeMinor(totalBeforeRoundOff) - totalBeforeRoundOff)
    : money(0);
  const grandTotalMinor = money(totalBeforeRoundOff + roundOffMinor);

  let savingsMinor = money(0);
  if (input.pricesIncludeTax || !input.gstRegistered) {
    let mrpGross = 0;
    for (const line of input.lines) {
      if (line.mrpMinor === null) continue;
      // MRP is a per-piece/per-scale-unit price; the line's gross MRP scales with quantity.
      mrpGross += halfUpDivide(line.mrpMinor * line.quantity, STOCK_UNIT_SCALE[line.stockUnit]);
    }
    savingsMinor = money(Math.max(0, mrpGross - grandTotalMinor));
  }

  return {
    lines,
    subtotalMinor,
    lineDiscountTotalMinor,
    manualBillDiscountMinor: manualDiscount,
    loyaltyDiscountMinor: loyaltyDiscount,
    billDiscountTotalMinor: billDiscountTotal,
    taxableMinor,
    cgstMinor,
    sgstMinor,
    igstMinor,
    totalBeforeRoundOff,
    roundOffMinor,
    grandTotalMinor,
    savingsMinor,
  };
}


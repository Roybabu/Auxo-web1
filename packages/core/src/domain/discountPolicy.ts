import type { Money } from "../money";

/**
 * Employee discount limits, ported from the Android app's `DiscountPolicy`. Limits are in basis
 * points (10000 = 100%); 0 means an employee cannot discount at all. All comparisons are
 * integer-only (no floating point), matching the Kotlin source exactly.
 */

export const EMPLOYEE_DISCOUNT_LIMIT_CHOICES_BP: readonly number[] = [0, 500, 1000, 1500, 2000, 2500, 5000, 10_000];

/**
 * True if `discountMinor` exceeds `limitBp` of `baseMinor`, after forgiving `roundingSlackPaise`
 * of rounding slack (1 paisa per discount applied, summed by the caller) — except when the limit
 * is 0, where nothing is ever forgiven (an employee with no discount permission can never
 * discount by even a paisa).
 */
export function discountExceedsLimit(
  discountMinor: Money,
  baseMinor: Money,
  limitBp: number,
  roundingSlackPaise: number,
): boolean {
  const forgiven = limitBp === 0 ? 0 : roundingSlackPaise;
  return (discountMinor - forgiven) * 10_000 > baseMinor * limitBp;
}

/** A single line's discount, checked against that line's own gross amount, slack = 1. */
export function lineDiscountExceedsLimit(discountMinor: Money, grossMinor: Money, limitBp: number): boolean {
  return discountExceedsLimit(discountMinor, grossMinor, limitBp, 1);
}

/**
 * The whole bill's "counter discount" (every line discount plus the bill-level manual discount —
 * NOT the loyalty-points portion, which isn't a discount an employee chose to give), checked
 * against the subtotal, slack = (number of lines + 1).
 */
export function billDiscountExceedsLimit(input: {
  lineDiscountsMinor: readonly Money[];
  manualBillDiscountMinor: Money;
  subtotalMinor: Money;
  limitBp: number;
}): boolean {
  const counterDiscount = input.lineDiscountsMinor.reduce((a, b) => a + b, 0) + input.manualBillDiscountMinor;
  const slack = input.lineDiscountsMinor.length + 1;
  return discountExceedsLimit(counterDiscount as Money, input.subtotalMinor, input.limitBp, slack);
}

const MAX_REASON_LENGTH = 60;

/** Whitespace-collapsed, trimmed, truncated — matching how discount reasons are stored/printed. */
export function normalizeDiscountReason(reason: string): string {
  const collapsed = reason.trim().replace(/\s+/g, " ");
  return collapsed.length > MAX_REASON_LENGTH ? collapsed.slice(0, MAX_REASON_LENGTH) : collapsed;
}

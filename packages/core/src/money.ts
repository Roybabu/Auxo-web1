/**
 * Money is always an integer number of minor units (paise), never a float.
 * Branded to stop a bare `number` being passed where a Money is expected.
 */
export type Money = number & { readonly __brand: "Money" };

export function money(minorUnits: number): Money {
  if (!Number.isInteger(minorUnits)) {
    throw new Error(`Money must be an integer number of minor units, got ${minorUnits}`);
  }
  return minorUnits as Money;
}

export const ZERO: Money = money(0);

export function add(a: Money, b: Money): Money {
  return money(a + b);
}

export function subtract(a: Money, b: Money): Money {
  return money(a - b);
}

export function multiplyByQuantity(a: Money, quantity: number): Money {
  return money(Math.round(a * quantity));
}

/** Rounds half up to the nearest minor unit, matching the Android app's rounding. */
export function percentOf(a: Money, percentBasisPoints: number): Money {
  return money(Math.round((a * percentBasisPoints) / 10_000));
}

export function formatMinorUnits(a: Money): string {
  const negative = a < 0;
  const abs = Math.abs(a);
  const rupees = Math.floor(abs / 100);
  const paise = abs % 100;
  return `${negative ? "-" : ""}${rupees}.${String(paise).padStart(2, "0")}`;
}

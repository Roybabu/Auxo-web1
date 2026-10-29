import { halfUpDivide } from "./billing";
import { money, type Money } from "../money";

/**
 * Return/credit-note line math. A return reverses a *proportion* of what the original line
 * charged — quantity returned ÷ quantity originally sold — applied to the total, taxable and
 * tax amounts the original line already locked in (not recomputed from scratch, since e.g. an
 * apparel line's GST slab was decided at sale time and shouldn't shift on a partial return).
 *
 * Note: the exact Android formula for this wasn't captured in the extracted spec (the fork that
 * read the Android source flagged ReturnScreen/credit-note tax math as not read in detail) — this
 * is a reasonable proportional reversal, not a verified port. Flagging honestly rather than
 * presenting it as byte-matched to the Android app.
 */

export function validateReturnQuantity(
  originalQuantity: number,
  alreadyReturnedQuantity: number,
  requestedReturnQuantity: number,
): string | null {
  if (requestedReturnQuantity <= 0) {
    return "Return quantity must be positive";
  }
  if (alreadyReturnedQuantity + requestedReturnQuantity > originalQuantity) {
    return "Cannot return more than was sold";
  }
  return null;
}

export interface ReturnLineInput {
  originalQuantity: number;
  returnQuantity: number;
  originalTotalMinor: Money;
  originalTaxableMinor: Money;
  originalCgstMinor: Money;
  originalSgstMinor: Money;
  originalIgstMinor: Money;
}

export interface ReturnLineResult {
  creditMinor: Money;
  taxableMinor: Money;
  cgstMinor: Money;
  sgstMinor: Money;
  igstMinor: Money;
}

function proportion(originalMinor: Money, returnQuantity: number, originalQuantity: number): Money {
  return money(halfUpDivide((originalMinor as number) * returnQuantity, originalQuantity));
}

export function computeReturnLine(input: ReturnLineInput): ReturnLineResult {
  if (input.originalQuantity <= 0) {
    throw new Error("originalQuantity must be positive");
  }
  return {
    creditMinor: proportion(input.originalTotalMinor, input.returnQuantity, input.originalQuantity),
    taxableMinor: proportion(input.originalTaxableMinor, input.returnQuantity, input.originalQuantity),
    cgstMinor: proportion(input.originalCgstMinor, input.returnQuantity, input.originalQuantity),
    sgstMinor: proportion(input.originalSgstMinor, input.returnQuantity, input.originalQuantity),
    igstMinor: proportion(input.originalIgstMinor, input.returnQuantity, input.originalQuantity),
  };
}

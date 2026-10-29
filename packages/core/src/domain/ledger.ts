import { money, type Money } from "../money";
import type { CustomerLedgerEntryType } from "./entities";

/**
 * Customer credit-book math, ported from the Android app's `Ledger`/`RoomCustomerRepository`:
 * FIFO settlement (every payment or return pays off the *oldest* outstanding charge first,
 * with any excess carried forward as advance credit against future charges), aging buckets, and
 * credit limit/hold checks.
 */

const DAY_MS = 86_400_000;

export interface LedgerEntryInput {
  type: CustomerLedgerEntryType;
  amountMinor: Money;
  createdAt: number;
}

export interface AgeBuckets {
  upTo7DaysMinor: Money;
  upTo30DaysMinor: Money;
  over30DaysMinor: Money;
}

export interface LedgerAgingResult {
  balanceMinor: Money;
  /** When the oldest still-outstanding charge was created; null if nothing is owed. */
  owingSinceMillis: number | null;
  buckets: AgeBuckets;
}

/**
 * Processes ledger entries in chronological order, settling each PAYMENT/RETURN against the
 * oldest outstanding SALE/OPENING_BALANCE charge(s) first. POINTS_* and PROMISE entries carry
 * no money effect and are ignored here (they're read from the ledger separately).
 */
export function computeLedgerAging(entries: readonly LedgerEntryInput[], nowMillis: number): LedgerAgingResult {
  const sorted = [...entries].sort((a, b) => a.createdAt - b.createdAt);
  const charges: { createdAt: number; remaining: number }[] = [];
  let advanceCredit = 0;

  for (const entry of sorted) {
    if (entry.type === "SALE" || entry.type === "OPENING_BALANCE") {
      let amount = entry.amountMinor as number;
      if (advanceCredit > 0) {
        const used = Math.min(advanceCredit, amount);
        advanceCredit -= used;
        amount -= used;
      }
      if (amount > 0) {
        charges.push({ createdAt: entry.createdAt, remaining: amount });
      }
    } else if (entry.type === "PAYMENT" || entry.type === "RETURN") {
      let settlement = entry.amountMinor as number;
      while (settlement > 0 && charges.length > 0) {
        const front = charges[0]!;
        const used = Math.min(front.remaining, settlement);
        front.remaining -= used;
        settlement -= used;
        if (front.remaining === 0) charges.shift();
      }
      if (settlement > 0) {
        advanceCredit += settlement;
      }
    }
    // POINTS_EARNED / POINTS_REDEEMED / POINTS_REVERSED / PROMISE: no money effect.
  }

  const outstandingTotal = charges.reduce((sum, c) => sum + c.remaining, 0);
  const balanceMinor = money(outstandingTotal - advanceCredit);
  const owingSinceMillis = charges.length > 0 ? charges[0]!.createdAt : null;

  const buckets: AgeBuckets = { upTo7DaysMinor: money(0), upTo30DaysMinor: money(0), over30DaysMinor: money(0) };
  for (const charge of charges) {
    const ageDays = (nowMillis - charge.createdAt) / DAY_MS;
    if (ageDays <= 7) {
      buckets.upTo7DaysMinor = money(buckets.upTo7DaysMinor + charge.remaining);
    } else if (ageDays <= 30) {
      buckets.upTo30DaysMinor = money(buckets.upTo30DaysMinor + charge.remaining);
    } else {
      buckets.over30DaysMinor = money(buckets.over30DaysMinor + charge.remaining);
    }
  }

  return { balanceMinor, owingSinceMillis, buckets };
}

export function ageInDays(sinceMillis: number, nowMillis: number): number {
  return Math.floor((nowMillis - sinceMillis) / DAY_MS);
}

/**
 * True when the customer should be blocked from further on-account sales: they owe something,
 * and the oldest unpaid charge is older than `creditHoldDays` (0 = credit hold is off).
 */
export function isCustomerOnHold(
  owingSinceMillis: number | null,
  nowMillis: number,
  balanceMinor: Money,
  creditHoldDays: number,
): boolean {
  if (creditHoldDays <= 0) return false;
  if (balanceMinor <= 0 || owingSinceMillis === null) return false;
  return ageInDays(owingSinceMillis, nowMillis) > creditHoldDays;
}

export class CreditLimitExceededError extends Error {
  constructor(
    public readonly currentBalanceMinor: Money,
    public readonly saleAmountMinor: Money,
    public readonly creditLimitMinor: Money,
  ) {
    super("This sale would put the customer over their credit limit");
    this.name = "CreditLimitExceededError";
  }
}

/** Throws `CreditLimitExceededError` if adding `saleAmountMinor` would exceed the customer's
 *  credit limit. A null limit means no cap. */
export function checkCreditLimit(currentBalanceMinor: Money, saleAmountMinor: Money, creditLimitMinor: Money | null): void {
  if (creditLimitMinor === null) return;
  if ((currentBalanceMinor as number) + (saleAmountMinor as number) > (creditLimitMinor as number)) {
    throw new CreditLimitExceededError(currentBalanceMinor, saleAmountMinor, creditLimitMinor);
  }
}

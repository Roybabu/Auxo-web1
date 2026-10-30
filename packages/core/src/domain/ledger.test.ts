import { describe, expect, it } from "vitest";
import { money } from "../money";
import {
  ageInDays,
  checkCreditLimit,
  computeLedgerAging,
  CreditLimitExceededError,
  isCustomerOnHold,
  type LedgerEntryInput,
} from "./ledger";

const DAY = 86_400_000;
const T0 = 1_700_000_000_000; // an arbitrary fixed "now" anchor

describe("computeLedgerAging", () => {
  it("a single sale with no payment is fully outstanding, owing since its own date", () => {
    const entries: LedgerEntryInput[] = [{ type: "SALE", amountMinor: money(1000), createdAt: T0 }];
    const result = computeLedgerAging(entries, T0 + 1 * DAY);
    expect(result.balanceMinor).toBe(1000);
    expect(result.owingSinceMillis).toBe(T0);
  });

  it("a full payment clears the balance and owingSince", () => {
    const entries: LedgerEntryInput[] = [
      { type: "SALE", amountMinor: money(1000), createdAt: T0 },
      { type: "PAYMENT", amountMinor: money(-1000), createdAt: T0 + DAY },
    ];
    const result = computeLedgerAging(entries, T0 + 2 * DAY);
    expect(result.balanceMinor).toBe(0);
    expect(result.owingSinceMillis).toBeNull();
  });

  it("settles the oldest charge first (FIFO) across multiple sales", () => {
    const entries: LedgerEntryInput[] = [
      { type: "SALE", amountMinor: money(500), createdAt: T0 },
      { type: "SALE", amountMinor: money(300), createdAt: T0 + DAY },
      { type: "PAYMENT", amountMinor: money(-500), createdAt: T0 + 2 * DAY },
    ];
    const result = computeLedgerAging(entries, T0 + 3 * DAY);
    // The ₹500 payment should have fully cleared the first (older) ₹500 sale, leaving only
    // the ₹300 sale outstanding, owing since its own date.
    expect(result.balanceMinor).toBe(300);
    expect(result.owingSinceMillis).toBe(T0 + DAY);
  });

  it("a partial payment reduces the oldest charge without touching newer ones", () => {
    const entries: LedgerEntryInput[] = [
      { type: "SALE", amountMinor: money(500), createdAt: T0 },
      { type: "SALE", amountMinor: money(300), createdAt: T0 + DAY },
      { type: "PAYMENT", amountMinor: money(-200), createdAt: T0 + 2 * DAY },
    ];
    const result = computeLedgerAging(entries, T0 + 3 * DAY);
    expect(result.balanceMinor).toBe(600); // 500-200 + 300
    expect(result.owingSinceMillis).toBe(T0); // the ₹300-remaining-of-500 sale is still oldest
  });

  it("an overpayment becomes advance credit applied to the next future charge", () => {
    const entries: LedgerEntryInput[] = [
      { type: "SALE", amountMinor: money(500), createdAt: T0 },
      { type: "PAYMENT", amountMinor: money(-800), createdAt: T0 + DAY }, // pays 500, ₹300 advance
      { type: "SALE", amountMinor: money(1000), createdAt: T0 + 2 * DAY },
    ];
    const result = computeLedgerAging(entries, T0 + 3 * DAY);
    // ₹300 advance offsets part of the ₹1000 sale, leaving ₹700 outstanding.
    expect(result.balanceMinor).toBe(700);
    expect(result.owingSinceMillis).toBe(T0 + 2 * DAY);
  });

  it("buckets outstanding charges by age at the boundary values", () => {
    const entries: LedgerEntryInput[] = [
      { type: "SALE", amountMinor: money(100), createdAt: T0 }, // exactly 7 days old at check time
      { type: "SALE", amountMinor: money(200), createdAt: T0 - 23 * DAY }, // exactly 30 days old
      { type: "SALE", amountMinor: money(300), createdAt: T0 - 31 * DAY }, // 38 days old at check time
    ];
    const now = T0 + 7 * DAY;
    const result = computeLedgerAging(entries, now);
    expect(result.buckets.upTo7DaysMinor).toBe(100);
    expect(result.buckets.upTo30DaysMinor).toBe(200);
    expect(result.buckets.over30DaysMinor).toBe(300);
  });

  it("OPENING_BALANCE behaves like a charge", () => {
    const entries: LedgerEntryInput[] = [{ type: "OPENING_BALANCE", amountMinor: money(2000), createdAt: T0 }];
    const result = computeLedgerAging(entries, T0 + DAY);
    expect(result.balanceMinor).toBe(2000);
  });

  it("ignores POINTS_* and PROMISE entries entirely", () => {
    const entries: LedgerEntryInput[] = [
      { type: "SALE", amountMinor: money(500), createdAt: T0 },
      { type: "POINTS_EARNED", amountMinor: money(0), createdAt: T0 + DAY },
      { type: "PROMISE", amountMinor: money(0), createdAt: T0 + DAY },
    ];
    const result = computeLedgerAging(entries, T0 + 2 * DAY);
    expect(result.balanceMinor).toBe(500);
  });
});

describe("ageInDays", () => {
  it("floors to whole days", () => {
    expect(ageInDays(T0, T0 + 1.9 * DAY)).toBe(1);
    expect(ageInDays(T0, T0 + 2 * DAY)).toBe(2);
  });
});

describe("isCustomerOnHold", () => {
  it("is never on hold when creditHoldDays is 0 (off)", () => {
    expect(isCustomerOnHold(T0, T0 + 1000 * DAY, money(500), 0)).toBe(false);
  });

  it("is not on hold with a zero or negative balance", () => {
    expect(isCustomerOnHold(T0, T0 + 1000 * DAY, money(0), 30)).toBe(false);
  });

  it("is on hold once the oldest charge exceeds creditHoldDays", () => {
    expect(isCustomerOnHold(T0, T0 + 31 * DAY, money(500), 30)).toBe(true);
    expect(isCustomerOnHold(T0, T0 + 29 * DAY, money(500), 30)).toBe(false);
  });
});

describe("checkCreditLimit", () => {
  it("allows any sale when the limit is null (no cap)", () => {
    expect(() => checkCreditLimit(money(1_000_000), money(1_000_000), null)).not.toThrow();
  });

  it("throws when balance + sale would exceed the limit", () => {
    expect(() => checkCreditLimit(money(9000), money(2000), money(10_000))).toThrow(CreditLimitExceededError);
  });

  it("allows a sale that lands exactly on the limit", () => {
    expect(() => checkCreditLimit(money(8000), money(2000), money(10_000))).not.toThrow();
  });
});

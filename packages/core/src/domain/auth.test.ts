import { describe, expect, it } from "vitest";
import {
  generateRecoveryCodes,
  hashPin,
  redeemRecoveryCode,
  validatePinFormat,
  verifyPin,
} from "./auth";

describe("validatePinFormat", () => {
  it("accepts 4-8 digit PINs", () => {
    expect(validatePinFormat("1234")).toBeNull();
    expect(validatePinFormat("12345678")).toBeNull();
  });

  it("rejects too short, too long, or non-numeric PINs", () => {
    expect(validatePinFormat("123")).not.toBeNull();
    expect(validatePinFormat("123456789")).not.toBeNull();
    expect(validatePinFormat("12a4")).not.toBeNull();
  });
});

describe("PIN hashing", () => {
  it("verifies the correct PIN and rejects a wrong one", async () => {
    const credential = await hashPin("4821");
    expect(await verifyPin("4821", credential)).toBe(true);
    expect(await verifyPin("1111", credential)).toBe(false);
  });

  it("uses a different salt (and thus hash) for the same PIN on repeated calls", async () => {
    const a = await hashPin("4821");
    const b = await hashPin("4821");
    expect(a.pinSalt).not.toBe(b.pinSalt);
    expect(a.pinHash).not.toBe(b.pinHash);
  });
});

describe("recovery codes", () => {
  it("generates 8 unique codes and can redeem one, removing it from the stored list", async () => {
    const { plaintext, hashes } = await generateRecoveryCodes();
    expect(plaintext.length).toBe(8);
    expect(new Set(plaintext).size).toBe(8);

    const codeToRedeem = plaintext[3]!;
    const result = await redeemRecoveryCode(codeToRedeem, hashes);
    expect(result.matched).toBe(true);
    expect(result.remainingHashes.length).toBe(7);

    const secondAttempt = await redeemRecoveryCode(codeToRedeem, result.remainingHashes);
    expect(secondAttempt.matched).toBe(false);
  });

  it("rejects a code that was never issued", async () => {
    const { hashes } = await generateRecoveryCodes();
    const result = await redeemRecoveryCode("ZZZZZ-99999", hashes);
    expect(result.matched).toBe(false);
    expect(result.remainingHashes.length).toBe(hashes.length);
  });
});

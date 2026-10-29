/**
 * Local sign-in: PIN-based, no accounts, no server. There is no `users` table in the Android
 * app's Room schema (`app/schemas/.../1.json`'s 25 tables), so unlike the business-data tables
 * and the backup format, there is nothing here to byte-match — this is a fresh design for the
 * web app, not a port. A reasonable, standard local scheme: PBKDF2-derived PIN hash with a
 * per-user random salt, plus one-time recovery codes (hashed the same way) for when a PIN is
 * forgotten.
 */

import { bs } from "../backup/webCryptoCompat";

const PIN_PBKDF2_ITERATIONS = 210_000; // OWASP's 2023 minimum recommendation for PBKDF2-SHA256
const PIN_HASH_LENGTH_BYTES = 32;
const SALT_LENGTH_BYTES = 16;
const RECOVERY_CODE_COUNT = 8;
const RECOVERY_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I, avoids confusion

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function pbkdf2Hash(secret: string, salt: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    bs(new TextEncoder().encode(secret)),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: bs(salt), iterations: PIN_PBKDF2_ITERATIONS },
    key,
    PIN_HASH_LENGTH_BYTES * 8,
  );
  return new Uint8Array(bits);
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export const MIN_PIN_LENGTH = 4;
export const MAX_PIN_LENGTH = 8;

export function validatePinFormat(pin: string): string | null {
  if (!/^\d+$/.test(pin)) return "PIN must be digits only";
  if (pin.length < MIN_PIN_LENGTH || pin.length > MAX_PIN_LENGTH) {
    return `PIN must be ${MIN_PIN_LENGTH}-${MAX_PIN_LENGTH} digits`;
  }
  return null;
}

export interface PinCredential {
  pinHash: string; // hex
  pinSalt: string; // hex
}

export async function hashPin(pin: string): Promise<PinCredential> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH_BYTES));
  const hash = await pbkdf2Hash(pin, salt);
  return { pinHash: toHex(hash), pinSalt: toHex(salt) };
}

export async function verifyPin(pin: string, credential: PinCredential): Promise<boolean> {
  const salt = fromHex(credential.pinSalt);
  const hash = await pbkdf2Hash(pin, salt);
  return timingSafeEqualHex(toHex(hash), credential.pinHash);
}

/** Generates fresh recovery codes (plaintext, shown once) and their hashes (what gets stored). */
export async function generateRecoveryCodes(): Promise<{ plaintext: string[]; hashes: string[] }> {
  const plaintext: string[] = [];
  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
    const bytes = crypto.getRandomValues(new Uint8Array(10));
    let code = "";
    for (const b of bytes) {
      code += RECOVERY_CODE_ALPHABET[b % RECOVERY_CODE_ALPHABET.length];
    }
    plaintext.push(`${code.slice(0, 5)}-${code.slice(5, 10)}`);
  }
  const hashes = await Promise.all(plaintext.map((code) => hashRecoveryCode(code)));
  return { plaintext, hashes };
}

export async function hashRecoveryCode(code: string): Promise<string> {
  // Recovery codes are high-entropy and single-use, so a fixed, non-secret salt is fine here —
  // unlike PIN hashes, which protect a low-entropy, guessable value against a stolen database.
  const salt = new TextEncoder().encode("auxo-recovery-code");
  const hash = await pbkdf2Hash(code.toUpperCase().replace(/[^A-Z0-9]/g, ""), salt);
  return toHex(hash);
}

/** Checks `code` against a list of stored hashes and, if it matches, returns the remaining list
 *  with that hash removed (recovery codes are single-use). */
export async function redeemRecoveryCode(
  code: string,
  storedHashes: readonly string[],
): Promise<{ matched: boolean; remainingHashes: string[] }> {
  const hash = await hashRecoveryCode(code);
  const index = storedHashes.findIndex((h) => timingSafeEqualHex(h, hash));
  if (index === -1) {
    return { matched: false, remainingHashes: [...storedHashes] };
  }
  const remaining = [...storedHashes];
  remaining.splice(index, 1);
  return { matched: true, remainingHashes: remaining };
}

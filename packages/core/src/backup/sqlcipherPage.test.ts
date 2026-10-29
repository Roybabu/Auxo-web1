import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  decryptSqlCipherDatabase,
  encryptSqlCipherDatabase,
  looksLikePlaintextSqlite,
  WrongDatabaseKeyError,
} from "./sqlcipherPage";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");

interface Sidecar {
  databaseKeyHex: string;
  roomIdentityHash: string;
  databaseFirst16BytesHex: string;
}

function loadFixture(): { db: Uint8Array; sidecar: Sidecar } {
  const db = new Uint8Array(readFileSync(join(fixturesDir, "auxo.db")));
  const sidecar = JSON.parse(
    readFileSync(join(fixturesDir, "sample.auxobak.json"), "utf8"),
  ) as Sidecar;
  return { db, sidecar };
}

function containsAscii(haystack: Uint8Array, needle: string): boolean {
  const needleBytes = new TextEncoder().encode(needle);
  outer: for (let i = 0; i <= haystack.length - needleBytes.length; i++) {
    for (let j = 0; j < needleBytes.length; j++) {
      if (haystack[i + j] !== needleBytes[j]) continue outer;
    }
    return true;
  }
  return false;
}

describe("SQLCipher page decryption, against a real SQLCipher-4-compatible fixture", () => {
  it("the fixture does not look like a plain SQLite file (sanity check)", () => {
    const { db } = loadFixture();
    expect(looksLikePlaintextSqlite(db)).toBe(false);
  });

  it("decrypts the real fixture and recovers the plain SQLite magic header", async () => {
    const { db, sidecar } = loadFixture();
    const plain = await decryptSqlCipherDatabase(sidecar.databaseKeyHex, db);
    expect(looksLikePlaintextSqlite(plain)).toBe(true);
    expect(plain.length).toBe(db.length);
  });

  it("recovers the known row content written by the Java generator", async () => {
    const { db, sidecar } = loadFixture();
    const plain = await decryptSqlCipherDatabase(sidecar.databaseKeyHex, db);
    // The Java harness inserted these literal values into the database before encrypting it;
    // finding them in the decrypted bytes proves the page cipher (key derivation, HMAC
    // verification, and AES-256-CBC decryption) is correct, not just "looks like SQLite".
    expect(containsAscii(plain, sidecar.roomIdentityHash)).toBe(true);
    expect(containsAscii(plain, "Sample Product")).toBe(true);
  });

  it("rejects a wrong database key", async () => {
    const { db } = loadFixture();
    await expect(decryptSqlCipherDatabase("0".repeat(64), db)).rejects.toThrow(WrongDatabaseKeyError);
  });

  it("leaves an already-plaintext file untouched", async () => {
    const plain = new Uint8Array(4096);
    plain.set(new TextEncoder().encode("SQLite format 3\0"));
    const result = await decryptSqlCipherDatabase("irrelevant-key", plain);
    expect(result).toEqual(plain);
  });
});

describe("SQLCipher page encryption, round-trip against our own implementation", () => {
  it("encrypts then decrypts back to the same plaintext bytes", async () => {
    const pageSize = 4096;
    const pageCount = 3;
    const plain = new Uint8Array(pageSize * pageCount);
    plain.set(new TextEncoder().encode("SQLite format 3\0"), 0);
    for (let i = 16; i < plain.length; i++) {
      plain[i] = (i * 7) % 256;
    }
    // Zero the reserved tail of every page, as a real SQLite file configured with
    // cipher_reserve would leave it (content there is not meaningful plaintext).
    const reserve = 80;
    for (let pgno = 1; pgno <= pageCount; pgno++) {
      const pageStart = (pgno - 1) * pageSize;
      plain.fill(0, pageStart + pageSize - reserve, pageStart + pageSize);
    }

    const passphrase = "e".repeat(64);
    const encrypted = await encryptSqlCipherDatabase(passphrase, plain, pageSize);
    expect(looksLikePlaintextSqlite(encrypted)).toBe(false);

    const decrypted = await decryptSqlCipherDatabase(passphrase, encrypted, pageSize);
    // Content regions must match exactly; reserved tail bytes (now IV+HMAC on the encrypted
    // side) are not meaningful plaintext, so only compare the real content per page.
    for (let pgno = 1; pgno <= pageCount; pgno++) {
      const pageStart = (pgno - 1) * pageSize;
      const headerOffset = pgno === 1 ? 16 : 0;
      const contentEnd = pageStart + pageSize - reserve;
      expect(decrypted.slice(pageStart + headerOffset, contentEnd)).toEqual(
        plain.slice(pageStart + headerOffset, contentEnd),
      );
    }
  });
});

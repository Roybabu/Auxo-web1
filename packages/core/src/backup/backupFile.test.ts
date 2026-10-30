import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createBackup, parseBackupZip, restoreBackup } from "./backupFile";
import { readProperties, writeProperties } from "./javaProperties";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");

interface Sidecar {
  passphrase: string;
  databaseKeyHex: string;
  roomIdentityHash: string;
}

function loadFixture(): { auxobak: Uint8Array; sidecar: Sidecar } {
  const auxobak = new Uint8Array(readFileSync(join(fixturesDir, "sample.auxobak")));
  const sidecar = JSON.parse(
    readFileSync(join(fixturesDir, "sample.auxobak.json"), "utf8"),
  ) as Sidecar;
  return { auxobak, sidecar };
}

describe("java properties format", () => {
  it("round-trips a representative set of keys", () => {
    const entries = {
      app: "auxo",
      format: "1",
      database_version: "1",
      app_version: "0.0.0-test",
      shop: "1",
    };
    const bytes = writeProperties(entries);
    expect(readProperties(bytes)).toEqual(entries);
  });

  it("parses the real manifest.properties written by the Java generator", async () => {
    const { auxobak, sidecar } = loadFixture();
    const { decryptAuxobak } = await import("./outerEnvelope");
    const zipBytes = await decryptAuxobak(sidecar.passphrase, auxobak);
    const parsed = parseBackupZip(zipBytes);
    expect(parsed.manifest.app).toBe("auxo");
    expect(parsed.manifest.format).toBe(1);
    expect(parsed.manifest.databaseVersion).toBe(1);
    expect(parsed.databaseKeyHex).toBe(sidecar.databaseKeyHex);
    expect(parsed.appearance.darkMode).toBe(true);
  });
});

describe("restoreBackup, against the real fixture", () => {
  it("fully restores the real .auxobak end-to-end, recovering the real row content", async () => {
    const { auxobak, sidecar } = loadFixture();
    const restored = await restoreBackup(sidecar.passphrase, auxobak);
    expect(restored.manifest.app).toBe("auxo");
    expect(restored.appearance.darkMode).toBe(true);

    const text = new TextDecoder("latin1").decode(restored.databaseBytes);
    expect(text).toContain(sidecar.roomIdentityHash);
    expect(text).toContain("Sample Product");
    expect(text.startsWith("SQLite format 3\0")).toBe(true);
  });
});

describe("createBackup + restoreBackup, full round trip against our own implementation", () => {
  it("creates a backup and restores it back to the same plain database bytes", async () => {
    const pageSize = 4096;
    const plainDatabaseBytes = new Uint8Array(pageSize * 2);
    plainDatabaseBytes.set(new TextEncoder().encode("SQLite format 3\0"), 0);
    for (let i = 16; i < plainDatabaseBytes.length; i++) {
      plainDatabaseBytes[i] = (i * 13) % 256;
    }
    const reserve = 80;
    for (let pgno = 1; pgno <= 2; pgno++) {
      const pageStart = (pgno - 1) * pageSize;
      plainDatabaseBytes.fill(0, pageStart + pageSize - reserve, pageStart + pageSize);
    }

    const { auxobak } = await createBackup({
      backupPassphrase: "a-reasonably-long-test-passphrase",
      plainDatabaseBytes,
      databaseVersion: 1,
      appVersion: "0.0.0-test",
      counts: { shop: 1, products: 2 },
      appearance: {
        accent: "0",
        darkMode: true,
        restaurantMenu: false,
        suppliers: false,
        creditHoldDays: 0,
        onTimeBonusPoints: 0,
      },
      outerIterations: 10_000,
    });

    const restored = await restoreBackup("a-reasonably-long-test-passphrase", auxobak);
    expect(restored.manifest.databaseVersion).toBe(1);
    expect(restored.manifest.products).toBe(2);
    expect(restored.appearance.darkMode).toBe(true);

    const headerOffset = 16;
    const contentEnd = pageSize - reserve;
    expect(restored.databaseBytes.slice(headerOffset, contentEnd)).toEqual(
      plainDatabaseBytes.slice(headerOffset, contentEnd),
    );
    const secondPageStart = pageSize;
    expect(restored.databaseBytes.slice(secondPageStart, secondPageStart + contentEnd)).toEqual(
      plainDatabaseBytes.slice(secondPageStart, secondPageStart + contentEnd),
    );
  });

  it("lockDatabase: false round-trips an ordinary (non-reserve-laid-out) SQLite export unchanged", async () => {
    // Deliberately uses the full page with no reserved tail — representative of a plain SQLite
    // WASM export, which has no codec attached to reserve space. Encrypting this with the
    // SQLCipher page cipher (lockDatabase: true) would corrupt the last 80 bytes of every page;
    // lockDatabase: false must skip that and still round-trip the bytes exactly.
    const plainDatabaseBytes = new Uint8Array(4096 * 2);
    plainDatabaseBytes.set(new TextEncoder().encode("SQLite format 3\0"), 0);
    for (let i = 16; i < plainDatabaseBytes.length; i++) {
      plainDatabaseBytes[i] = (i * 31) % 256;
    }

    const { auxobak, databaseKeyHex } = await createBackup({
      backupPassphrase: "a-reasonably-long-test-passphrase",
      plainDatabaseBytes,
      databaseVersion: 1,
      appVersion: "0.0.0-test",
      appearance: {
        accent: null,
        darkMode: null,
        restaurantMenu: null,
        suppliers: null,
        creditHoldDays: null,
        onTimeBonusPoints: null,
      },
      lockDatabase: false,
      outerIterations: 10_000,
    });
    expect(databaseKeyHex).toBeNull();

    const restored = await restoreBackup("a-reasonably-long-test-passphrase", auxobak);
    expect(restored.databaseBytes).toEqual(plainDatabaseBytes);
  });

  it("rejects the wrong passphrase", async () => {
    const plainDatabaseBytes = new Uint8Array(4096);
    plainDatabaseBytes.set(new TextEncoder().encode("SQLite format 3\0"), 0);
    const { auxobak } = await createBackup({
      backupPassphrase: "right-passphrase-value-here",
      plainDatabaseBytes,
      databaseVersion: 1,
      appVersion: null,
      appearance: {
        accent: null,
        darkMode: null,
        restaurantMenu: null,
        suppliers: null,
        creditHoldDays: null,
        onTimeBonusPoints: null,
      },
      outerIterations: 10_000,
    });
    await expect(restoreBackup("wrong-passphrase-value-here", auxobak)).rejects.toThrow();
  });
});

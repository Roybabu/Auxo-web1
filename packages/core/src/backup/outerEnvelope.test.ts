import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decryptAuxobak, encryptAuxobak, WrongPassphraseError, parseOuterHeader } from "./outerEnvelope";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");

interface Sidecar {
  passphrase: string;
  outerIterations: number;
  outerSaltHex: string;
  zipBytes: number;
  zipSha256: string;
  auxobakBytes: number;
  auxobakSha256: string;
}

function loadFixture(): { auxobak: Uint8Array; sidecar: Sidecar } {
  const auxobak = new Uint8Array(readFileSync(join(fixturesDir, "sample.auxobak")));
  const sidecar = JSON.parse(
    readFileSync(join(fixturesDir, "sample.auxobak.json"), "utf8"),
  ) as Sidecar;
  return { auxobak, sidecar };
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("outer envelope, against a real Tink-generated fixture", () => {
  it("the fixture file itself matches its recorded hash (sanity check on the fixture)", () => {
    const { auxobak, sidecar } = loadFixture();
    expect(auxobak.length).toBe(sidecar.auxobakBytes);
    expect(sha256Hex(auxobak)).toBe(sidecar.auxobakSha256);
  });

  it("parses the outer header the same way the Java generator recorded it", () => {
    const { auxobak, sidecar } = loadFixture();
    const header = parseOuterHeader(auxobak);
    expect(header.iterations).toBe(sidecar.outerIterations);
    expect(Buffer.from(header.salt).toString("hex")).toBe(sidecar.outerSaltHex);
  });

  it("decrypts a real Tink-Java-generated .auxobak to the exact original zip bytes", async () => {
    const { auxobak, sidecar } = loadFixture();
    const plaintext = await decryptAuxobak(sidecar.passphrase, auxobak);
    expect(plaintext.length).toBe(sidecar.zipBytes);
    expect(sha256Hex(plaintext)).toBe(sidecar.zipSha256);
  });

  it("rejects a wrong passphrase on the real fixture", async () => {
    const { auxobak } = loadFixture();
    await expect(decryptAuxobak("definitely the wrong passphrase", auxobak)).rejects.toThrow(
      WrongPassphraseError,
    );
  });
});

describe("outer envelope, round-trip against our own implementation", () => {
  it("encrypts and decrypts back to the original plaintext, single segment", async () => {
    const plaintext = new TextEncoder().encode("hello auxo backup world");
    const passphrase = "a-decent-test-passphrase";
    const auxobak = await encryptAuxobak(passphrase, plaintext, { iterations: 10_000 });
    const roundTripped = await decryptAuxobak(passphrase, auxobak);
    expect(roundTripped).toEqual(plaintext);
  });

  it("rejects a wrong passphrase on its own output", async () => {
    const plaintext = new TextEncoder().encode("secret zip bytes");
    const auxobak = await encryptAuxobak("right-passphrase-here", plaintext, { iterations: 10_000 });
    await expect(decryptAuxobak("wrong-passphrase-here", auxobak)).rejects.toThrow(WrongPassphraseError);
  });

  it("round-trips plaintext that spans multiple 1 MiB Tink segments", async () => {
    const size = (1 << 20) * 2 + 12345; // a bit over two full segments
    const plaintext = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
      plaintext[i] = i % 256;
    }
    const passphrase = "multi-segment-test-passphrase";
    const auxobak = await encryptAuxobak(passphrase, plaintext, { iterations: 10_000 });
    const roundTripped = await decryptAuxobak(passphrase, auxobak);
    expect(roundTripped).toEqual(plaintext);
  });

  it("round-trips an empty plaintext", async () => {
    const plaintext = new Uint8Array(0);
    const passphrase = "empty-plaintext-passphrase";
    const auxobak = await encryptAuxobak(passphrase, plaintext, { iterations: 10_000 });
    const roundTripped = await decryptAuxobak(passphrase, auxobak);
    expect(roundTripped).toEqual(plaintext);
  });
});

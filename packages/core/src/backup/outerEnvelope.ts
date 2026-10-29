/**
 * The outer `.auxobak` envelope: an 8-byte magic + 4-byte PBKDF2 iteration count + 16-byte
 * salt, followed by a Tink `AesGcmHkdfStreaming` ciphertext stream (the same scheme the
 * Android app uses, via `com.google.crypto.tink:tink-android`).
 *
 * This is a from-scratch TypeScript re-implementation of Tink's exact on-disk framing, built
 * directly from Tink's own Java source (`AesGcmHkdfStreaming.java`,
 * `StreamingAeadEncryptingStream.java`, `StreamingAeadDecryptingStream.java`,
 * `Hkdf.java` — see docs/backup-format.md for the citation), not an approximation — and
 * verified byte-for-byte against a real file produced by the actual Tink Java library (see
 * `tools/android-backup-vectors/`).
 *
 * Framing summary (ikm = the 32-byte key derived from the backup passphrase via PBKDF2):
 * - Per-message Tink header: 1 byte (= header length) || random salt (keySizeBytes) ||
 *   random nonce prefix (7 bytes).
 * - Per-message AES key = HKDF-SHA256(ikm, salt, info = associatedData, length = keySizeBytes).
 *   The associated data is the outer 28-byte AUXOENC1 header.
 * - Ciphertext is split into fixed-size segments (segmentSize = 1 MiB, including a 16-byte
 *   GCM tag). The first segment is shorter by exactly the Tink header length, so that
 *   (header + segment 0) aligns to segmentSize; every later segment is full-size; the last
 *   segment holds whatever plaintext remains.
 * - Each segment's AES-GCM nonce = noncePrefix(7) || segmentNumber as big-endian uint32(4) ||
 *   isLastSegment ? 1 : 0 (1 byte) = 12 bytes total. No per-segment GCM associated data.
 */

import { bs } from "./webCryptoCompat";

export const OUTER_MAGIC = "AUXOENC1";
const MAGIC_BYTES = new TextEncoder().encode(OUTER_MAGIC);
export const OUTER_HEADER_LENGTH = 8 + 4 + 16;
export const DEFAULT_PBKDF2_ITERATIONS = 600_000;
export const MAX_PBKDF2_ITERATIONS = 5_000_000;

const TINK_KEY_SIZE_BYTES = 32;
const TINK_NONCE_PREFIX_BYTES = 7;
const TINK_TAG_BYTES = 16;
const TINK_NONCE_BYTES = 12;
const CIPHERTEXT_SEGMENT_SIZE = 1 << 20; // 1 MiB, matches BackupCrypto.kt
const TINK_HEADER_LENGTH = 1 + TINK_KEY_SIZE_BYTES + TINK_NONCE_PREFIX_BYTES; // 40

export class WrongPassphraseError extends Error {
  constructor() {
    super("Wrong passphrase or corrupt backup file");
    this.name = "WrongPassphraseError";
  }
}

export class NotAnAuxoBackupError extends Error {
  constructor() {
    super("File does not have the AUXOENC1 magic header");
    this.name = "NotAnAuxoBackupError";
  }
}

export interface OuterHeader {
  iterations: number;
  salt: Uint8Array;
  /** The raw 28-byte header, also used as the Tink associated data / HKDF info. */
  bytes: Uint8Array;
}

export function parseOuterHeader(bytes: Uint8Array): OuterHeader {
  if (bytes.length < OUTER_HEADER_LENGTH) {
    throw new NotAnAuxoBackupError();
  }
  for (let i = 0; i < MAGIC_BYTES.length; i++) {
    if (bytes[i] !== MAGIC_BYTES[i]) {
      throw new NotAnAuxoBackupError();
    }
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const iterations = view.getUint32(8, false);
  const salt = bytes.slice(12, 12 + 16);
  return { iterations, salt, bytes: bytes.slice(0, OUTER_HEADER_LENGTH) };
}

export function buildOuterHeader(iterations: number, salt: Uint8Array): Uint8Array {
  if (salt.length !== 16) {
    throw new Error("salt must be 16 bytes");
  }
  const header = new Uint8Array(OUTER_HEADER_LENGTH);
  header.set(MAGIC_BYTES, 0);
  new DataView(header.buffer).setUint32(8, iterations, false);
  header.set(salt, 12);
  return header;
}

async function derivePbkdf2Key(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const passphraseKey = await crypto.subtle.importKey(
    "raw",
    bs(new TextEncoder().encode(passphrase)),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: bs(salt), iterations },
    passphraseKey,
    TINK_KEY_SIZE_BYTES * 8,
  );
  return new Uint8Array(bits);
}

async function deriveSegmentKey(
  ikm: Uint8Array,
  tinkSalt: Uint8Array,
  info: Uint8Array,
): Promise<CryptoKey> {
  const ikmKey = await crypto.subtle.importKey("raw", bs(ikm), "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: bs(tinkSalt), info: bs(info) },
    ikmKey,
    TINK_KEY_SIZE_BYTES * 8,
  );
  return crypto.subtle.importKey("raw", bits, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function segmentNonce(noncePrefix: Uint8Array, segmentNr: number, isLast: boolean): Uint8Array {
  const nonce = new Uint8Array(TINK_NONCE_BYTES);
  nonce.set(noncePrefix, 0);
  new DataView(nonce.buffer).setUint32(TINK_NONCE_PREFIX_BYTES, segmentNr >>> 0, false);
  nonce[TINK_NONCE_PREFIX_BYTES + 4] = isLast ? 1 : 0;
  return nonce;
}

/**
 * Encrypts `plaintext` into a complete `.auxobak` file (outer header + Tink stream).
 */
export async function encryptAuxobak(
  passphrase: string,
  plaintext: Uint8Array,
  options?: { iterations?: number; outerSalt?: Uint8Array; tinkSalt?: Uint8Array; noncePrefix?: Uint8Array },
): Promise<Uint8Array> {
  const iterations = options?.iterations ?? DEFAULT_PBKDF2_ITERATIONS;
  const outerSalt = options?.outerSalt ?? crypto.getRandomValues(new Uint8Array(16));
  const header = buildOuterHeader(iterations, outerSalt);
  const ikm = await derivePbkdf2Key(passphrase, outerSalt, iterations);

  const tinkSalt = options?.tinkSalt ?? crypto.getRandomValues(new Uint8Array(TINK_KEY_SIZE_BYTES));
  const noncePrefix = options?.noncePrefix ?? crypto.getRandomValues(new Uint8Array(TINK_NONCE_PREFIX_BYTES));
  const aesKey = await deriveSegmentKey(ikm, tinkSalt, header);

  const tinkHeader = new Uint8Array(TINK_HEADER_LENGTH);
  tinkHeader[0] = TINK_HEADER_LENGTH;
  tinkHeader.set(tinkSalt, 1);
  tinkHeader.set(noncePrefix, 1 + TINK_KEY_SIZE_BYTES);

  const plaintextSegmentSize = CIPHERTEXT_SEGMENT_SIZE - TINK_TAG_BYTES;
  const firstPlaintextSegmentSize = plaintextSegmentSize - TINK_HEADER_LENGTH;

  const ciphertextChunks: Uint8Array[] = [header, tinkHeader];
  let offset = 0;
  let segmentNr = 0;
  let isFirst = true;
  while (true) {
    const chunkSize = isFirst ? firstPlaintextSegmentSize : plaintextSegmentSize;
    const remaining = plaintext.length - offset;
    const isLast = remaining <= chunkSize;
    const takeSize = isLast ? remaining : chunkSize;
    const chunk = plaintext.subarray(offset, offset + takeSize);
    const nonce = segmentNonce(noncePrefix, segmentNr, isLast);
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: bs(nonce), tagLength: TINK_TAG_BYTES * 8 },
      aesKey,
      bs(chunk),
    );
    ciphertextChunks.push(new Uint8Array(ciphertext));
    offset += takeSize;
    segmentNr += 1;
    isFirst = false;
    if (isLast) break;
  }

  const totalLength = ciphertextChunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLength);
  let pos = 0;
  for (const chunk of ciphertextChunks) {
    result.set(chunk, pos);
    pos += chunk.length;
  }
  return result;
}

/**
 * Decrypts a complete `.auxobak` file back into its original plaintext (the zip payload).
 * Throws `WrongPassphraseError` as soon as the first segment fails to authenticate, matching
 * the Android app's "detect wrong passphrase on the first segment" requirement.
 */
export async function decryptAuxobak(passphrase: string, auxobak: Uint8Array): Promise<Uint8Array> {
  const header = parseOuterHeader(auxobak);
  if (header.iterations < 1 || header.iterations > MAX_PBKDF2_ITERATIONS) {
    throw new Error(`Iteration count out of range: ${header.iterations}`);
  }
  const ikm = await derivePbkdf2Key(passphrase, header.salt, header.iterations);

  let pos = OUTER_HEADER_LENGTH;
  const tinkHeaderBytes = auxobak.subarray(pos, pos + TINK_HEADER_LENGTH);
  if (tinkHeaderBytes.length !== TINK_HEADER_LENGTH || tinkHeaderBytes[0] !== TINK_HEADER_LENGTH) {
    throw new WrongPassphraseError();
  }
  const tinkSalt = tinkHeaderBytes.slice(1, 1 + TINK_KEY_SIZE_BYTES);
  const noncePrefix = tinkHeaderBytes.slice(1 + TINK_KEY_SIZE_BYTES, TINK_HEADER_LENGTH);
  pos += TINK_HEADER_LENGTH;

  let aesKey: CryptoKey;
  try {
    aesKey = await deriveSegmentKey(ikm, tinkSalt, header.bytes);
  } catch {
    throw new WrongPassphraseError();
  }

  const firstCiphertextSegmentSize = CIPHERTEXT_SEGMENT_SIZE - TINK_HEADER_LENGTH;

  const plaintextChunks: Uint8Array[] = [];
  let segmentNr = 0;
  let isFirst = true;
  while (pos < auxobak.length) {
    const chunkSize = isFirst ? firstCiphertextSegmentSize : CIPHERTEXT_SEGMENT_SIZE;
    const remaining = auxobak.length - pos;
    const isLast = remaining <= chunkSize;
    const takeSize = isLast ? remaining : chunkSize;
    const ciphertextChunk = auxobak.subarray(pos, pos + takeSize);
    const nonce = segmentNonce(noncePrefix, segmentNr, isLast);
    try {
      const plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: bs(nonce), tagLength: TINK_TAG_BYTES * 8 },
        aesKey,
        bs(ciphertextChunk),
      );
      plaintextChunks.push(new Uint8Array(plaintext));
    } catch {
      throw new WrongPassphraseError();
    }
    pos += takeSize;
    segmentNr += 1;
    isFirst = false;
    if (isLast) break;
  }

  const totalLength = plaintextChunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLength);
  let outPos = 0;
  for (const chunk of plaintextChunks) {
    result.set(chunk, outPos);
    outPos += chunk.length;
  }
  return result;
}

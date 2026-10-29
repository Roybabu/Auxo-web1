import { unzipSync, zipSync } from "fflate";
import { decryptAuxobak, encryptAuxobak } from "./outerEnvelope";
import { readProperties, writeProperties } from "./javaProperties";
import { decryptSqlCipherDatabase, encryptSqlCipherDatabase } from "./sqlcipherPage";

const ZIP_ENTRY = {
  manifest: "manifest.properties",
  database: "auxo.db",
  databaseKey: "database.key",
  appearance: "appearance.properties",
} as const;

const PHOTO_PREFIX = "photos/";
const SUPPORTED_FORMAT = 1;
const DATABASE_KEY_HEX_PATTERN = /^[0-9a-f]{64}$/;

export class NotABackupError extends Error {
  constructor(reason: string) {
    super(`Not a valid Auxo backup: ${reason}`);
    this.name = "NotABackupError";
  }
}

export class WrongAppError extends Error {
  constructor() {
    super('manifest "app" is not "auxo" — this backup is from a different app');
    this.name = "WrongAppError";
  }
}

export class NewerBackupError extends Error {
  constructor(format: number) {
    super(`backup format ${format} is newer than this app supports (${SUPPORTED_FORMAT})`);
    this.name = "NewerBackupError";
  }
}

export interface BackupManifest {
  app: "auxo";
  format: number;
  created: number | null;
  databaseVersion: number;
  appVersion: string | null;
  shop: number | null;
  products: number | null;
  customers: number | null;
  invoices: number | null;
}

export interface AppearancePreferences {
  accent: string | null;
  darkMode: boolean | null;
  restaurantMenu: boolean | null;
  suppliers: boolean | null;
  creditHoldDays: number | null;
  onTimeBonusPoints: number | null;
}

export interface BackupPhoto {
  name: string;
  bytes: Uint8Array;
}

export interface ParsedBackupZip {
  manifest: BackupManifest;
  /** The encrypted (or, rarely, plaintext) SQLCipher database file bytes, as stored in the zip. */
  databaseBytes: Uint8Array;
  /** The 64-hex-char SQLCipher passphrase, present only when the database is locked. */
  databaseKeyHex: string | null;
  appearance: AppearancePreferences;
  photos: BackupPhoto[];
}

function parseManifest(bytes: Uint8Array): BackupManifest {
  const props = readProperties(bytes);
  if (props.app === undefined || props.format === undefined || props.database_version === undefined) {
    throw new NotABackupError("manifest.properties is missing required keys");
  }
  if (props.app !== "auxo") {
    throw new WrongAppError();
  }
  const format = Number.parseInt(props.format, 10);
  if (!Number.isFinite(format)) {
    throw new NotABackupError("manifest.properties has a non-numeric format");
  }
  if (format > SUPPORTED_FORMAT) {
    throw new NewerBackupError(format);
  }
  const databaseVersion = Number.parseInt(props.database_version, 10);
  if (!Number.isFinite(databaseVersion)) {
    throw new NotABackupError("manifest.properties has a non-numeric database_version");
  }
  return {
    app: "auxo",
    format,
    created: props.created !== undefined ? Number.parseInt(props.created, 10) : null,
    databaseVersion,
    appVersion: props.app_version ?? null,
    shop: props.shop !== undefined ? Number.parseInt(props.shop, 10) : null,
    products: props.products !== undefined ? Number.parseInt(props.products, 10) : null,
    customers: props.customers !== undefined ? Number.parseInt(props.customers, 10) : null,
    invoices: props.invoices !== undefined ? Number.parseInt(props.invoices, 10) : null,
  };
}

function buildManifestProperties(manifest: BackupManifest): Uint8Array {
  const entries: Record<string, string> = {
    app: manifest.app,
    format: String(manifest.format),
    database_version: String(manifest.databaseVersion),
  };
  if (manifest.created !== null) entries.created = String(manifest.created);
  if (manifest.appVersion !== null) entries.app_version = manifest.appVersion;
  if (manifest.shop !== null) entries.shop = String(manifest.shop);
  if (manifest.products !== null) entries.products = String(manifest.products);
  if (manifest.customers !== null) entries.customers = String(manifest.customers);
  if (manifest.invoices !== null) entries.invoices = String(manifest.invoices);
  return writeProperties(entries);
}

function parseAppearance(bytes: Uint8Array | undefined): AppearancePreferences {
  const props = bytes ? readProperties(bytes) : {};
  return {
    accent: props.accent ?? null,
    darkMode: props.dark_mode !== undefined ? props.dark_mode === "true" : null,
    restaurantMenu: props.restaurant_menu !== undefined ? props.restaurant_menu === "true" : null,
    suppliers: props.suppliers !== undefined ? props.suppliers === "true" : null,
    creditHoldDays: props.credit_hold_days !== undefined ? Number.parseInt(props.credit_hold_days, 10) : null,
    onTimeBonusPoints:
      props.on_time_bonus_points !== undefined ? Number.parseInt(props.on_time_bonus_points, 10) : null,
  };
}

function buildAppearanceProperties(appearance: AppearancePreferences): Uint8Array {
  const entries: Record<string, string> = {};
  if (appearance.accent !== null) entries.accent = appearance.accent;
  if (appearance.darkMode !== null) entries.dark_mode = String(appearance.darkMode);
  if (appearance.restaurantMenu !== null) entries.restaurant_menu = String(appearance.restaurantMenu);
  if (appearance.suppliers !== null) entries.suppliers = String(appearance.suppliers);
  if (appearance.creditHoldDays !== null) entries.credit_hold_days = String(appearance.creditHoldDays);
  if (appearance.onTimeBonusPoints !== null) {
    entries.on_time_bonus_points = String(appearance.onTimeBonusPoints);
  }
  return writeProperties(entries);
}

export function buildBackupZip(payload: {
  manifest: BackupManifest;
  databaseBytes: Uint8Array;
  databaseKeyHex: string | null;
  appearance: AppearancePreferences;
  photos: BackupPhoto[];
}): Uint8Array {
  if (payload.databaseKeyHex !== null && !DATABASE_KEY_HEX_PATTERN.test(payload.databaseKeyHex)) {
    throw new Error("databaseKeyHex must be exactly 64 lowercase hex characters");
  }
  const files: Record<string, Uint8Array> = {
    [ZIP_ENTRY.manifest]: buildManifestProperties(payload.manifest),
    [ZIP_ENTRY.database]: payload.databaseBytes,
    [ZIP_ENTRY.appearance]: buildAppearanceProperties(payload.appearance),
  };
  if (payload.databaseKeyHex !== null) {
    files[ZIP_ENTRY.databaseKey] = new TextEncoder().encode(payload.databaseKeyHex);
  }
  for (const photo of payload.photos) {
    files[`${PHOTO_PREFIX}${photo.name}`] = photo.bytes;
  }
  return zipSync(files, { level: 6 });
}

export function parseBackupZip(zipBytes: Uint8Array): ParsedBackupZip {
  const files = unzipSync(zipBytes);

  const manifestBytes = files[ZIP_ENTRY.manifest];
  const databaseBytes = files[ZIP_ENTRY.database];
  if (!manifestBytes) throw new NotABackupError("missing manifest.properties");
  if (!databaseBytes) throw new NotABackupError("missing auxo.db");

  const manifest = parseManifest(manifestBytes);

  let databaseKeyHex: string | null = null;
  const keyBytes = files[ZIP_ENTRY.databaseKey];
  if (keyBytes) {
    databaseKeyHex = new TextDecoder("ascii").decode(keyBytes).trim();
    if (!DATABASE_KEY_HEX_PATTERN.test(databaseKeyHex)) {
      throw new NotABackupError("database.key is not 64 hex characters");
    }
  }

  const appearance = parseAppearance(files[ZIP_ENTRY.appearance]);

  const photos: BackupPhoto[] = [];
  for (const [name, bytes] of Object.entries(files)) {
    if (name.startsWith(PHOTO_PREFIX) && name.length > PHOTO_PREFIX.length) {
      photos.push({ name: name.slice(PHOTO_PREFIX.length), bytes });
    }
  }

  return { manifest, databaseBytes, databaseKeyHex, appearance, photos };
}

export interface RestoredBackup {
  manifest: BackupManifest;
  /** Plain (decrypted) SQLite database bytes, ready to open with any standard SQLite engine. */
  databaseBytes: Uint8Array;
  appearance: AppearancePreferences;
  photos: BackupPhoto[];
}

/** Decrypts and unpacks a complete `.auxobak` file. Does not touch application data/storage. */
export async function restoreBackup(backupPassphrase: string, auxobak: Uint8Array): Promise<RestoredBackup> {
  const zipBytes = await decryptAuxobak(backupPassphrase, auxobak);
  const parsed = parseBackupZip(zipBytes);
  const plainDatabaseBytes = parsed.databaseKeyHex
    ? await decryptSqlCipherDatabase(parsed.databaseKeyHex, parsed.databaseBytes)
    : parsed.databaseBytes;
  return {
    manifest: parsed.manifest,
    databaseBytes: plainDatabaseBytes,
    appearance: parsed.appearance,
    photos: parsed.photos,
  };
}

export interface CreateBackupOptions {
  backupPassphrase: string;
  /** Plain (unencrypted) SQLite database bytes, already laid out in Android Room schema. */
  plainDatabaseBytes: Uint8Array;
  databaseVersion: number;
  appVersion: string | null;
  counts?: { shop?: number; products?: number; customers?: number; invoices?: number };
  appearance: AppearancePreferences;
  photos?: BackupPhoto[];
  outerIterations?: number;
}

/**
 * Builds a complete `.auxobak` file: generates a fresh random SQLCipher key, encrypts the
 * database, zips it with the manifest/preferences/photos, then encrypts the whole zip with the
 * passphrase-derived outer envelope. The returned `databaseKeyHex` is for the caller's own
 * records (e.g. nothing needs it after this call — it is embedded in the zip) and is not
 * required to restore, since restoring only needs `backupPassphrase`.
 */
export async function createBackup(
  options: CreateBackupOptions,
): Promise<{ auxobak: Uint8Array; databaseKeyHex: string }> {
  const databaseKeyBytes = crypto.getRandomValues(new Uint8Array(32));
  const databaseKeyHex = Array.from(databaseKeyBytes, (b) => b.toString(16).padStart(2, "0")).join("");

  const encryptedDatabase = await encryptSqlCipherDatabase(databaseKeyHex, options.plainDatabaseBytes);

  const manifest: BackupManifest = {
    app: "auxo",
    format: SUPPORTED_FORMAT,
    created: Date.now(),
    databaseVersion: options.databaseVersion,
    appVersion: options.appVersion,
    shop: options.counts?.shop ?? null,
    products: options.counts?.products ?? null,
    customers: options.counts?.customers ?? null,
    invoices: options.counts?.invoices ?? null,
  };

  const zipBytes = buildBackupZip({
    manifest,
    databaseBytes: encryptedDatabase,
    databaseKeyHex,
    appearance: options.appearance,
    photos: options.photos ?? [],
  });

  const auxobak = await encryptAuxobak(
    options.backupPassphrase,
    zipBytes,
    options.outerIterations !== undefined ? { iterations: options.outerIterations } : undefined,
  );

  return { auxobak, databaseKeyHex };
}

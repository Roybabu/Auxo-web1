import type { SqlDatabase } from "@auxo/core";

/**
 * Local-storage schema for what stage 3 needs (shop setup, users, roles). This is deliberately
 * NOT the Android Room schema — that exact DDL (needed for writing Android-compatible backups)
 * is grown separately as each feature area lands; see docs/backup-format.md. Column names here
 * are snake_case to match normal SQLite convention and to keep a consistent on-disk shape if a
 * migration path to the Android-compatible schema is needed later.
 */
export async function ensureSchema(db: SqlDatabase): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS shop_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      store_name TEXT NOT NULL,
      categories TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      android_id INTEGER,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('SUPER_ADMIN', 'EMPLOYEE')),
      granted_permissions TEXT NOT NULL DEFAULT '[]',
      pin_hash TEXT NOT NULL,
      pin_salt TEXT NOT NULL,
      recovery_code_hashes TEXT NOT NULL DEFAULT '[]',
      active INTEGER NOT NULL DEFAULT 1,
      last_signed_in_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    )
  `);
}

/**
 * The storage interface the rest of the core package's repositories are written against.
 * Deliberately minimal and SQL-engine-agnostic: no import of any browser or WASM API here —
 * `packages/core` stays framework-free. `apps/web` provides the real implementation (SQLite
 * WASM over OPFS); a test implementation (in-memory) can satisfy the same interface for unit
 * tests that don't need a real engine.
 */

export type SqlValue = string | number | null | Uint8Array;

export interface SqlRow {
  [column: string]: SqlValue;
}

export interface SqlDatabase {
  /** Runs one or more statements; does not return rows. For DDL, inserts/updates, etc. */
  exec(sql: string, params?: SqlValue[]): Promise<void>;
  /** Runs a single SELECT and returns every row as a plain object keyed by column name. */
  query<T extends SqlRow = SqlRow>(sql: string, params?: SqlValue[]): Promise<T[]>;
  /** Runs `fn` inside a transaction; rolls back if `fn` throws. */
  transaction<T>(fn: (db: SqlDatabase) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface SqlDatabaseFactory {
  /** Opens (creating if necessary) the named persistent database. */
  open(name: string): Promise<SqlDatabase>;
}

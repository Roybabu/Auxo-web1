// @vitest-environment node
import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import type { SqlDatabase, SqlRow, SqlValue } from "@auxo/core";
import { describe, expect, it } from "vitest";
import { ensureSchema } from "./schema";

async function memoryDatabase(): Promise<SqlDatabase> {
  const sqlite3 = await sqlite3InitModule();
  const db = new sqlite3.oo1.DB();
  const self: SqlDatabase = {
    async exec(sql: string, params?: SqlValue[]) {
      db.exec(params ? { sql, bind: params as never } : { sql });
    },
    async query<T extends SqlRow = SqlRow>(sql: string, params?: SqlValue[]) {
      return db.exec({
        sql,
        ...(params ? { bind: params as never } : {}),
        returnValue: "resultRows",
        rowMode: "object",
      }) as unknown as T[];
    },
    async transaction<T>(fn: (d: SqlDatabase) => Promise<T>) {
      return fn(self);
    },
    async close() {
      db.close();
    },
  };
  return self;
}

describe("ensureSchema", () => {
  it("sets aside Android-shaped tables left by an old restore, then builds ours", async () => {
    const db = await memoryDatabase();
    await db.exec("CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT NOT NULL)");
    await db.exec("INSERT INTO products (id, name) VALUES (1, 'Kept aside')");

    await ensureSchema(db);

    const legacy = await db.query("SELECT name FROM legacy_android_products");
    expect(legacy).toEqual([{ name: "Kept aside" }]);
    const columns = (await db.query<{ name: string }>("SELECT name FROM pragma_table_info('products')")).map((c) => c.name);
    expect(columns).toContain("android_id");
    expect(await db.query("SELECT * FROM products")).toEqual([]);
  });

  it("leaves our own tables alone, and is safe to run repeatedly", async () => {
    const db = await memoryDatabase();
    await ensureSchema(db);
    await db.exec(
      "INSERT INTO products (id, name, category, gst_rule, created_at, updated_at) VALUES ('a', 'Mine', 'GENERAL', '{}', 1, 1)",
    );
    await ensureSchema(db);
    expect(await db.query("SELECT name FROM products")).toEqual([{ name: "Mine" }]);
    expect(await db.query("SELECT name FROM sqlite_master WHERE name LIKE 'legacy_android_%'")).toEqual([]);
  });

  it("adds the original-bill columns to a bills table created before they existed", async () => {
    const db = await memoryDatabase();
    await db.exec("CREATE TABLE invoices (id TEXT PRIMARY KEY, android_id INTEGER, number TEXT NOT NULL)");
    await ensureSchema(db);
    const columns = (await db.query<{ name: string }>("SELECT name FROM pragma_table_info('invoices')")).map((c) => c.name);
    expect(columns).toEqual(expect.arrayContaining(["original_invoice_id", "original_invoice_number"]));
  });
});

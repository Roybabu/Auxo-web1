import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import { describe, expect, it } from "vitest";
import { asRollbackJournalDatabase, looksLikeAndroidDatabase, mapAndroidToWeb, type AndroidTables } from "./androidImport";

interface RoomSchema {
  database: { entities: { tableName: string; createSql: string; indices?: { createSql: string }[] }[] };
}

const schema = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "room-schema-v1.json"), "utf8"),
) as RoomSchema;

const sqlite3Ready = sqlite3InitModule();

/** Builds an empty database from the Android app's own exported Room DDL, so column names are the real ones. */
async function roomDatabase() {
  const sqlite3 = await sqlite3Ready;
  const db = new sqlite3.oo1.DB();
  for (const entity of schema.database.entities) {
    db.exec(entity.createSql.replaceAll("${TABLE_NAME}", entity.tableName));
    for (const index of entity.indices ?? []) {
      db.exec(index.createSql.replaceAll("${TABLE_NAME}", entity.tableName));
    }
  }
  return db;
}

function readAll(db: Awaited<ReturnType<typeof roomDatabase>>): AndroidTables {
  const names = db.exec({
    sql: "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    returnValue: "resultRows",
    rowMode: "array",
  }) as string[][];
  const out: AndroidTables = {};
  for (const [name] of names) {
    out[name!] = db.exec({ sql: `SELECT * FROM "${name}"`, returnValue: "resultRows", rowMode: "object" }) as AndroidTables[string];
  }
  return out;
}

let counter = 0;
const nextId = () => `uuid-${++counter}`;

async function sampleTables(): Promise<AndroidTables> {
  const db = await roomDatabase();
  db.exec(`
    INSERT INTO store_settings (id, store_name, address, phone, gstin, state_code, gst_registered, prices_include_tax, round_off,
      invoice_prefix, credit_note_prefix, upi_id, upi_payee_name, receipt_paper, receipt_footer, receipt_show_hsn,
      receipt_show_tax_breakup, receipt_show_savings, receipt_show_customer, receipt_show_barcode, receipt_show_upi_qr,
      employee_discount_limit_bp, expiry_warning_days, fssai)
    VALUES (1, 'Surabhi', '', '', '', '', 1, 0, 1, 'SB', 'CN', '', '', '58', '', 1, 1, 1, 1, 0, 0, 500, 30, '');
    INSERT INTO shop_categories (id, name, profile, enabled, sort_order, built_in) VALUES
      (1, NULL, 'GARMENT', 1, 0, 1), (2, NULL, 'FOOTWEAR', 0, 1, 1), (3, 'Toys', 'GENERAL', 1, 2, 0);
    INSERT INTO products (id, name, category, created_at, updated_at, available, tracks_stock, prescription_required, gst_rule, gst_rate_bp, stock_unit)
      VALUES (7, 'Cotton Shirt', 'GARMENT', 1000, 2000, 1, 1, 0, 'APPAREL', NULL, NULL),
             (8, 'Soap', 'GENERAL', 1100, 1100, 1, 1, 0, 'FIXED', 1800, 'UNIT'),
             (9, 'Mystery', 'NOT_A_CATEGORY', 1200, 1200, 1, 1, 0, NULL, NULL, NULL);
    INSERT INTO product_variants (id, product_id, barcode, size, colour, price_minor, stock_quantity, low_stock_threshold, reorder_quantity)
      VALUES (70, 7, '890100', 'M', 'Blue', 49900, 12, 3, 0), (71, 8, '', NULL, NULL, 2500, 40, 0, 0),
             (72, 9, '890200', NULL, NULL, 100, 1, 0, 0);
    INSERT INTO customers (id, name, phone, credit_limit_minor, created_at, updated_at) VALUES (5, 'Asha', '9999', 500000, 3000, 3000);
    INSERT INTO invoices (id, number, type, created_at, seller_name, seller_address, seller_phone, seller_gstin, seller_state_code, seller_fssai,
        place_of_supply, gst_registered, prices_include_tax, inter_state, subtotal_minor, discount_minor, taxable_minor, cgst_minor,
        sgst_minor, igst_minor, round_off_minor, rounded_to_rupee, grand_total_minor, savings_minor, customer_id)
      VALUES (100, 'SB/2025-26/00001', 'SALE', 4000, 's', '', '', '', '', '', '', 1, 0, 0, 49900, 0, 47524, 1188, 1188, 0, 0, 0, 49900, 0, 5),
             (101, 'CN/2025-26/00001', 'RETURN', 5000, 's', '', '', '', '', '', '', 1, 0, 0, 49900, 0, 47524, 1188, 1188, 0, 0, 0, 49900, 0, 5);
    UPDATE invoices SET original_invoice_id = 100 WHERE id = 101;
    INSERT INTO invoice_lines (id, invoice_id, variant_id, product_name, variant_label, barcode, quantity, unit_price_minor,
        discount_minor, taxable_minor, gst_rate_bp, cgst_minor, sgst_minor, igst_minor, total_minor, returned_quantity)
      VALUES (1000, 100, 70, 'Cotton Shirt', 'M · Blue', '890100', 1, 49900, 0, 47524, 500, 1188, 1188, 0, 49900, 0);
    INSERT INTO payments (id, invoice_id, method, kind, amount_minor, created_at) VALUES (1, 100, 'CREDIT', 'PAYMENT', 49900, 4000);
    INSERT INTO customer_ledger (id, customer_id, type, amount_minor, invoice_id, created_at, points)
      VALUES (1, 5, 'SALE', 49900, 100, 4000, 0), (2, 5, 'PAYMENT', -10000, NULL, 4500, 0);
    UPDATE customer_ledger SET method = 'CREDIT' WHERE id = 2;
    INSERT INTO stock_movements (id, variant_id, quantity_change, reason, created_at, invoice_id) VALUES (1, 70, -1, 'SOLD', 4000, 100);
    INSERT INTO number_sequences (name, next_value) VALUES ('SB|2025', 2);
    INSERT INTO suppliers (id, name, active, created_at, updated_at) VALUES (1, 'Acme', 1, 1, 1);
  `);
  return readAll(db);
}

describe("mapAndroidToWeb, against the real Room schema", () => {
  it("is recognised as an Android database, and the web schema is not", async () => {
    const tables = await sampleTables();
    expect(looksLikeAndroidDatabase(Object.keys(tables))).toBe(true);
    expect(looksLikeAndroidDatabase(["shop_settings", "users", "products"])).toBe(false);
  });

  it("maps products, variants and encodings", async () => {
    counter = 0;
    const result = mapAndroidToWeb(await sampleTables(), nextId);
    const byTable = Object.fromEntries(result.tables.map((t) => [t.table, t.rows]));

    const [shirt, soap, mystery] = byTable.products!;
    expect(shirt).toMatchObject({ name: "Cotton Shirt", category: "GARMENT", stock_unit: "UNIT", android_id: 7, updated_at: 2000 });
    expect(JSON.parse(shirt!.gst_rule as string)).toEqual({ kind: "APPAREL" });
    expect(JSON.parse(soap!.gst_rule as string)).toEqual({ kind: "FIXED", rateBp: 1800 });
    expect(JSON.parse(mystery!.gst_rule as string)).toEqual({ kind: "NONE" });
    expect(mystery!.category).toBe("GENERAL");

    const variants = byTable.product_variants!;
    expect(variants).toHaveLength(3);
    expect(variants[0]).toMatchObject({ barcode: "890100", price_minor: 49900, low_stock_threshold: 3, reorder_quantity: null });
    expect(variants[1]).toMatchObject({ barcode: null, low_stock_threshold: null });
    expect(variants[0]!.product_id).toBe(shirt!.id);
    expect(result.warnings).toEqual([]);
  });

  it("keeps a return when its original bill is missing, and says so", () => {
    const result = mapAndroidToWeb(
      { invoices: [{ id: 2, number: "CN/1", type: "RETURN", created_at: 1, original_invoice_id: 99, original_invoice_number: "INV/9" }] },
      nextId,
    );
    const [invoice] = result.tables.find((t) => t.table === "invoices")!.rows;
    expect(invoice).toMatchObject({ type: "CREDIT_NOTE", original_invoice_id: null, original_invoice_number: "INV/9" });
    expect(result.warnings.join("\n")).toContain("isn't in the backup");
  });

  it("keeps going past damaged rows and says so", () => {
    const result = mapAndroidToWeb(
      {
        products: [{ id: 1, name: "A", category: "GENERAL", created_at: 1 }],
        product_variants: [
          { id: 1, product_id: 1, barcode: "111", price_minor: 1, stock_quantity: 1 },
          { id: 2, product_id: 1, barcode: "111", price_minor: 1, stock_quantity: 1 },
          { id: 3, product_id: 404, barcode: "222", price_minor: 1, stock_quantity: 1 },
        ],
        store_settings: [],
      },
      nextId,
    );
    const variants = result.tables.find((t) => t.table === "product_variants")!.rows;
    expect(variants.map((v) => v.barcode)).toEqual(["111", null]);
    expect(result.warnings.join("\n")).toContain("shares barcode 111");
    expect(result.warnings.join("\n")).toContain("its product is missing");
    expect(result.shopPatch).toBeNull();
  });

  it("maps bills, payments, returns and the credit book with new ids wired up", async () => {
    counter = 0;
    const result = mapAndroidToWeb(await sampleTables(), nextId);
    const byTable = Object.fromEntries(result.tables.map((t) => [t.table, t.rows]));

    const [sale, creditNote] = byTable.invoices!;
    const customer = byTable.customers![0]!;
    expect(sale).toMatchObject({ number: "SB/2025-26/00001", type: "SALE", customer_id: customer.id, grand_total_minor: 49900 });
    expect(creditNote!.type).toBe("CREDIT_NOTE");
    expect(Object.keys(sale!)).not.toContain("seller_name");
    expect(creditNote).toMatchObject({ original_invoice_id: sale!.id });
    expect(sale!.original_invoice_id).toBeNull();
    expect(result.warnings).toEqual([]);

    expect(byTable.invoice_lines![0]).toMatchObject({ invoice_id: sale!.id, product_name: "Cotton Shirt", total_minor: 49900 });
    expect(byTable.invoice_lines![0]!.variant_id).toBe(byTable.product_variants![0]!.id);
    expect(byTable.payments![0]).toMatchObject({ invoice_id: sale!.id, method: "ACCOUNT", amount_minor: 49900 });

    const ledger = byTable.customer_ledger!;
    expect(ledger.map((l) => l.type)).toEqual(["SALE", "PAYMENT"]);
    expect(ledger[0]).toMatchObject({ customer_id: customer.id, invoice_id: sale!.id });
    expect(ledger[1]).toMatchObject({ method: "ACCOUNT", amount_minor: -10000 });
    expect(byTable.stock_movements![0]).toMatchObject({ reason: "SOLD", quantity_change: -1, invoice_id: sale!.id });
    expect(byTable.number_sequences).toEqual([{ name: "SB|2025", next_value: 2 }]);
  });

  it("derives shop settings and reports what could not be carried over", async () => {
    const result = mapAndroidToWeb(await sampleTables(), nextId);
    expect(result.shopPatch).toEqual({
      storeName: "Surabhi",
      gstRegistered: true,
      pricesIncludeTax: false,
      roundOffEnabled: true,
      invoicePrefix: "SB",
      employeeDiscountLimitBp: 500,
      categories: ["GARMENT", "GENERAL"],
    });
    expect(result.skipped).toEqual({ suppliers: 1 });
  });

  it("makes a WAL-mode Android database readable, without changing the original", async () => {
    const sqlite3 = await sqlite3Ready;
    const source = await roomDatabase();
    source.exec("INSERT INTO customers (id, name, created_at, updated_at) VALUES (1, 'Asha', 1, 1)");
    const bytes = sqlite3.capi.sqlite3_js_db_export(source.pointer!);
    bytes[18] = 2;
    bytes[19] = 2;

    const open = (data: Uint8Array) => {
      const db = new sqlite3.oo1.DB();
      const pointer = sqlite3.wasm.allocFromTypedArray(data);
      sqlite3.capi.sqlite3_deserialize(db.pointer!, "main", pointer, data.length, data.length, sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE);
      return db;
    };
    expect(() => open(bytes).selectValue("SELECT count(*) FROM customers")).toThrow();
    const fixed = asRollbackJournalDatabase(bytes);
    expect(open(fixed).selectValue("SELECT count(*) FROM customers")).toBe(1);
    expect([bytes[18], bytes[19]]).toEqual([2, 2]);
  });
});

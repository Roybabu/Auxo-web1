import { readFileSync } from "node:fs";
import { createBackup } from "@auxo/core";
import sqlite3InitModule from "@sqlite.org/sqlite-wasm";

interface RoomSchema {
  database: { entities: { tableName: string; createSql: string; indices?: { createSql: string }[] }[] };
}

/**
 * Builds a real-shaped Android backup: a database created from the Android app's exported Room
 * DDL, filled with a small shop, wrapped in the real .auxobak envelope. The inner database isn't
 * SQLCipher-locked (this builder has no SQLCipher engine), which the importer doesn't depend on.
 */
export async function buildAndroidBackup(passphrase: string): Promise<Uint8Array> {
  const schemaPath = new URL("../../../packages/core/src/backup/__fixtures__/room-schema-v1.json", import.meta.url);
  const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as RoomSchema;
  const sqlite3 = await sqlite3InitModule();
  const db = new sqlite3.oo1.DB();
  for (const entity of schema.database.entities) {
    db.exec(entity.createSql.replaceAll("${TABLE_NAME}", entity.tableName));
    for (const index of entity.indices ?? []) db.exec(index.createSql.replaceAll("${TABLE_NAME}", entity.tableName));
  }
  db.exec(`
    INSERT INTO store_settings (id, store_name, address, phone, gstin, state_code, gst_registered, prices_include_tax, round_off,
      invoice_prefix, credit_note_prefix, upi_id, upi_payee_name, receipt_paper, receipt_footer, receipt_show_hsn,
      receipt_show_tax_breakup, receipt_show_savings, receipt_show_customer, receipt_show_barcode, receipt_show_upi_qr,
      employee_discount_limit_bp, expiry_warning_days, fssai)
    VALUES (1, 'Android Shop', '', '', '', '', 0, 0, 1, 'SB', 'CN', '', '', '58', '', 1, 1, 1, 1, 0, 0, 0, 30, '');
    INSERT INTO products (id, name, category, created_at, updated_at, available, tracks_stock, prescription_required, gst_rule)
      VALUES (7, 'Android Shirt', 'GARMENT', 1000, 1000, 1, 1, 0, 'APPAREL');
    INSERT INTO product_variants (id, product_id, barcode, price_minor, stock_quantity, low_stock_threshold, reorder_quantity)
      VALUES (70, 7, '890100', 49900, 12, 3, 0);
    INSERT INTO customers (id, name, phone, created_at, updated_at) VALUES (5, 'Asha Android', '9999', 3000, 3000);
    INSERT INTO invoices (id, number, type, created_at, seller_name, seller_address, seller_phone, seller_gstin, seller_state_code,
        seller_fssai, place_of_supply, gst_registered, prices_include_tax, inter_state, subtotal_minor, discount_minor, taxable_minor,
        cgst_minor, sgst_minor, igst_minor, round_off_minor, rounded_to_rupee, grand_total_minor, savings_minor, customer_id)
      VALUES (100, 'SB/2025-26/00001', 'SALE', 4000, 's', '', '', '', '', '', '', 0, 0, 0, 49900, 0, 49900, 0, 0, 0, 0, 0, 49900, 0, 5);
    INSERT INTO customer_ledger (id, customer_id, type, amount_minor, invoice_id, created_at, points)
      VALUES (1, 5, 'SALE', 49900, 100, 4000, 0), (2, 5, 'PAYMENT', -10000, NULL, 4500, 0);
  `);
  const plainDatabaseBytes = sqlite3.capi.sqlite3_js_db_export(db.pointer!);
  db.close();
  // Real Android databases are in WAL mode (header bytes 18-19 = 2); mimic that so the importer is
  // exercised against it, as it was when a real backup first failed to open without handling it.
  plainDatabaseBytes[18] = 2;
  plainDatabaseBytes[19] = 2;

  const { auxobak } = await createBackup({
    backupPassphrase: passphrase,
    plainDatabaseBytes,
    databaseVersion: 1,
    appVersion: "android-fixture",
    appearance: { accent: null, darkMode: null, restaurantMenu: null, suppliers: null, creditHoldDays: null, onTimeBonusPoints: null },
    lockDatabase: false,
    outerIterations: 10_000,
  });
  return auxobak;
}

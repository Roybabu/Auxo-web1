import type { SqlDatabase } from "@auxo/core";

/**
 * Local-storage schema for what stage 3 needs (shop setup, users, roles). This is deliberately
 * NOT the Android Room schema — that exact DDL (needed for writing Android-compatible backups)
 * is grown separately as each feature area lands; see docs/backup-format.md. Column names here
 * are snake_case to match normal SQLite convention and to keep a consistent on-disk shape if a
 * migration path to the Android-compatible schema is needed later.
 */
// Tables whose names the Android app also uses. Earlier versions restored an Android backup by
// writing its database straight over ours, leaving Android-shaped copies of these under the same
// names; ours always have an android_id column, theirs never do.
const TABLES_SHARED_WITH_ANDROID = [
  "products",
  "product_variants",
  "stock_movements",
  "invoices",
  "invoice_lines",
  "payments",
  "customers",
  "customer_ledger",
  "held_bills",
];

/** Moves Android-shaped tables aside (renamed, not deleted) so ours can be created in their place. */
export async function setAsideAndroidShapedTables(db: SqlDatabase): Promise<string[]> {
  const moved: string[] = [];
  for (const table of TABLES_SHARED_WITH_ANDROID) {
    const columns = await db.query<{ name: string }>(`SELECT name FROM pragma_table_info('${table}')`);
    if (columns.length > 0 && !columns.some((c) => c.name === "android_id")) {
      await db.exec(`ALTER TABLE ${table} RENAME TO legacy_android_${table}`);
      moved.push(table);
    }
  }
  return moved;
}

export async function ensureSchema(db: SqlDatabase): Promise<void> {
  await setAsideAndroidShapedTables(db);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS shop_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      store_name TEXT NOT NULL,
      categories TEXT NOT NULL,
      gst_registered INTEGER NOT NULL DEFAULT 1,
      prices_include_tax INTEGER NOT NULL DEFAULT 0,
      round_off_enabled INTEGER NOT NULL DEFAULT 1,
      inter_state INTEGER NOT NULL DEFAULT 0,
      invoice_prefix TEXT NOT NULL DEFAULT 'INV',
      employee_discount_limit_bp INTEGER NOT NULL DEFAULT 0,
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

  await db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      android_id INTEGER,
      name TEXT NOT NULL,
      brand TEXT,
      category TEXT NOT NULL,
      category_id TEXT,
      subcategory TEXT,
      description TEXT,
      material TEXT,
      diet_type TEXT,
      hsn_code TEXT,
      gst_rule TEXT NOT NULL,
      stock_unit TEXT NOT NULL DEFAULT 'UNIT',
      preferred_supplier_id TEXT,
      photo_file TEXT,
      available INTEGER NOT NULL DEFAULT 1,
      tracks_stock INTEGER NOT NULL DEFAULT 1,
      warranty_months INTEGER,
      prescription_required INTEGER NOT NULL DEFAULT 0,
      metal TEXT,
      making_charge_bp INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS product_variants (
      id TEXT PRIMARY KEY,
      android_id INTEGER,
      product_id TEXT NOT NULL REFERENCES products(id),
      sku TEXT,
      barcode TEXT,
      size TEXT,
      colour TEXT,
      net_quantity_milli INTEGER,
      net_quantity_unit TEXT,
      price_minor INTEGER NOT NULL,
      mrp_minor INTEGER,
      cost_minor INTEGER,
      stock_quantity INTEGER NOT NULL DEFAULT 0,
      low_stock_threshold INTEGER,
      reorder_quantity INTEGER,
      batch_number TEXT,
      expiry_epoch_day INTEGER,
      photo_file TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    )
  `);
  await db.exec("CREATE INDEX IF NOT EXISTS idx_product_variants_product_id ON product_variants(product_id)");
  await db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_product_variants_barcode ON product_variants(barcode) WHERE barcode IS NOT NULL");

  await db.exec(`
    CREATE TABLE IF NOT EXISTS stock_movements (
      id TEXT PRIMARY KEY,
      android_id INTEGER,
      variant_id TEXT NOT NULL REFERENCES product_variants(id),
      quantity_change INTEGER NOT NULL,
      reason TEXT NOT NULL,
      note TEXT,
      invoice_id TEXT,
      batch_id TEXT,
      receipt_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    )
  `);
  await db.exec("CREATE INDEX IF NOT EXISTS idx_stock_movements_variant_id ON stock_movements(variant_id)");

  await db.exec(`
    CREATE TABLE IF NOT EXISTS number_sequences (
      name TEXT PRIMARY KEY,
      next_value INTEGER NOT NULL
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      android_id INTEGER,
      number TEXT NOT NULL,
      type TEXT NOT NULL,
      customer_id TEXT,
      gst_registered INTEGER NOT NULL,
      prices_include_tax INTEGER NOT NULL,
      inter_state INTEGER NOT NULL,
      subtotal_minor INTEGER NOT NULL,
      discount_minor INTEGER NOT NULL,
      discount_reason TEXT,
      taxable_minor INTEGER NOT NULL,
      cgst_minor INTEGER NOT NULL,
      sgst_minor INTEGER NOT NULL,
      igst_minor INTEGER NOT NULL,
      round_off_minor INTEGER NOT NULL,
      grand_total_minor INTEGER NOT NULL,
      savings_minor INTEGER NOT NULL,
      note TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS invoice_lines (
      id TEXT PRIMARY KEY,
      android_id INTEGER,
      invoice_id TEXT NOT NULL REFERENCES invoices(id),
      variant_id TEXT,
      product_name TEXT NOT NULL,
      variant_label TEXT,
      stock_unit TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price_minor INTEGER NOT NULL,
      discount_minor INTEGER NOT NULL,
      taxable_minor INTEGER NOT NULL,
      gst_rate_bp INTEGER NOT NULL,
      cgst_minor INTEGER NOT NULL,
      sgst_minor INTEGER NOT NULL,
      igst_minor INTEGER NOT NULL,
      total_minor INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    )
  `);
  await db.exec("CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice_id ON invoice_lines(invoice_id)");

  await db.exec(`
    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      android_id INTEGER,
      invoice_id TEXT NOT NULL REFERENCES invoices(id),
      method TEXT NOT NULL,
      kind TEXT NOT NULL,
      amount_minor INTEGER NOT NULL,
      reference TEXT,
      tendered_minor INTEGER,
      change_minor INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    )
  `);
  await db.exec("CREATE INDEX IF NOT EXISTS idx_payments_invoice_id ON payments(invoice_id)");

  await db.exec(`
    CREATE TABLE IF NOT EXISTS held_bills (
      id TEXT PRIMARY KEY,
      android_id INTEGER,
      label TEXT,
      item_count INTEGER NOT NULL,
      total_minor INTEGER NOT NULL,
      payload TEXT NOT NULL,
      table_number TEXT,
      token_number TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      android_id INTEGER,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      gstin TEXT,
      state_code TEXT,
      address TEXT,
      credit_limit_minor INTEGER,
      notes TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    )
  `);
  await db.exec("CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone)");

  await db.exec(`
    CREATE TABLE IF NOT EXISTS customer_ledger (
      id TEXT PRIMARY KEY,
      android_id INTEGER,
      customer_id TEXT NOT NULL REFERENCES customers(id),
      type TEXT NOT NULL,
      amount_minor INTEGER NOT NULL,
      invoice_id TEXT,
      method TEXT,
      reference TEXT,
      note TEXT,
      points INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    )
  `);
  await db.exec("CREATE INDEX IF NOT EXISTS idx_customer_ledger_customer_id ON customer_ledger(customer_id)");
}

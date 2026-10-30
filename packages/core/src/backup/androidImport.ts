/**
 * Converts the rows of an Android (Room) database into rows for this web app's own tables.
 *
 * The Android and web schemas share many table names but not their columns (integer vs UUID ids,
 * extra seller/receipt columns on Android, soft-delete and timestamps on the web), so a restored
 * Android file can't just be dropped in as the web database. This is a pure function over
 * already-read rows; reading the SQLite file is the storage layer's job.
 */

export type AndroidRow = Record<string, unknown>;
export type AndroidTables = Record<string, AndroidRow[]>;
export type WebValue = string | number | null;
export type WebRow = Record<string, WebValue>;

export interface WebImportTable {
  table: string;
  rows: WebRow[];
}

export interface ShopSettingsPatch {
  storeName: string;
  gstRegistered: boolean;
  pricesIncludeTax: boolean;
  roundOffEnabled: boolean;
  invoicePrefix: string;
  employeeDiscountLimitBp: number;
  categories: string[] | null;
}

export interface AndroidImportResult {
  /** In foreign-key-safe insertion order; delete in reverse. */
  tables: WebImportTable[];
  shopPatch: ShopSettingsPatch | null;
  /** Android tables with rows that this web app has no equivalent for, with their row counts. */
  skipped: Record<string, number>;
  warnings: string[];
}

export const ANDROID_REQUIRED_TABLES = ["products", "product_variants", "store_settings"] as const;

export function looksLikeAndroidDatabase(tableNames: readonly string[]): boolean {
  return ANDROID_REQUIRED_TABLES.every((t) => tableNames.includes(t));
}

const UNSUPPORTED_TABLES = [
  "suppliers",
  "purchase_orders",
  "purchase_order_lines",
  "purchase_receipts",
  "purchase_receipt_lines",
  "stock_batches",
  "audit_log",
  "day_closings",
  "loyalty_settings",
  "held_bills",
  "quotations",
  "stock_counts",
  "shop_subcategories",
];

const SHOP_CATEGORY_TYPES = new Set([
  "GARMENT",
  "FOOTWEAR",
  "ACCESSORIES",
  "PACKAGED_FOOD",
  "BEVERAGE",
  "GENERAL",
  "ELECTRONICS",
  "PHARMACY",
  "COSMETICS",
  "LOOSE",
  "JEWELLERY",
  "RESTAURANT",
]);

function str(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v);
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  return typeof v === "bigint" ? Number(v) : Number(v);
}

function numOr(v: unknown, fallback: number): number {
  return num(v) ?? fallback;
}

function nullIfZero(v: unknown): number | null {
  const n = num(v);
  return n === null || n === 0 ? null : n;
}

function gstRuleJson(rule: unknown, basisPoints: unknown): string {
  if (rule === "APPAREL") return JSON.stringify({ kind: "APPAREL" });
  const bp = num(basisPoints);
  if (rule === "FIXED" && bp !== null) return JSON.stringify({ kind: "FIXED", rateBp: bp });
  return JSON.stringify({ kind: "NONE" });
}

function paymentMethod(method: unknown): string | null {
  const m = str(method);
  return m === "CREDIT" ? "ACCOUNT" : m;
}

export function mapAndroidToWeb(
  android: AndroidTables,
  newId: () => string = () => crypto.randomUUID(),
): AndroidImportResult {
  const warnings: string[] = [];
  const rows = (name: string): AndroidRow[] => android[name] ?? [];

  const productIds = new Map<number, string>();
  const productStamps = new Map<number, { createdAt: number; updatedAt: number }>();
  const variantIds = new Map<number, string>();
  const customerIds = new Map<number, string>();
  const invoiceIds = new Map<number, string>();
  const invoiceStamps = new Map<number, number>();

  const products: WebRow[] = [];
  for (const r of rows("products")) {
    const androidId = numOr(r.id, 0);
    const id = newId();
    productIds.set(androidId, id);
    const createdAt = numOr(r.created_at, 0);
    const updatedAt = numOr(r.updated_at, createdAt);
    productStamps.set(androidId, { createdAt, updatedAt });
    const category = str(r.category);
    products.push({
      id,
      android_id: androidId,
      name: str(r.name) ?? "",
      brand: str(r.brand),
      category: category && SHOP_CATEGORY_TYPES.has(category) ? category : "GENERAL",
      category_id: null,
      subcategory: str(r.subcategory),
      description: str(r.description),
      material: str(r.material),
      diet_type: str(r.diet_type),
      hsn_code: str(r.hsn_code),
      gst_rule: gstRuleJson(r.gst_rule, r.gst_rate_bp),
      stock_unit: str(r.stock_unit) ?? "UNIT",
      preferred_supplier_id: null,
      photo_file: str(r.photo_file),
      available: numOr(r.available, 1),
      tracks_stock: numOr(r.tracks_stock, 1),
      warranty_months: num(r.warranty_months),
      prescription_required: numOr(r.prescription_required, 0),
      metal: str(r.metal),
      making_charge_bp: num(r.making_charge_bp),
      created_at: createdAt,
      updated_at: updatedAt,
      deleted_at: null,
    });
  }

  const variants: WebRow[] = [];
  const seenBarcodes = new Set<string>();
  for (const r of rows("product_variants")) {
    const productId = productIds.get(numOr(r.product_id, -1));
    if (!productId) {
      warnings.push(`Skipped variant ${String(r.id)}: its product is missing.`);
      continue;
    }
    const androidId = numOr(r.id, 0);
    const id = newId();
    variantIds.set(androidId, id);
    const stamps = productStamps.get(numOr(r.product_id, -1))!;
    let barcode = str(r.barcode);
    if (barcode === "") barcode = null;
    if (barcode !== null) {
      if (seenBarcodes.has(barcode)) {
        warnings.push(`Variant ${androidId} shares barcode ${barcode} with another; its barcode was cleared.`);
        barcode = null;
      } else {
        seenBarcodes.add(barcode);
      }
    }
    variants.push({
      id,
      android_id: androidId,
      product_id: productId,
      sku: str(r.sku),
      barcode,
      size: str(r.size),
      colour: str(r.colour),
      net_quantity_milli: num(r.net_quantity_milli),
      net_quantity_unit: str(r.net_quantity_unit),
      price_minor: numOr(r.price_minor, 0),
      mrp_minor: num(r.mrp_minor),
      cost_minor: num(r.cost_minor),
      stock_quantity: numOr(r.stock_quantity, 0),
      low_stock_threshold: nullIfZero(r.low_stock_threshold),
      reorder_quantity: nullIfZero(r.reorder_quantity),
      batch_number: str(r.batch_number),
      expiry_epoch_day: num(r.expiry_epoch_day),
      photo_file: str(r.photo_file),
      created_at: stamps.createdAt,
      updated_at: stamps.updatedAt,
      deleted_at: null,
    });
  }

  const customers: WebRow[] = [];
  for (const r of rows("customers")) {
    const androidId = numOr(r.id, 0);
    const id = newId();
    customerIds.set(androidId, id);
    const createdAt = numOr(r.created_at, 0);
    customers.push({
      id,
      android_id: androidId,
      name: str(r.name) ?? "",
      phone: str(r.phone),
      email: str(r.email),
      gstin: str(r.gstin),
      state_code: str(r.state_code),
      address: str(r.address),
      credit_limit_minor: num(r.credit_limit_minor),
      notes: str(r.notes),
      created_at: createdAt,
      updated_at: numOr(r.updated_at, createdAt),
      deleted_at: null,
    });
  }

  const invoices: WebRow[] = [];
  let returnLinksDropped = 0;
  for (const r of rows("invoices")) {
    const androidId = numOr(r.id, 0);
    const id = newId();
    invoiceIds.set(androidId, id);
    const createdAt = numOr(r.created_at, 0);
    invoiceStamps.set(androidId, createdAt);
    if (r.original_invoice_id !== null && r.original_invoice_id !== undefined) returnLinksDropped++;
    const customerId = r.customer_id === null || r.customer_id === undefined ? null : (customerIds.get(numOr(r.customer_id, -1)) ?? null);
    invoices.push({
      id,
      android_id: androidId,
      number: str(r.number) ?? "",
      type: r.type === "RETURN" ? "CREDIT_NOTE" : (str(r.type) ?? "SALE"),
      customer_id: customerId,
      gst_registered: numOr(r.gst_registered, 0),
      prices_include_tax: numOr(r.prices_include_tax, 0),
      inter_state: numOr(r.inter_state, 0),
      subtotal_minor: numOr(r.subtotal_minor, 0),
      discount_minor: numOr(r.discount_minor, 0),
      discount_reason: str(r.discount_reason),
      taxable_minor: numOr(r.taxable_minor, 0),
      cgst_minor: numOr(r.cgst_minor, 0),
      sgst_minor: numOr(r.sgst_minor, 0),
      igst_minor: numOr(r.igst_minor, 0),
      round_off_minor: numOr(r.round_off_minor, 0),
      grand_total_minor: numOr(r.grand_total_minor, 0),
      savings_minor: numOr(r.savings_minor, 0),
      note: str(r.note),
      created_at: createdAt,
      updated_at: createdAt,
      deleted_at: null,
    });
  }
  if (returnLinksDropped > 0) {
    warnings.push(`${returnLinksDropped} return(s) lost their link to the original bill; the return itself was kept.`);
  }

  const invoiceLines: WebRow[] = [];
  for (const r of rows("invoice_lines")) {
    const invoiceId = invoiceIds.get(numOr(r.invoice_id, -1));
    if (!invoiceId) {
      warnings.push(`Skipped bill line ${String(r.id)}: its bill is missing.`);
      continue;
    }
    const stamp = invoiceStamps.get(numOr(r.invoice_id, -1)) ?? 0;
    const variantId = r.variant_id === null || r.variant_id === undefined ? null : (variantIds.get(numOr(r.variant_id, -1)) ?? null);
    invoiceLines.push({
      id: newId(),
      android_id: numOr(r.id, 0),
      invoice_id: invoiceId,
      variant_id: variantId,
      product_name: str(r.product_name) ?? "",
      variant_label: str(r.variant_label),
      stock_unit: str(r.stock_unit) ?? "UNIT",
      quantity: numOr(r.quantity, 0),
      unit_price_minor: numOr(r.unit_price_minor, 0),
      discount_minor: numOr(r.discount_minor, 0),
      taxable_minor: numOr(r.taxable_minor, 0),
      gst_rate_bp: numOr(r.gst_rate_bp, 0),
      cgst_minor: numOr(r.cgst_minor, 0),
      sgst_minor: numOr(r.sgst_minor, 0),
      igst_minor: numOr(r.igst_minor, 0),
      total_minor: numOr(r.total_minor, 0),
      created_at: stamp,
      updated_at: stamp,
      deleted_at: null,
    });
  }

  const payments: WebRow[] = [];
  for (const r of rows("payments")) {
    const invoiceId = invoiceIds.get(numOr(r.invoice_id, -1));
    if (!invoiceId) {
      warnings.push(`Skipped payment ${String(r.id)}: its bill is missing.`);
      continue;
    }
    const createdAt = numOr(r.created_at, 0);
    payments.push({
      id: newId(),
      android_id: numOr(r.id, 0),
      invoice_id: invoiceId,
      method: paymentMethod(r.method) ?? "CASH",
      kind: str(r.kind) ?? "PAYMENT",
      amount_minor: numOr(r.amount_minor, 0),
      reference: str(r.reference),
      tendered_minor: num(r.tendered_minor),
      change_minor: num(r.change_minor),
      created_at: createdAt,
      updated_at: createdAt,
      deleted_at: null,
    });
  }

  const ledger: WebRow[] = [];
  for (const r of rows("customer_ledger")) {
    const customerId = customerIds.get(numOr(r.customer_id, -1));
    if (!customerId) {
      warnings.push(`Skipped credit-book entry ${String(r.id)}: its customer is missing.`);
      continue;
    }
    const createdAt = numOr(r.created_at, 0);
    ledger.push({
      id: newId(),
      android_id: numOr(r.id, 0),
      customer_id: customerId,
      type: str(r.type) ?? "SALE",
      amount_minor: numOr(r.amount_minor, 0),
      invoice_id: r.invoice_id === null || r.invoice_id === undefined ? null : (invoiceIds.get(numOr(r.invoice_id, -1)) ?? null),
      method: paymentMethod(r.method),
      reference: str(r.reference),
      note: str(r.note),
      points: num(r.points),
      created_at: createdAt,
      updated_at: createdAt,
      deleted_at: null,
    });
  }

  const movements: WebRow[] = [];
  for (const r of rows("stock_movements")) {
    const variantId = variantIds.get(numOr(r.variant_id, -1));
    if (!variantId) {
      warnings.push(`Skipped stock movement ${String(r.id)}: its item is missing.`);
      continue;
    }
    const createdAt = numOr(r.created_at, 0);
    movements.push({
      id: newId(),
      android_id: numOr(r.id, 0),
      variant_id: variantId,
      quantity_change: numOr(r.quantity_change, 0),
      reason: str(r.reason) ?? "CORRECTION",
      note: str(r.note),
      invoice_id: r.invoice_id === null || r.invoice_id === undefined ? null : (invoiceIds.get(numOr(r.invoice_id, -1)) ?? null),
      batch_id: null,
      receipt_id: null,
      created_at: createdAt,
      updated_at: createdAt,
      deleted_at: null,
    });
  }

  const sequences: WebRow[] = rows("number_sequences").map((r) => ({
    name: str(r.name) ?? "",
    next_value: numOr(r.next_value, 1),
  }));

  let shopPatch: ShopSettingsPatch | null = null;
  const settings = rows("store_settings")[0];
  if (settings) {
    const enabled = rows("shop_categories")
      .filter((c) => numOr(c.enabled, 0) === 1)
      .sort((a, b) => numOr(a.sort_order, 0) - numOr(b.sort_order, 0))
      .map((c) => str(c.profile))
      .filter((p): p is string => p !== null && SHOP_CATEGORY_TYPES.has(p));
    shopPatch = {
      storeName: str(settings.store_name) ?? "",
      gstRegistered: numOr(settings.gst_registered, 0) === 1,
      pricesIncludeTax: numOr(settings.prices_include_tax, 0) === 1,
      roundOffEnabled: numOr(settings.round_off, 0) === 1,
      invoicePrefix: str(settings.invoice_prefix) || "INV",
      employeeDiscountLimitBp: numOr(settings.employee_discount_limit_bp, 0),
      categories: enabled.length > 0 ? [...new Set(enabled)] : null,
    };
  }

  const skipped: Record<string, number> = {};
  for (const t of UNSUPPORTED_TABLES) {
    const n = rows(t).length;
    if (n > 0) skipped[t] = n;
  }

  return {
    tables: [
      { table: "products", rows: products },
      { table: "product_variants", rows: variants },
      { table: "customers", rows: customers },
      { table: "invoices", rows: invoices },
      { table: "invoice_lines", rows: invoiceLines },
      { table: "payments", rows: payments },
      { table: "customer_ledger", rows: ledger },
      { table: "stock_movements", rows: movements },
      { table: "number_sequences", rows: sequences },
    ],
    shopPatch,
    skipped,
    warnings,
  };
}

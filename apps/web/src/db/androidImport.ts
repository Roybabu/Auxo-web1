import type { AndroidImportResult, SqlDatabase } from "@auxo/core";
import { ShopRepository } from "./shopRepository";

// Tables the import replaces, children before parents so deletes never break a reference.
const REPLACED_TABLES_DELETE_ORDER = [
  "stock_movements",
  "customer_ledger",
  "payments",
  "invoice_lines",
  "invoices",
  "customers",
  "product_variants",
  "products",
  "number_sequences",
];

/**
 * Replaces this device's products, customers, bills, stock history and bill numbering with the
 * mapped Android data, in one transaction (any failure leaves everything as it was). Shop owner
 * accounts are kept: the Android app doesn't store them in its database. Shop settings are updated
 * from the Android store settings.
 */
export async function importAndroidData(db: SqlDatabase, result: AndroidImportResult): Promise<void> {
  await db.transaction(async (tx) => {
    for (const table of REPLACED_TABLES_DELETE_ORDER) {
      await tx.exec(`DELETE FROM ${table}`);
    }
    for (const { table, rows } of result.tables) {
      for (const row of rows) {
        const columns = Object.keys(row);
        await tx.exec(
          `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
          columns.map((c) => row[c] ?? null),
        );
      }
    }

    const patch = result.shopPatch;
    if (patch) {
      const shopRepo = new ShopRepository(tx);
      const current = await shopRepo.get();
      if (current) {
        await shopRepo.save({
          ...current,
          storeName: patch.storeName || current.storeName,
          gstRegistered: patch.gstRegistered,
          pricesIncludeTax: patch.pricesIncludeTax,
          roundOffEnabled: patch.roundOffEnabled,
          invoicePrefix: patch.invoicePrefix,
          employeeDiscountLimitBp: patch.employeeDiscountLimitBp,
          categories: (patch.categories as typeof current.categories | null) ?? current.categories,
        });
      }
    }
  });
}

import type { ShopCategoryType, SqlDatabase } from "@auxo/core";

export interface ShopSettings {
  storeName: string;
  categories: ShopCategoryType[];
  createdAt: number;
  /** Defaults applied at shop creation; no settings screen to change these yet (deferred). */
  gstRegistered: boolean;
  pricesIncludeTax: boolean;
  roundOffEnabled: boolean;
  interState: boolean;
  invoicePrefix: string;
  employeeDiscountLimitBp: number;
}

export const DEFAULT_BILLING_SETTINGS: Omit<ShopSettings, "storeName" | "categories" | "createdAt"> = {
  gstRegistered: true,
  pricesIncludeTax: false,
  roundOffEnabled: true,
  interState: false,
  invoicePrefix: "INV",
  employeeDiscountLimitBp: 0,
};

export class ShopRepository {
  constructor(private readonly db: SqlDatabase) {}

  async get(): Promise<ShopSettings | null> {
    const rows = await this.db.query("SELECT * FROM shop_settings WHERE id = 1");
    const row = rows[0];
    if (!row) return null;
    return {
      storeName: row.store_name as string,
      categories: JSON.parse(row.categories as string) as ShopCategoryType[],
      createdAt: row.created_at as number,
      gstRegistered: Boolean(row.gst_registered),
      pricesIncludeTax: Boolean(row.prices_include_tax),
      roundOffEnabled: Boolean(row.round_off_enabled),
      interState: Boolean(row.inter_state),
      invoicePrefix: row.invoice_prefix as string,
      employeeDiscountLimitBp: row.employee_discount_limit_bp as number,
    };
  }

  async save(settings: ShopSettings): Promise<void> {
    await this.db.exec(
      `INSERT INTO shop_settings
        (id, store_name, categories, gst_registered, prices_include_tax, round_off_enabled,
         inter_state, invoice_prefix, employee_discount_limit_bp, created_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         store_name = excluded.store_name,
         categories = excluded.categories,
         gst_registered = excluded.gst_registered,
         prices_include_tax = excluded.prices_include_tax,
         round_off_enabled = excluded.round_off_enabled,
         inter_state = excluded.inter_state,
         invoice_prefix = excluded.invoice_prefix,
         employee_discount_limit_bp = excluded.employee_discount_limit_bp`,
      [
        settings.storeName,
        JSON.stringify(settings.categories),
        settings.gstRegistered ? 1 : 0,
        settings.pricesIncludeTax ? 1 : 0,
        settings.roundOffEnabled ? 1 : 0,
        settings.interState ? 1 : 0,
        settings.invoicePrefix,
        settings.employeeDiscountLimitBp,
        settings.createdAt,
      ],
    );
  }
}

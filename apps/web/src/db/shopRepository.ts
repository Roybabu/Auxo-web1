import type { ShopCategoryType, SqlDatabase } from "@auxo/core";

export interface ShopSettings {
  storeName: string;
  categories: ShopCategoryType[];
  createdAt: number;
}

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
    };
  }

  async save(settings: ShopSettings): Promise<void> {
    await this.db.exec(
      `INSERT INTO shop_settings (id, store_name, categories, created_at) VALUES (1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET store_name = excluded.store_name, categories = excluded.categories`,
      [settings.storeName, JSON.stringify(settings.categories), settings.createdAt],
    );
  }
}

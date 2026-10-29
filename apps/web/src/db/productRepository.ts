import type {
  GstRule,
  Product,
  ProductVariant,
  ShopCategoryType,
  SqlDatabase,
  SqlRow,
  StockUnit,
} from "@auxo/core";

function rowToProduct(row: SqlRow): Product {
  return {
    id: row.id as string,
    androidId: (row.android_id as number | null) ?? null,
    name: row.name as string,
    brand: (row.brand as string | null) ?? null,
    category: row.category as ShopCategoryType,
    categoryId: (row.category_id as string | null) ?? null,
    subcategory: (row.subcategory as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    material: (row.material as string | null) ?? null,
    dietType: (row.diet_type as string | null) ?? null,
    hsnCode: (row.hsn_code as string | null) ?? null,
    gstRule: JSON.parse(row.gst_rule as string) as GstRule,
    stockUnit: row.stock_unit as StockUnit,
    preferredSupplierId: (row.preferred_supplier_id as string | null) ?? null,
    photoFile: (row.photo_file as string | null) ?? null,
    available: Boolean(row.available),
    tracksStock: Boolean(row.tracks_stock),
    warrantyMonths: (row.warranty_months as number | null) ?? null,
    prescriptionRequired: Boolean(row.prescription_required),
    metal: (row.metal as string | null) ?? null,
    makingChargeBp: (row.making_charge_bp as number | null) ?? null,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
    deletedAt: (row.deleted_at as number | null) ?? null,
  };
}

function rowToVariant(row: SqlRow): ProductVariant {
  return {
    id: row.id as string,
    androidId: (row.android_id as number | null) ?? null,
    productId: row.product_id as string,
    sku: (row.sku as string | null) ?? null,
    barcode: (row.barcode as string | null) ?? null,
    size: (row.size as string | null) ?? null,
    colour: (row.colour as string | null) ?? null,
    netQuantityMilli: (row.net_quantity_milli as number | null) ?? null,
    netQuantityUnit: (row.net_quantity_unit as StockUnit | null) ?? null,
    priceMinor: row.price_minor as unknown as ProductVariant["priceMinor"],
    mrpMinor: (row.mrp_minor as unknown as ProductVariant["mrpMinor"]) ?? null,
    costMinor: (row.cost_minor as unknown as ProductVariant["costMinor"]) ?? null,
    stockQuantity: row.stock_quantity as number,
    lowStockThreshold: (row.low_stock_threshold as number | null) ?? null,
    reorderQuantity: (row.reorder_quantity as number | null) ?? null,
    batchNumber: (row.batch_number as string | null) ?? null,
    expiryEpochDay: (row.expiry_epoch_day as number | null) ?? null,
    photoFile: (row.photo_file as string | null) ?? null,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
    deletedAt: (row.deleted_at as number | null) ?? null,
  };
}

export interface ProductWithVariants {
  product: Product;
  variants: ProductVariant[];
}

export class ProductRepository {
  constructor(private readonly db: SqlDatabase) {}

  async create(product: Product): Promise<void> {
    await this.db.exec(
      `INSERT INTO products
        (id, android_id, name, brand, category, category_id, subcategory, description, material,
         diet_type, hsn_code, gst_rule, stock_unit, preferred_supplier_id, photo_file, available,
         tracks_stock, warranty_months, prescription_required, metal, making_charge_bp,
         created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        product.id,
        product.androidId,
        product.name,
        product.brand,
        product.category,
        product.categoryId,
        product.subcategory,
        product.description,
        product.material,
        product.dietType,
        product.hsnCode,
        JSON.stringify(product.gstRule),
        product.stockUnit,
        product.preferredSupplierId,
        product.photoFile,
        product.available ? 1 : 0,
        product.tracksStock ? 1 : 0,
        product.warrantyMonths,
        product.prescriptionRequired ? 1 : 0,
        product.metal,
        product.makingChargeBp,
        product.createdAt,
        product.updatedAt,
        product.deletedAt,
      ],
    );
  }

  async listWithVariants(): Promise<ProductWithVariants[]> {
    const productRows = await this.db.query(
      "SELECT * FROM products WHERE deleted_at IS NULL ORDER BY created_at DESC",
    );
    const products = productRows.map(rowToProduct);
    const variantRows = await this.db.query("SELECT * FROM product_variants WHERE deleted_at IS NULL");
    const variants = variantRows.map(rowToVariant);
    return products.map((product) => ({
      product,
      variants: variants.filter((v) => v.productId === product.id),
    }));
  }
}

export class ProductVariantRepository {
  constructor(private readonly db: SqlDatabase) {}

  async create(variant: ProductVariant): Promise<void> {
    await this.db.exec(
      `INSERT INTO product_variants
        (id, android_id, product_id, sku, barcode, size, colour, net_quantity_milli,
         net_quantity_unit, price_minor, mrp_minor, cost_minor, stock_quantity,
         low_stock_threshold, reorder_quantity, batch_number, expiry_epoch_day, photo_file,
         created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        variant.id,
        variant.androidId,
        variant.productId,
        variant.sku,
        variant.barcode,
        variant.size,
        variant.colour,
        variant.netQuantityMilli,
        variant.netQuantityUnit,
        variant.priceMinor,
        variant.mrpMinor,
        variant.costMinor,
        variant.stockQuantity,
        variant.lowStockThreshold,
        variant.reorderQuantity,
        variant.batchNumber,
        variant.expiryEpochDay,
        variant.photoFile,
        variant.createdAt,
        variant.updatedAt,
        variant.deletedAt,
      ],
    );
  }

  async updateStockQuantity(variantId: string, newQuantity: number, updatedAt: number): Promise<void> {
    await this.db.exec("UPDATE product_variants SET stock_quantity = ?, updated_at = ? WHERE id = ?", [
      newQuantity,
      updatedAt,
      variantId,
    ]);
  }

  async findById(id: string): Promise<ProductVariant | null> {
    const rows = await this.db.query("SELECT * FROM product_variants WHERE id = ?", [id]);
    return rows[0] ? rowToVariant(rows[0]) : null;
  }

  async barcodeExists(barcode: string): Promise<boolean> {
    const rows = await this.db.query<{ count: number }>(
      "SELECT COUNT(*) as count FROM product_variants WHERE barcode = ? AND deleted_at IS NULL",
      [barcode],
    );
    return (rows[0]?.count ?? 0) > 0;
  }
}

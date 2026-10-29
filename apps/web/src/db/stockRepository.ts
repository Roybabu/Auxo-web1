import { applyStockAdjustment, type SqlDatabase, type StockMovementReason } from "@auxo/core";
import { ProductVariantRepository } from "./productRepository";

export class StockRepository {
  constructor(private readonly db: SqlDatabase) {}

  /** Applies a stock adjustment to a variant, recording both the movement and the new quantity. */
  async adjust(variantId: string, reason: StockMovementReason, amount: number, note: string | null): Promise<number> {
    return this.db.transaction(async (tx) => {
      const variantRepo = new ProductVariantRepository(tx);
      const variant = await variantRepo.findById(variantId);
      if (!variant) throw new Error(`No product variant with id ${variantId}`);

      const { newQuantity, movementQuantityChange } = applyStockAdjustment(
        variant.stockQuantity,
        reason,
        amount,
      );
      const now = Date.now();

      await tx.exec(
        `INSERT INTO stock_movements
          (id, android_id, variant_id, quantity_change, reason, note, invoice_id, batch_id,
           receipt_id, created_at, updated_at, deleted_at)
         VALUES (?, NULL, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, NULL)`,
        [crypto.randomUUID(), variantId, movementQuantityChange, reason, note, now, now],
      );
      await variantRepo.updateStockQuantity(variantId, newQuantity, now);
      return newQuantity;
    });
  }
}

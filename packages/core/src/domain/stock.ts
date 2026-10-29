import type { StockMovementReason } from "./entities";

/**
 * Stock movement math and FEFO (first-expiry-first-out) batch allocation, ported from the
 * Android app's `StockAdjustment`/`BatchAllocator`. Stock is never overwritten in place — every
 * change is a signed movement, so a future server sync can replay them.
 */

export interface StockAdjustmentResult {
  /** The variant's new on-hand quantity after applying this adjustment. */
  newQuantity: number;
  /** The signed delta to record on the stock_movements row. */
  movementQuantityChange: number;
}

/**
 * @param amount For RECEIVED/RETURNED/SOLD/DAMAGED, the quantity being added or removed (always
 *   given as a positive number). For CORRECTION, the newly *counted* on-hand quantity (the
 *   target value, not a delta) — the signed movement is computed from the difference.
 */
export function applyStockAdjustment(
  currentQuantity: number,
  reason: StockMovementReason,
  amount: number,
): StockAdjustmentResult {
  switch (reason) {
    case "RECEIVED":
    case "RETURNED":
      if (amount < 0) throw new Error(`${reason} amount must be non-negative`);
      return { newQuantity: currentQuantity + amount, movementQuantityChange: amount };
    case "SOLD":
    case "DAMAGED":
      if (amount < 0) throw new Error(`${reason} amount must be non-negative`);
      return { newQuantity: currentQuantity - amount, movementQuantityChange: -amount };
    case "CORRECTION": {
      const delta = amount - currentQuantity;
      return { newQuantity: amount, movementQuantityChange: delta };
    }
  }
}

export interface AllocatableBatch {
  batchId: string;
  quantity: number;
  /** Epoch day; null/undefined means "no expiry" and is allocated from last. */
  expiryEpochDay: number | null;
}

export interface BatchAllocation {
  batchId: string;
  quantity: number;
}

export interface FefoAllocationResult {
  allocations: BatchAllocation[];
  /** >0 if there wasn't enough total stock across all batches to satisfy the request. */
  shortfall: number;
}

/**
 * Allocates `requestedQuantity` units across `batches`, taking from the earliest-expiring batch
 * first (expired or soon-to-expire stock gets sold/consumed before fresher stock). Batches with
 * no expiry are treated as expiring last. Does not mutate `batches`.
 */
export function allocateFefo(batches: readonly AllocatableBatch[], requestedQuantity: number): FefoAllocationResult {
  if (requestedQuantity < 0) {
    throw new Error("requestedQuantity must be non-negative");
  }
  const sorted = [...batches]
    .filter((b) => b.quantity > 0)
    .sort((a, b) => {
      if (a.expiryEpochDay === b.expiryEpochDay) return 0;
      if (a.expiryEpochDay === null) return 1; // no expiry sorts last
      if (b.expiryEpochDay === null) return -1;
      return a.expiryEpochDay - b.expiryEpochDay;
    });

  const allocations: BatchAllocation[] = [];
  let remaining = requestedQuantity;
  for (const batch of sorted) {
    if (remaining <= 0) break;
    const take = Math.min(batch.quantity, remaining);
    if (take > 0) {
      allocations.push({ batchId: batch.batchId, quantity: take });
      remaining -= take;
    }
  }
  return { allocations, shortfall: remaining };
}

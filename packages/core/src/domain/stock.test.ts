import { describe, expect, it } from "vitest";
import { allocateFefo, applyStockAdjustment } from "./stock";

describe("applyStockAdjustment", () => {
  it("RECEIVED and RETURNED add to the current quantity", () => {
    expect(applyStockAdjustment(10, "RECEIVED", 5)).toEqual({ newQuantity: 15, movementQuantityChange: 5 });
    expect(applyStockAdjustment(10, "RETURNED", 2)).toEqual({ newQuantity: 12, movementQuantityChange: 2 });
  });

  it("SOLD and DAMAGED remove from the current quantity", () => {
    expect(applyStockAdjustment(10, "SOLD", 3)).toEqual({ newQuantity: 7, movementQuantityChange: -3 });
    expect(applyStockAdjustment(10, "DAMAGED", 1)).toEqual({ newQuantity: 9, movementQuantityChange: -1 });
  });

  it("CORRECTION sets the quantity to the counted value and records the signed delta", () => {
    expect(applyStockAdjustment(10, "CORRECTION", 7)).toEqual({ newQuantity: 7, movementQuantityChange: -3 });
    expect(applyStockAdjustment(10, "CORRECTION", 14)).toEqual({ newQuantity: 14, movementQuantityChange: 4 });
  });

  it("rejects a negative amount for non-correction reasons", () => {
    expect(() => applyStockAdjustment(10, "SOLD", -1)).toThrow();
  });
});

describe("allocateFefo", () => {
  it("takes from the earliest-expiring batch first", () => {
    const batches = [
      { batchId: "late", quantity: 10, expiryEpochDay: 200 },
      { batchId: "early", quantity: 5, expiryEpochDay: 100 },
    ];
    const result = allocateFefo(batches, 3);
    expect(result).toEqual({ allocations: [{ batchId: "early", quantity: 3 }], shortfall: 0 });
  });

  it("spills over into the next-earliest batch once one is exhausted", () => {
    const batches = [
      { batchId: "late", quantity: 10, expiryEpochDay: 200 },
      { batchId: "early", quantity: 5, expiryEpochDay: 100 },
    ];
    const result = allocateFefo(batches, 8);
    expect(result).toEqual({
      allocations: [
        { batchId: "early", quantity: 5 },
        { batchId: "late", quantity: 3 },
      ],
      shortfall: 0,
    });
  });

  it("treats batches with no expiry as expiring last", () => {
    const batches = [
      { batchId: "no-expiry", quantity: 5, expiryEpochDay: null },
      { batchId: "has-expiry", quantity: 5, expiryEpochDay: 100 },
    ];
    const result = allocateFefo(batches, 7);
    expect(result.allocations).toEqual([
      { batchId: "has-expiry", quantity: 5 },
      { batchId: "no-expiry", quantity: 2 },
    ]);
  });

  it("reports a shortfall when total stock is insufficient", () => {
    const batches = [{ batchId: "only", quantity: 3, expiryEpochDay: 100 }];
    const result = allocateFefo(batches, 10);
    expect(result).toEqual({ allocations: [{ batchId: "only", quantity: 3 }], shortfall: 7 });
  });

  it("ignores batches with zero or negative quantity", () => {
    const batches = [
      { batchId: "empty", quantity: 0, expiryEpochDay: 50 },
      { batchId: "full", quantity: 5, expiryEpochDay: 100 },
    ];
    const result = allocateFefo(batches, 3);
    expect(result.allocations).toEqual([{ batchId: "full", quantity: 3 }]);
  });
});

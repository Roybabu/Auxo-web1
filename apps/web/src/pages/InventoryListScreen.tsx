import { useEffect, useState } from "react";
import { useDatabase } from "../db/DatabaseContext";
import { ProductRepository, type ProductWithVariants } from "../db/productRepository";
import { StockRepository } from "../db/stockRepository";
import { ProductEditorScreen } from "./ProductEditorScreen";
import styles from "./InventoryListScreen.module.css";

export function InventoryListScreen({ onBack }: { onBack: () => void }) {
  const { db } = useDatabase();
  const [items, setItems] = useState<ProductWithVariants[] | null>(null);
  const [adding, setAdding] = useState(false);

  async function reload() {
    if (!db) return;
    const repo = new ProductRepository(db);
    setItems(await repo.listWithVariants());
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db]);

  async function receiveStock(variantId: string) {
    if (!db) return;
    const qtyText = window.prompt("How many units are you receiving?");
    if (!qtyText) return;
    const qty = Number.parseInt(qtyText, 10);
    if (!Number.isFinite(qty) || qty <= 0) return;
    const stockRepo = new StockRepository(db);
    await stockRepo.adjust(variantId, "RECEIVED", qty, "Stock received");
    await reload();
  }

  if (adding) {
    return (
      <ProductEditorScreen
        onBack={() => setAdding(false)}
        onCreated={async () => {
          setAdding(false);
          await reload();
        }}
      />
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <button type="button" className={styles.backButton} onClick={onBack}>
            ← Back
          </button>
          <h1 className={styles.title}>Products</h1>
        </div>
        <button type="button" className={styles.addButton} onClick={() => setAdding(true)}>
          Add product
        </button>
      </header>

      {items === null ? null : items.length === 0 ? (
        <p className={styles.empty}>No products yet. Add your first one.</p>
      ) : (
        <div>
          {items.map(({ product, variants }) =>
            variants.map((variant) => {
              const lowStock =
                variant.lowStockThreshold !== null && variant.stockQuantity <= variant.lowStockThreshold;
              return (
                <div key={variant.id} className={styles.row}>
                  <div className={styles.rowMain}>
                    <p className={styles.rowName}>
                      {product.name}
                      {variant.size || variant.colour
                        ? ` — ${[variant.size, variant.colour].filter(Boolean).join(" / ")}`
                        : ""}
                    </p>
                    <p className={styles.rowMeta}>
                      {product.category}
                      {variant.barcode ? ` · ${variant.barcode}` : ""}
                    </p>
                  </div>
                  <div className={styles.rowRight}>
                    {lowStock && <span className={styles.lowStockBadge}>Low stock</span>}
                    <span className={styles.stockQty}>{variant.stockQuantity}</span>
                    <button
                      type="button"
                      className={styles.receiveButton}
                      onClick={() => receiveStock(variant.id)}
                    >
                      Receive
                    </button>
                  </div>
                </div>
              );
            }),
          )}
        </div>
      )}
    </main>
  );
}

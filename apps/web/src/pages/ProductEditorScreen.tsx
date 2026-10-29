import {
  generateInternalEan13,
  money,
  validateBarcode,
  type GstRule,
  type Product,
  type ProductVariant,
  type ShopCategoryType,
  type StockUnit,
} from "@auxo/core";
import { useState, type FormEvent } from "react";
import { useDatabase } from "../db/DatabaseContext";
import { ProductRepository, ProductVariantRepository } from "../db/productRepository";
import { StockRepository } from "../db/stockRepository";
import styles from "./ProductEditorScreen.module.css";

const CATEGORY_OPTIONS: ShopCategoryType[] = [
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
];

type GstRuleKind = GstRule["kind"];

function newId(): string {
  return crypto.randomUUID();
}

export function ProductEditorScreen({
  onBack,
  onCreated,
}: {
  onBack: () => void;
  onCreated: () => void;
}) {
  const { db } = useDatabase();

  const [name, setName] = useState("");
  const [category, setCategory] = useState<ShopCategoryType>("GENERAL");
  const [hsnCode, setHsnCode] = useState("");
  const [stockUnit, setStockUnit] = useState<StockUnit>("UNIT");
  const [gstRuleKind, setGstRuleKind] = useState<GstRuleKind>("NONE");
  const [gstRateBp, setGstRateBp] = useState("1800");
  const [metal, setMetal] = useState("");
  const [makingChargePercent, setMakingChargePercent] = useState("");
  const [prescriptionRequired, setPrescriptionRequired] = useState(false);

  const [price, setPrice] = useState("");
  const [mrp, setMrp] = useState("");
  const [cost, setCost] = useState("");
  const [initialStock, setInitialStock] = useState("0");
  const [lowStockThreshold, setLowStockThreshold] = useState("");
  const [barcode, setBarcode] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const barcodeValidation = barcode.trim() ? validateBarcode(barcode.trim()) : null;

  function generateBarcode() {
    setBarcode(generateInternalEan13(Math.floor(Date.now() / 1000) % 10 ** 11));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (name.trim().length === 0) return setError("Enter a product name");
    const priceRupees = Number.parseFloat(price);
    if (!Number.isFinite(priceRupees) || priceRupees < 0) return setError("Enter a valid price");
    if (barcode.trim() && barcodeValidation && !barcodeValidation.valid) {
      return setError("That barcode doesn't look valid — check it or generate one instead");
    }
    if (!db) return setError("Storage is not ready yet");

    const variantRepo = new ProductVariantRepository(db);
    if (barcode.trim()) {
      const exists = await variantRepo.barcodeExists(barcode.trim());
      if (exists) return setError("Another product already uses that barcode");
    }

    setSubmitting(true);
    try {
      const now = Date.now();
      const gstRule: GstRule =
        gstRuleKind === "FIXED"
          ? { kind: "FIXED", rateBp: Number.parseInt(gstRateBp, 10) || 0 }
          : { kind: gstRuleKind };

      const product: Product = {
        id: newId(),
        androidId: null,
        name: name.trim(),
        brand: null,
        category,
        categoryId: null,
        subcategory: null,
        description: null,
        material: null,
        dietType: null,
        hsnCode: hsnCode.trim() || null,
        gstRule,
        stockUnit,
        preferredSupplierId: null,
        photoFile: null,
        available: true,
        tracksStock: true,
        warrantyMonths: null,
        prescriptionRequired: category === "PHARMACY" ? prescriptionRequired : false,
        metal: category === "JEWELLERY" ? metal.trim() || null : null,
        makingChargeBp:
          category === "JEWELLERY" && makingChargePercent.trim()
            ? Math.round(Number.parseFloat(makingChargePercent) * 100)
            : null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };

      const variant: ProductVariant = {
        id: newId(),
        androidId: null,
        productId: product.id,
        sku: null,
        barcode: barcode.trim() || null,
        size: null,
        colour: null,
        netQuantityMilli: null,
        netQuantityUnit: null,
        priceMinor: money(Math.round(priceRupees * 100)),
        mrpMinor: mrp.trim() ? money(Math.round(Number.parseFloat(mrp) * 100)) : null,
        costMinor: cost.trim() ? money(Math.round(Number.parseFloat(cost) * 100)) : null,
        stockQuantity: 0,
        lowStockThreshold: lowStockThreshold.trim() ? Number.parseInt(lowStockThreshold, 10) : null,
        reorderQuantity: null,
        batchNumber: null,
        expiryEpochDay: null,
        photoFile: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };

      const productRepo = new ProductRepository(db);
      await productRepo.create(product);
      await variantRepo.create(variant);

      const initialQty = Number.parseInt(initialStock, 10);
      if (Number.isFinite(initialQty) && initialQty > 0) {
        const stockRepo = new StockRepository(db);
        await stockRepo.adjust(variant.id, "RECEIVED", initialQty, "Initial stock");
      }

      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <button type="button" className={styles.backButton} onClick={onBack}>
          ← Back
        </button>
        <h1 className={styles.title}>Add product</h1>
      </header>

      <form onSubmit={handleSubmit}>
        {error && <p className={styles.error}>{error}</p>}

        <section className={styles.section}>
          <p className={styles.sectionTitle}>Basics</p>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="name">
              Name
            </label>
            <input id="name" className={styles.input} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="category">
                Category
              </label>
              <select
                id="category"
                className={styles.select}
                value={category}
                onChange={(e) => setCategory(e.target.value as ShopCategoryType)}
              >
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="hsnCode">
                HSN code
              </label>
              <input id="hsnCode" className={styles.input} value={hsnCode} onChange={(e) => setHsnCode(e.target.value)} />
            </div>
          </div>

          {category === "LOOSE" && (
            <div className={styles.field}>
              <label className={styles.label} htmlFor="stockUnit">
                Sold by
              </label>
              <select
                id="stockUnit"
                className={styles.select}
                value={stockUnit}
                onChange={(e) => setStockUnit(e.target.value as StockUnit)}
              >
                <option value="GRAM">Weight (grams)</option>
                <option value="MILLILITRE">Volume (millilitres)</option>
              </select>
            </div>
          )}

          {category === "JEWELLERY" && (
            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="metal">
                  Metal / purity
                </label>
                <input id="metal" className={styles.input} value={metal} onChange={(e) => setMetal(e.target.value)} placeholder="22K Gold" />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="makingCharge">
                  Making charge (%)
                </label>
                <input
                  id="makingCharge"
                  className={styles.input}
                  inputMode="decimal"
                  value={makingChargePercent}
                  onChange={(e) => setMakingChargePercent(e.target.value)}
                  placeholder="12"
                />
              </div>
            </div>
          )}

          {category === "PHARMACY" && (
            <label className={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={prescriptionRequired}
                onChange={(e) => setPrescriptionRequired(e.target.checked)}
              />
              Prescription required
            </label>
          )}
        </section>

        <section className={styles.section}>
          <p className={styles.sectionTitle}>Tax</p>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="gstRule">
              GST
            </label>
            <select
              id="gstRule"
              className={styles.select}
              value={gstRuleKind}
              onChange={(e) => setGstRuleKind(e.target.value as GstRuleKind)}
            >
              <option value="NONE">Not applicable</option>
              <option value="FIXED">Fixed rate</option>
              {(category === "GARMENT" || category === "FOOTWEAR") && (
                <option value="APPAREL">Apparel slab (5% / 18% by value)</option>
              )}
            </select>
          </div>
          {gstRuleKind === "FIXED" && (
            <div className={styles.field}>
              <label className={styles.label} htmlFor="gstRate">
                Rate (basis points, 1800 = 18%)
              </label>
              <input
                id="gstRate"
                className={styles.input}
                inputMode="numeric"
                value={gstRateBp}
                onChange={(e) => setGstRateBp(e.target.value)}
              />
            </div>
          )}
        </section>

        <section className={styles.section}>
          <p className={styles.sectionTitle}>Pricing &amp; stock</p>
          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="price">
                Selling price (₹)
              </label>
              <input id="price" className={styles.input} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="mrp">
                MRP (₹)
              </label>
              <input id="mrp" className={styles.input} inputMode="decimal" value={mrp} onChange={(e) => setMrp(e.target.value)} />
            </div>
          </div>
          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="cost">
                Cost price (₹)
              </label>
              <input id="cost" className={styles.input} inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="initialStock">
                Initial stock
              </label>
              <input
                id="initialStock"
                className={styles.input}
                inputMode="numeric"
                value={initialStock}
                onChange={(e) => setInitialStock(e.target.value)}
              />
            </div>
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="lowStock">
              Low stock threshold
            </label>
            <input
              id="lowStock"
              className={styles.input}
              inputMode="numeric"
              value={lowStockThreshold}
              onChange={(e) => setLowStockThreshold(e.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="barcode">
              Barcode
            </label>
            <div className={styles.barcodeRow}>
              <input id="barcode" className={styles.input} value={barcode} onChange={(e) => setBarcode(e.target.value)} />
              <button type="button" className={styles.ghostButton} onClick={generateBarcode}>
                Generate
              </button>
            </div>
            {barcodeValidation && (
              <p className={[styles.barcodeStatus, barcodeValidation.valid ? styles.barcodeValid : styles.barcodeInvalid].join(" ")}>
                {barcodeValidation.valid ? `Valid ${barcodeValidation.type}` : "Not a valid barcode"}
              </p>
            )}
          </div>
        </section>

        <button type="submit" className={styles.button} disabled={submitting}>
          {submitting ? "Saving…" : "Save product"}
        </button>
      </form>
    </main>
  );
}

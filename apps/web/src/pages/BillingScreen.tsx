import {
  billDiscountExceedsLimit,
  calculateBill,
  checkCreditLimit,
  CreditLimitExceededError,
  formatMinorUnits,
  lineDiscountExceedsLimit,
  money,
  normalizeDiscountReason,
  type BillLineInput,
  type Customer,
  type DiscountSpec,
  type GstRule,
  type Money as MoneyType,
  type PaymentMethod,
  type StockUnit,
} from "@auxo/core";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { CustomerLedgerRepository, CustomerRepository } from "../db/customerRepository";
import { useDatabase } from "../db/DatabaseContext";
import { HeldBillRepository } from "../db/heldBillRepository";
import { InvoiceRepository, type SaleLineMeta } from "../db/invoiceRepository";
import { ProductRepository, type ProductWithVariants } from "../db/productRepository";
import styles from "./BillingScreen.module.css";

interface CartLine {
  lineId: string;
  variantId: string | null;
  productName: string;
  variantLabel: string | null;
  stockUnit: StockUnit;
  quantity: number;
  unitPriceMinor: MoneyType;
  gstRule: GstRule;
  mrpMinor: MoneyType | null;
  lineDiscountPercentText: string;
}

function rupees(m: MoneyType): string {
  return `₹${formatMinorUnits(m)}`;
}

function newLineId(): string {
  return crypto.randomUUID();
}

export function BillingScreen({ onBack }: { onBack: () => void }) {
  const { db } = useDatabase();
  const { currentUser, shop, permissions } = useAuth();

  const [catalogue, setCatalogue] = useState<ProductWithVariants[]>([]);
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [billDiscountKind, setBillDiscountKind] = useState<"NONE" | "AMOUNT" | "PERCENT">("NONE");
  const [billDiscountValue, setBillDiscountValue] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CASH");
  const [tenderedText, setTenderedText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState<{ number: string; grandTotal: MoneyType } | null>(null);
  const [heldBills, setHeldBills] = useState<Awaited<ReturnType<HeldBillRepository["listActive"]>>>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);

  async function reloadHeldBills() {
    if (!db) return;
    setHeldBills(await new HeldBillRepository(db).listActive());
  }

  useEffect(() => {
    if (!db) return;
    void new ProductRepository(db).listWithVariants().then(setCatalogue);
    void new CustomerRepository(db).listActive().then(setCustomers);
    void reloadHeldBills();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db]);

  async function resumeHeldBill(id: string, payload: string) {
    if (!db) return;
    setCart(JSON.parse(payload) as CartLine[]);
    await new HeldBillRepository(db).remove(id);
    await reloadHeldBills();
  }

  const searchResults = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.trim().toLowerCase();
    const results: { product: ProductWithVariants["product"]; variant: ProductWithVariants["variants"][number] }[] = [];
    for (const { product, variants } of catalogue) {
      for (const variant of variants) {
        if (
          product.name.toLowerCase().includes(q) ||
          (variant.barcode && variant.barcode.includes(q))
        ) {
          results.push({ product, variant });
        }
      }
    }
    return results.slice(0, 8);
  }, [query, catalogue]);

  function addVariantToCart(product: ProductWithVariants["product"], variant: ProductWithVariants["variants"][number]) {
    setCart((prev) => {
      const existing = prev.find((l) => l.variantId === variant.id);
      if (existing) {
        return prev.map((l) => (l.variantId === variant.id ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [
        ...prev,
        {
          lineId: newLineId(),
          variantId: variant.id,
          productName: product.name,
          variantLabel: [variant.size, variant.colour].filter(Boolean).join(" / ") || null,
          stockUnit: variant.netQuantityUnit ?? "UNIT",
          quantity: 1,
          unitPriceMinor: variant.priceMinor,
          gstRule: product.gstRule,
          mrpMinor: variant.mrpMinor,
          lineDiscountPercentText: "",
        },
      ];
    });
    setQuery("");
  }

  function addCustomItem() {
    const name = window.prompt("Item name?");
    if (!name) return;
    const priceText = window.prompt("Price (₹)?");
    const price = Number.parseFloat(priceText ?? "");
    if (!Number.isFinite(price) || price < 0) return;
    setCart((prev) => [
      ...prev,
      {
        lineId: newLineId(),
        variantId: null,
        productName: name,
        variantLabel: null,
        stockUnit: "UNIT",
        quantity: 1,
        unitPriceMinor: money(Math.round(price * 100)),
        gstRule: { kind: "NONE" },
        mrpMinor: null,
        lineDiscountPercentText: "",
      },
    ]);
  }

  function updateQuantity(lineId: string, delta: number) {
    setCart((prev) =>
      prev
        .map((l) => (l.lineId === lineId ? { ...l, quantity: Math.max(1, l.quantity + delta) } : l))
        .filter((l) => l.quantity > 0),
    );
  }

  function removeLine(lineId: string) {
    setCart((prev) => prev.filter((l) => l.lineId !== lineId));
  }

  function setLineDiscount(lineId: string, text: string) {
    setCart((prev) => prev.map((l) => (l.lineId === lineId ? { ...l, lineDiscountPercentText: text } : l)));
  }

  const billLineInputs: BillLineInput[] = cart.map((l) => {
    const percent = Number.parseFloat(l.lineDiscountPercentText);
    const lineDiscount: DiscountSpec | null =
      Number.isFinite(percent) && percent > 0 ? { kind: "PERCENT", rateBp: Math.round(percent * 100) } : null;
    return {
      lineId: l.lineId,
      grossMinor: money((l.unitPriceMinor as number) * l.quantity),
      quantity: l.quantity,
      stockUnit: l.stockUnit,
      lineDiscount,
      gstRule: l.gstRule,
      mrpMinor: l.mrpMinor,
    };
  });

  const billDiscount: DiscountSpec | null =
    billDiscountKind === "NONE" || !billDiscountValue.trim()
      ? null
      : billDiscountKind === "AMOUNT"
        ? { kind: "AMOUNT", amountMinor: money(Math.round(Number.parseFloat(billDiscountValue) * 100)) }
        : { kind: "PERCENT", rateBp: Math.round(Number.parseFloat(billDiscountValue) * 100) };

  const calculation =
    shop && cart.length > 0
      ? calculateBill({
          lines: billLineInputs,
          billDiscount,
          requestedLoyaltyRedemptionMinor: money(0),
          gstRegistered: shop.gstRegistered,
          pricesIncludeTax: shop.pricesIncludeTax,
          interState: shop.interState,
          roundOffEnabled: shop.roundOffEnabled,
        })
      : null;

  const tendered = Number.parseFloat(tenderedText);
  const tenderedMinor = Number.isFinite(tendered) ? money(Math.round(tendered * 100)) : null;
  const changeMinor =
    tenderedMinor !== null && calculation ? money(Math.max(0, (tenderedMinor as number) - calculation.grandTotalMinor)) : null;

  async function handlePark() {
    if (!db || cart.length === 0) return;
    const repo = new HeldBillRepository(db);
    const now = Date.now();
    await repo.park({
      id: crypto.randomUUID(),
      androidId: null,
      label: null,
      itemCount: cart.length,
      totalMinor: calculation?.grandTotalMinor ?? money(0),
      payload: JSON.stringify(cart),
      tableNumber: null,
      tokenNumber: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    setCart([]);
    await reloadHeldBills();
  }

  async function handleCompleteSale() {
    setError(null);
    if (!db || !shop || !calculation || !currentUser) return;
    if (cart.length === 0) return setError("Add at least one item");

    const isSuperAdmin = currentUser.role === "SUPER_ADMIN";
    const hasUnlimited = permissions.has("UNLIMITED_DISCOUNT");
    if (!isSuperAdmin && !hasUnlimited) {
      // Line-level discounts entered by the cashier (not the bill-discount allocation share).
      const enteredLineDiscounts = billLineInputs.map((l, i) => {
        const gross = l.grossMinor;
        const afterDiscount = calculation.lines[i]!.afterLineDiscountMinor;
        return money(gross - afterDiscount);
      });
      for (let i = 0; i < enteredLineDiscounts.length; i++) {
        if (lineDiscountExceedsLimit(enteredLineDiscounts[i]!, billLineInputs[i]!.grossMinor, shop.employeeDiscountLimitBp)) {
          return setError("A line discount exceeds your discount limit");
        }
      }
      if (
        billDiscountExceedsLimit({
          lineDiscountsMinor: enteredLineDiscounts,
          manualBillDiscountMinor: calculation.manualBillDiscountMinor,
          subtotalMinor: calculation.subtotalMinor,
          limitBp: shop.employeeDiscountLimitBp,
        })
      ) {
        return setError("This discount exceeds your discount limit");
      }
    }

    if (paymentMethod === "CASH" && (tenderedMinor === null || (tenderedMinor as number) < calculation.grandTotalMinor)) {
      return setError("Enter an amount tendered that covers the total");
    }

    const selectedCustomer = customers.find((c) => c.id === selectedCustomerId) ?? null;
    if (paymentMethod === "ACCOUNT") {
      if (!selectedCustomer) return setError("Pick a customer to bill this to their account");
      const ledgerRepo = new CustomerLedgerRepository(db);
      const aging = await ledgerRepo.aging(selectedCustomer.id);
      try {
        checkCreditLimit(aging.balanceMinor, calculation.grandTotalMinor, selectedCustomer.creditLimitMinor);
      } catch (err) {
        if (err instanceof CreditLimitExceededError) {
          return setError(`This sale would put ${selectedCustomer.name} over their credit limit`);
        }
        throw err;
      }
    }

    setSubmitting(true);
    try {
      const lineMeta: SaleLineMeta[] = cart.map((l) => ({
        lineId: l.lineId,
        variantId: l.variantId,
        productName: l.productName,
        variantLabel: l.variantLabel,
        stockUnit: l.stockUnit,
        quantity: l.quantity,
        unitPriceMinor: l.unitPriceMinor,
      }));

      const repo = new InvoiceRepository(db);
      const result = await repo.completeSale({
        invoicePrefix: shop.invoicePrefix,
        customerId: selectedCustomer?.id ?? null,
        gstRegistered: shop.gstRegistered,
        pricesIncludeTax: shop.pricesIncludeTax,
        interState: shop.interState,
        discountReason: billDiscountValue.trim() ? normalizeDiscountReason("Bill discount") : null,
        note: null,
        lines: lineMeta,
        calculation,
        payments: [
          {
            method: paymentMethod,
            kind: "PAYMENT",
            amountMinor: calculation.grandTotalMinor,
            reference: null,
            tenderedMinor: paymentMethod === "CASH" ? tenderedMinor : null,
            changeMinor: paymentMethod === "CASH" ? changeMinor : null,
          },
        ],
      });

      if (paymentMethod === "ACCOUNT" && selectedCustomer) {
        const now = Date.now();
        await new CustomerLedgerRepository(db).add({
          id: crypto.randomUUID(),
          androidId: null,
          customerId: selectedCustomer.id,
          type: "SALE",
          amountMinor: calculation.grandTotalMinor,
          invoiceId: result.invoiceId,
          method: null,
          reference: null,
          note: null,
          points: null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        });
      }

      setCompleted({ number: result.number, grandTotal: calculation.grandTotalMinor });
      setCart([]);
      setBillDiscountKind("NONE");
      setBillDiscountValue("");
      setTenderedText("");
      setSelectedCustomerId(null);
      const freshCatalogue = await new ProductRepository(db).listWithVariants();
      setCatalogue(freshCatalogue);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (completed) {
    return (
      <main className={styles.page}>
        <div className={[styles.summary, styles.receiptCard].join(" ")}>
          <p className={styles.receiptNumber}>{completed.number}</p>
          <p className={styles.receiptTotal}>{rupees(completed.grandTotal)}</p>
          <button type="button" className={styles.primaryButton} onClick={() => setCompleted(null)}>
            New bill
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <button type="button" className={styles.backButton} onClick={onBack}>
            ← Back
          </button>
          <h1 className={styles.title}>New bill</h1>
        </div>
        <div className={styles.headerActions}>
          <button type="button" className={styles.ghostButton} onClick={addCustomItem}>
            Custom item
          </button>
        </div>
      </header>

      <div className={styles.searchBox}>
        <input
          className={styles.searchInput}
          placeholder="Search products or scan a barcode…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        {searchResults.length > 0 && (
          <div className={styles.searchResults}>
            {searchResults.map(({ product, variant }) => (
              <button
                key={variant.id}
                type="button"
                className={styles.searchResultItem}
                onClick={() => addVariantToCart(product, variant)}
              >
                {product.name}
                {variant.size || variant.colour ? ` — ${[variant.size, variant.colour].filter(Boolean).join(" / ")}` : ""}
                <div className={styles.searchResultMeta}>
                  {rupees(variant.priceMinor)} · {variant.stockQuantity} in stock
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {cart.length === 0 ? (
        <p className={styles.emptyCart}>Search for a product or add a custom item to start a bill.</p>
      ) : (
        <div>
          {cart.map((line) => (
            <div key={line.lineId} className={styles.cartLine}>
              <div className={styles.cartLineMain}>
                <p className={styles.cartLineName}>
                  {line.productName}
                  {line.variantLabel ? ` — ${line.variantLabel}` : ""}
                </p>
                <p className={styles.cartLineMeta}>{rupees(line.unitPriceMinor)} each</p>
              </div>
              <input
                className={styles.discountInput}
                placeholder="disc %"
                inputMode="decimal"
                value={line.lineDiscountPercentText}
                onChange={(e) => setLineDiscount(line.lineId, e.target.value)}
              />
              <div className={styles.qtyStepper}>
                <button type="button" className={styles.stepperButton} onClick={() => updateQuantity(line.lineId, -1)}>
                  −
                </button>
                <span className={styles.qtyValue}>{line.quantity}</span>
                <button type="button" className={styles.stepperButton} onClick={() => updateQuantity(line.lineId, 1)}>
                  +
                </button>
              </div>
              <span className={styles.lineTotal}>
                {rupees(money((line.unitPriceMinor as number) * line.quantity))}
              </span>
              <button type="button" className={styles.removeButton} aria-label="Remove" onClick={() => removeLine(line.lineId)}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {cart.length > 0 && calculation && (
        <div className={styles.summary}>
          <div className={styles.discountRow}>
            <select
              id="billDiscountKind"
              className={styles.discountKindSelect}
              value={billDiscountKind}
              onChange={(e) => setBillDiscountKind(e.target.value as typeof billDiscountKind)}
            >
              <option value="NONE">No bill discount</option>
              <option value="AMOUNT">Discount ₹</option>
              <option value="PERCENT">Discount %</option>
            </select>
            {billDiscountKind !== "NONE" && (
              <input
                className={styles.discountValueInput}
                inputMode="decimal"
                value={billDiscountValue}
                onChange={(e) => setBillDiscountValue(e.target.value)}
              />
            )}
          </div>

          <div className={styles.summaryRow}>
            <span>Subtotal</span>
            <span>{rupees(calculation.subtotalMinor)}</span>
          </div>
          {calculation.lineDiscountTotalMinor + calculation.billDiscountTotalMinor > 0 && (
            <div className={styles.summaryRow}>
              <span>Discount</span>
              <span>−{rupees(money(calculation.lineDiscountTotalMinor + calculation.billDiscountTotalMinor))}</span>
            </div>
          )}
          {shop?.gstRegistered && (
            <>
              <div className={styles.summaryRow}>
                <span>Taxable</span>
                <span>{rupees(calculation.taxableMinor)}</span>
              </div>
              {shop.interState ? (
                <div className={styles.summaryRow}>
                  <span>IGST</span>
                  <span>{rupees(calculation.igstMinor)}</span>
                </div>
              ) : (
                <>
                  <div className={styles.summaryRow}>
                    <span>CGST</span>
                    <span>{rupees(calculation.cgstMinor)}</span>
                  </div>
                  <div className={styles.summaryRow}>
                    <span>SGST</span>
                    <span>{rupees(calculation.sgstMinor)}</span>
                  </div>
                </>
              )}
            </>
          )}
          {calculation.roundOffMinor !== 0 && (
            <div className={styles.summaryRow}>
              <span>Round off</span>
              <span>{rupees(calculation.roundOffMinor)}</span>
            </div>
          )}

          <div className={styles.grandTotalRow}>
            <span className={styles.grandTotalLabel}>Total</span>
            <span className={styles.grandTotalValue}>{rupees(calculation.grandTotalMinor)}</span>
          </div>

          <div className={styles.paymentMethods}>
            {(["CASH", "UPI", "CARD", "ACCOUNT"] as PaymentMethod[]).map((method) => (
              <button
                key={method}
                type="button"
                className={[styles.paymentMethodButton, paymentMethod === method ? styles.paymentMethodButtonSelected : ""].join(" ")}
                onClick={() => setPaymentMethod(method)}
              >
                {method === "ACCOUNT" ? "CREDIT" : method}
              </button>
            ))}
          </div>

          {paymentMethod === "CASH" && (
            <div className={styles.discountRow}>
              <input
                className={styles.discountValueInput}
                placeholder="Tendered ₹"
                inputMode="decimal"
                value={tenderedText}
                onChange={(e) => setTenderedText(e.target.value)}
              />
              {changeMinor !== null && <span>Change: {rupees(changeMinor)}</span>}
            </div>
          )}

          {paymentMethod === "ACCOUNT" && (
            <div className={styles.discountRow}>
              <select
                id="billingCustomer"
                className={styles.discountKindSelect}
                value={selectedCustomerId ?? ""}
                onChange={(e) => setSelectedCustomerId(e.target.value || null)}
              >
                <option value="">Select a customer…</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {error && <p className={styles.error}>{error}</p>}

          <div className={styles.actionRow}>
            <button type="button" className={styles.secondaryButton} onClick={handlePark}>
              Park bill
            </button>
            <button type="button" className={styles.primaryButton} disabled={submitting} onClick={handleCompleteSale}>
              {submitting ? "Completing…" : "Complete sale"}
            </button>
          </div>
        </div>
      )}

      {heldBills.length > 0 && cart.length === 0 && (
        <div className={styles.summary}>
          <p className={styles.cartLineMeta}>Parked bills</p>
          {heldBills.map((bill) => (
            <div key={bill.id} className={styles.cartLine}>
              <div className={styles.cartLineMain}>
                <p className={styles.cartLineName}>{bill.itemCount} item{bill.itemCount > 1 ? "s" : ""}</p>
              </div>
              <span className={styles.lineTotal}>{rupees(bill.totalMinor)}</span>
              <button
                type="button"
                className={styles.ghostButton}
                onClick={() => resumeHeldBill(bill.id, bill.payload)}
              >
                Resume
              </button>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

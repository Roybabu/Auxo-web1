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
  type ShopCategoryType,
  type StockUnit,
} from "@auxo/core";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useAuth } from "../auth/AuthContext";
import { CustomerLedgerRepository, CustomerRepository } from "../db/customerRepository";
import { useDatabase } from "../db/DatabaseContext";
import { HeldBillRepository } from "../db/heldBillRepository";
import { InvoiceRepository, type SaleLineMeta } from "../db/invoiceRepository";
import { ProductRepository, type ProductWithVariants } from "../db/productRepository";
import {
  Banknote,
  CreditCard,
  PauseCircle,
  Minus,
  Plus,
  Receipt as ReceiptIcon,
  ScanLine,
  Search,
  Smartphone,
  Trash2,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { ProductThumb } from "../components/ProductThumb";
import styles from "./BillingScreen.module.css";
import "./auxoBilling.css";

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
  const [whole, paise] = formatMinorUnits(m).split(".");
  const negative = whole!.startsWith("-");
  const digits = negative ? whole!.slice(1) : whole!;
  return `${negative ? "-" : ""}₹${Number(digits).toLocaleString("en-IN")}.${paise}`;
}

function newLineId(): string {
  return crypto.randomUUID();
}

const QUICK_AMOUNT_STEPS = [100, 500, 1000, 2000, 5000];

/** Round "amount received" suggestions at or above the total, for fast cash entry. */
function quickAmounts(total: number): number[] {
  if (total <= 0) return [];
  const suggestions = new Set<number>([Math.ceil(total)]);
  for (const step of QUICK_AMOUNT_STEPS) {
    const rounded = Math.ceil(total / step) * step;
    if (rounded > total) suggestions.add(rounded);
  }
  return Array.from(suggestions)
    .sort((a, b) => a - b)
    .slice(0, 4);
}

export function BillingScreen({ onBack, onNavigate }: { onBack: () => void; onNavigate?: () => void }) {
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
  const [browseCategory, setBrowseCategory] = useState<ShopCategoryType | "ALL">("ALL");
  const searchRef = useRef<HTMLInputElement>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutStep, setCheckoutStep] = useState<"review" | "payment">("review");
  const [now, setNow] = useState(() => new Date());
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const tick = window.setInterval(() => setNow(new Date()), 30_000);
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.clearInterval(tick);
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  function openCheckout() {
    if (cart.length === 0) return;
    setCheckoutStep("review");
    setCheckoutOpen(true);
  }

  useEffect(() => {
    if (completed) setCheckoutOpen(false);
  }, [completed]);

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

  const browseCategories = useMemo(() => {
    const seen = new Set<ShopCategoryType>();
    for (const { product } of catalogue) seen.add(product.category);
    return [...seen].sort();
  }, [catalogue]);

  const visibleItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalogue
      .filter(({ product }) => browseCategory === "ALL" || product.category === browseCategory)
      .flatMap(({ product, variants }) => variants.map((variant) => ({ product, variant })))
      .filter(
        ({ product, variant }) =>
          !q ||
          product.name.toLowerCase().includes(q) ||
          (variant.barcode !== null && variant.barcode.toLowerCase().includes(q)),
      );
  }, [catalogue, browseCategory, query]);

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

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    const code = query.trim();
    if (!code) return;
    for (const { product, variants } of catalogue) {
      const match = variants.find((v) => v.barcode === code);
      if (match) {
        event.preventDefault();
        addVariantToCart(product, match);
        return;
      }
    }
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

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      } else if (event.key === "F4") {
        event.preventDefault();
        if (checkoutOpen && checkoutStep === "payment") void handleCompleteSale();
        else if (!checkoutOpen) openCheckout();
      } else if (event.key === "F2") {
        event.preventDefault();
        if (cart.length > 0) void handlePark();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

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

  const selectedCustomer = customers.find((c) => c.id === selectedCustomerId) ?? null;
  const paymentOptions: { method: PaymentMethod; label: string; Icon: typeof Banknote }[] = [
    { method: "CASH", label: "Cash", Icon: Banknote },
    { method: "UPI", label: "UPI", Icon: Smartphone },
    { method: "CARD", label: "Card", Icon: CreditCard },
    { method: "ACCOUNT", label: "Credit", Icon: ReceiptIcon },
  ];
  const grandTotalMinor = calculation?.grandTotalMinor ?? 0;
  const itemCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const amountTendered = tenderedMinor === null ? 0 : (tenderedMinor as number);
  const shortfallMinor = grandTotalMinor - amountTendered;

  return (
    <div className="auxo-billing pos-screen">
      <div className="pos-topbar">
        <button type="button" className="pos-topbar-button" onClick={onBack}>
          ← Back
        </button>
        <div className="pos-search-field">
          <Search size={16} className="pos-search-icon" />
          <input
            ref={searchRef}
            placeholder="Search products, barcode or SKU…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            autoFocus
          />
        </div>
        <button type="button" className="pos-topbar-button" onClick={() => searchRef.current?.focus()}>
          <ScanLine size={16} />
          Scan <kbd>Ctrl+K</kbd>
        </button>
        {onNavigate && (
          <button type="button" className="pos-topbar-button" onClick={onNavigate}>
            <Plus size={16} />
            New Product
          </button>
        )}
        <button type="button" className="pos-topbar-button" onClick={addCustomItem}>
          <Plus size={16} />
          Custom item
        </button>
        <button type="button" className="pos-topbar-button" onClick={() => void handlePark()} disabled={cart.length === 0}>
          <PauseCircle size={16} />
          Hold Bill <kbd>F2</kbd>
        </button>
      </div>

      <div className="billing-screen">
        <section className="billing-picker">
          <h2>Items</h2>
          {browseCategories.length > 0 && (
            <div className="category-chips" role="group" aria-label="Filter by category">
              {(["ALL", ...browseCategories] as const).map((category) => (
                <button
                  key={category}
                  type="button"
                  aria-pressed={browseCategory === category}
                  className={browseCategory === category ? "chip active" : "chip"}
                  onClick={() => setBrowseCategory(category)}
                >
                  {category === "ALL" ? "All" : category.replace(/_/g, " ").toLowerCase()}
                </button>
              ))}
            </div>
          )}

          <div className="pos-product-grid">
            {visibleItems.map(({ product, variant }) => {
              const qty = variant.stockQuantity;
              const low = variant.lowStockThreshold !== null && qty <= variant.lowStockThreshold;
              const stockClass = qty <= 0 ? "out" : low ? "low" : "ok";
              const name = [product.name, variant.size, variant.colour].filter(Boolean).join(" · ");
              return (
                <button type="button" key={variant.id} className="pos-product-card" onClick={() => addVariantToCart(product, variant)}>
                  <ProductThumb name={product.name} category={product.category} size={40} />
                  <span className="pos-product-name">{name}</span>
                  <span className="pos-product-price">{rupees(variant.priceMinor)}</span>
                  <span className={`pos-stock-badge ${stockClass}`}>
                    {qty <= 0 ? "Out of stock" : `${qty} in stock`}
                  </span>
                </button>
              );
            })}
            {visibleItems.length === 0 && (
              <p className="muted">{catalogue.length === 0 ? "No products yet. Add some under Products." : "No products match."}</p>
            )}
          </div>

          {heldBills.length > 0 && (
            <>
              <h2>Held bills</h2>
              <ul className="held-list">
                {heldBills.map((bill) => (
                  <li key={bill.id}>
                    <span>
                      {bill.itemCount} item{bill.itemCount > 1 ? "s" : ""} · {rupees(bill.totalMinor)}
                    </span>
                    <span className="held-actions">
                      <button type="button" onClick={() => resumeHeldBill(bill.id, bill.payload)}>
                        Resume
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="billing-cart">
          <h2>
            Current sale
            {itemCount > 0 && <span className="pos-cart-count">{itemCount}</span>}
          </h2>
          <ul className="cart-list">
            {cart.map((line, index) => {
              const afterDiscount = calculation?.lines[index]?.afterLineDiscountMinor ?? (line.unitPriceMinor as number) * line.quantity;
              return (
                <li key={line.lineId} className="cart-row">
                  <ProductThumb name={line.productName} category={null} size={32} />
                  <span className="cart-label">
                    {line.productName}
                    {line.variantLabel ? ` — ${line.variantLabel}` : ""}
                  </span>
                  <div className="cart-qty-stepper">
                    <button type="button" aria-label="Decrease quantity" onClick={() => updateQuantity(line.lineId, -1)}>
                      <Minus size={12} />
                    </button>
                    <span>{line.quantity}</span>
                    <button type="button" aria-label="Increase quantity" onClick={() => updateQuantity(line.lineId, 1)}>
                      <Plus size={12} />
                    </button>
                  </div>
                  <span className="muted">× {rupees(line.unitPriceMinor)}</span>
                  <input
                    inputMode="decimal"
                    placeholder="disc %"
                    value={line.lineDiscountPercentText}
                    onChange={(e) => setLineDiscount(line.lineId, e.target.value)}
                    aria-label="Discount %"
                    title="Discount %"
                  />
                  <span className="cart-line-total">{rupees(money(afterDiscount))}</span>
                  <button type="button" onClick={() => removeLine(line.lineId)} aria-label="Remove item" className="cart-remove-button">
                    <Trash2 size={14} />
                  </button>
                </li>
              );
            })}
            {cart.length === 0 && <li className="muted">Cart is empty — add items from the left.</li>}
          </ul>

          <div className="billing-form">
            <label>
              Customer (optional)
              <select id="billingCustomer" value={selectedCustomerId ?? ""} onChange={(e) => setSelectedCustomerId(e.target.value || null)}>
                <option value="">Walk-in</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Bill discount
              <span className="billing-discount">
                <select
                  id="billDiscountKind"
                  value={billDiscountKind}
                  onChange={(e) => setBillDiscountKind(e.target.value as typeof billDiscountKind)}
                >
                  <option value="NONE">None</option>
                  <option value="AMOUNT">₹ amount</option>
                  <option value="PERCENT">%</option>
                </select>
                {billDiscountKind !== "NONE" && (
                  <input
                    inputMode="decimal"
                    value={billDiscountValue}
                    onChange={(e) => setBillDiscountValue(e.target.value)}
                    aria-label="Bill discount value"
                  />
                )}
              </span>
            </label>
          </div>

          <div className="billing-totals">
            <span>Total: {rupees(money(grandTotalMinor))}</span>
          </div>

          {error && <p className="error">{error}</p>}

          <div className="billing-actions">
            <button type="button" className="checkout-button" onClick={openCheckout} disabled={submitting || cart.length === 0}>
              Proceed to Payment → <kbd>F4</kbd>
            </button>
            {cart.length > 0 && (
              <button type="button" onClick={() => setCart([])} disabled={submitting}>
                Clear
              </button>
            )}
          </div>
        </section>
      </div>

      <div className="pos-statusbar">
        <span>
          {now.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })} ·{" "}
          {now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
        </span>
        <span className={`pos-status-online ${online ? "online" : "offline"}`}>
          {online ? <Wifi size={13} /> : <WifiOff size={13} />}
          {online ? "Online" : "Offline"}
        </span>
        <span className="pos-statusbar-shortcuts">
          <strong>Shortcuts:</strong> <kbd>F2</kbd> Hold Bill <kbd>F4</kbd> Checkout <kbd>Ctrl+K</kbd> Focus Search
        </span>
      </div>

      {checkoutOpen && calculation && (
        <div className="checkout-modal-overlay" onClick={() => setCheckoutOpen(false)}>
          <div className="checkout-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="checkout-modal-header">
              <div className="checkout-steps">
                <span className={`checkout-step ${checkoutStep === "review" ? "active" : "done"}`}>1. Review</span>
                <span className={`checkout-step ${checkoutStep === "payment" ? "active" : ""}`}>2. Payment</span>
              </div>
              <button type="button" className="checkout-modal-close" onClick={() => setCheckoutOpen(false)} aria-label="Close">
                <X size={18} />
              </button>
            </div>

            {checkoutStep === "review" && (
              <div className="checkout-modal-body">
                <h3>Bill summary</h3>
                <ul className="checkout-bill-list">
                  {cart.map((line, index) => (
                    <li key={line.lineId}>
                      <ProductThumb name={line.productName} category={null} size={32} />
                      <span className="checkout-bill-name">
                        {line.productName}
                        {line.variantLabel ? ` — ${line.variantLabel}` : ""}
                      </span>
                      <span className="muted">
                        {line.quantity} × {rupees(line.unitPriceMinor)}
                      </span>
                      <span>{rupees(money(calculation.lines[index]?.afterLineDiscountMinor ?? 0))}</span>
                    </li>
                  ))}
                </ul>
                <div className="checkout-totals">
                  <div>
                    <span>Subtotal</span>
                    <span>{rupees(calculation.subtotalMinor)}</span>
                  </div>
                  {calculation.lineDiscountTotalMinor + calculation.billDiscountTotalMinor > 0 && (
                    <div>
                      <span>Discount</span>
                      <span>−{rupees(money(calculation.lineDiscountTotalMinor + calculation.billDiscountTotalMinor))}</span>
                    </div>
                  )}
                  {shop?.gstRegistered && (
                    <div>
                      <span>Tax</span>
                      <span>{rupees(money(calculation.cgstMinor + calculation.sgstMinor + calculation.igstMinor))}</span>
                    </div>
                  )}
                  {calculation.roundOffMinor !== 0 && (
                    <div>
                      <span>Round off</span>
                      <span>{rupees(calculation.roundOffMinor)}</span>
                    </div>
                  )}
                  <div className="checkout-total-grand">
                    <span>Total</span>
                    <span>{rupees(calculation.grandTotalMinor)}</span>
                  </div>
                </div>
                <button type="button" onClick={() => setCheckoutStep("payment")}>
                  Continue to Payment →
                </button>
              </div>
            )}

            {checkoutStep === "payment" && (
              <div className="checkout-modal-body">
                <h3>Select payment method</h3>
                <div className="payment-method-tiles">
                  {paymentOptions.map(({ method, label, Icon }) => (
                    <button
                      key={method}
                      type="button"
                      className={`payment-method-tile ${paymentMethod === method ? "selected" : ""}`}
                      onClick={() => setPaymentMethod(method)}
                    >
                      <Icon size={20} />
                      {label}
                    </button>
                  ))}
                </div>

                {paymentMethod === "CASH" && (
                  <>
                    <label>
                      Amount received
                      <input
                        inputMode="decimal"
                        value={tenderedText}
                        onChange={(e) => setTenderedText(e.target.value)}
                        placeholder={(grandTotalMinor / 100).toFixed(2)}
                      />
                    </label>
                    <div className="quick-amounts">
                      {quickAmounts(grandTotalMinor / 100).map((amt) => (
                        <button type="button" key={amt} onClick={() => setTenderedText(String(amt))}>
                          ₹{amt.toLocaleString("en-IN")}
                        </button>
                      ))}
                    </div>
                  </>
                )}

                {paymentMethod === "ACCOUNT" && (
                  <p className="muted">
                    {selectedCustomer
                      ? `Billed to ${selectedCustomer.name}'s account.`
                      : "Choose a customer above to bill this to their account."}
                  </p>
                )}

                <div className="checkout-totals">
                  <div>
                    <span>Total</span>
                    <span>{rupees(calculation.grandTotalMinor)}</span>
                  </div>
                  {paymentMethod === "CASH" && (
                    <div className="checkout-total-grand">
                      <span>{shortfallMinor < 0 ? "Change due" : "Balance due"}</span>
                      <span>{rupees(money(Math.abs(shortfallMinor)))}</span>
                    </div>
                  )}
                </div>

                {error && <p className="error">{error}</p>}

                <div className="checkout-modal-actions">
                  <button type="button" onClick={() => setCheckoutStep("review")} disabled={submitting}>
                    ← Back
                  </button>
                  <button type="button" onClick={() => void handleCompleteSale()} disabled={submitting}>
                    {submitting ? "Working…" : "Complete Sale (F4)"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

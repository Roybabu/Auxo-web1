import type { Money } from "../money";

/**
 * Shared shape for every stored entity. IDs are UUIDs (web-native), not the Android app's
 * integer row IDs — `androidId` carries the original integer ID when a row was imported from
 * an Android backup, so a repeated import of the same backup never creates duplicates (match on
 * androidId instead of re-inserting). Soft deletes and timestamps support a future server sync.
 */
export interface Entity {
  id: string;
  androidId: number | null;
  createdAt: number; // epoch millis
  updatedAt: number; // epoch millis
  deletedAt: number | null;
}

// ---------------------------------------------------------------------------
// Enums / unions (from Android's domain layer)
// ---------------------------------------------------------------------------

export type ShopCategoryType =
  | "GARMENT"
  | "FOOTWEAR"
  | "ACCESSORIES"
  | "PACKAGED_FOOD"
  | "BEVERAGE"
  | "GENERAL"
  | "ELECTRONICS"
  | "PHARMACY"
  | "COSMETICS"
  | "LOOSE"
  | "JEWELLERY"
  | "RESTAURANT";

/** UNIT: stock kept in whole units (scale 1). GRAM/MILLILITRE: stock kept in thousandths (scale 1000). */
export type StockUnit = "UNIT" | "GRAM" | "MILLILITRE";

export type GstRuleKind = "NONE" | "FIXED" | "APPAREL";
export interface GstRule {
  kind: GstRuleKind;
  /** basis points (10000 = 100%); only set when kind === "FIXED" */
  rateBp?: number;
}

export type StockMovementReason = "RECEIVED" | "RETURNED" | "SOLD" | "DAMAGED" | "CORRECTION";

export type PaymentMethod = "CASH" | "UPI" | "CARD" | "ACCOUNT";
export type PaymentKind = "PAYMENT" | "REFUND";

export type CustomerLedgerEntryType =
  | "SALE"
  | "PAYMENT"
  | "RETURN"
  | "OPENING_BALANCE"
  | "PROMISE"
  | "POINTS_EARNED"
  | "POINTS_REDEEMED"
  | "POINTS_REVERSED";

export type InvoiceType = "SALE" | "CREDIT_NOTE" | "QUOTATION";

export type PurchaseOrderStatus = "DRAFT" | "SENT" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CANCELLED";

export type QuotationStatus = "OPEN" | "CONVERTED" | "EXPIRED" | "CANCELLED";

export type StockCountStatus = "IN_PROGRESS" | "FINISHED" | "CANCELLED";

export type Role = "SUPER_ADMIN" | "EMPLOYEE";

/** See docs/backup-format.md / the extracted spec for the implication rules between these. */
export type Permission =
  | "SELL"
  | "VIEW_INVOICES"
  | "PROCESS_RETURN"
  | "CLOSE_DAY"
  | "VIEW_FINANCIALS"
  | "VIEW_REPORTS"
  | "GST_REPORT"
  | "MANAGE_LOYALTY"
  | "UNLIMITED_DISCOUNT"
  | "VIEW_DASHBOARD"
  | "MANAGE_PRODUCTS"
  | "ADJUST_STOCK"
  | "VIEW_STOCK_RECORDS"
  | "MANAGE_CUSTOMERS"
  | "RECEIVE_ACCOUNT_PAYMENT"
  | "MANAGE_SUPPLIERS"
  | "MANAGE_PURCHASES"
  | "RECEIVE_GOODS"
  | "MANAGE_SETTINGS"
  | "BACKUP_AND_RESTORE"
  | "MANAGE_USERS"
  | "VIEW_ACTIVITY_LOG";

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

export interface Product extends Entity {
  name: string;
  brand: string | null;
  category: ShopCategoryType;
  categoryId: string | null;
  subcategory: string | null;
  description: string | null;
  material: string | null;
  dietType: string | null;
  hsnCode: string | null;
  gstRule: GstRule;
  stockUnit: StockUnit;
  preferredSupplierId: string | null;
  photoFile: string | null;
  available: boolean;
  tracksStock: boolean;
  warrantyMonths: number | null;
  prescriptionRequired: boolean;
  /** Jewellery only: metal purity, e.g. "22K", "925 Silver" */
  metal: string | null;
  /** Jewellery only: making charge, basis points of metal value */
  makingChargeBp: number | null;
}

export interface ProductVariant extends Entity {
  productId: string;
  sku: string | null;
  barcode: string | null;
  size: string | null;
  colour: string | null;
  /** For GRAM/MILLILITRE stock units: net quantity per unit, in thousandths */
  netQuantityMilli: number | null;
  netQuantityUnit: StockUnit | null;
  priceMinor: Money;
  mrpMinor: Money | null;
  costMinor: Money | null;
  stockQuantity: number;
  lowStockThreshold: number | null;
  reorderQuantity: number | null;
  batchNumber: string | null;
  expiryEpochDay: number | null;
  photoFile: string | null;
}

export interface StockMovement extends Entity {
  variantId: string;
  quantityChange: number;
  reason: StockMovementReason;
  note: string | null;
  invoiceId: string | null;
  batchId: string | null;
  receiptId: string | null;
}

export interface StockBatch extends Entity {
  variantId: string;
  batchNumber: string | null;
  expiryEpochDay: number | null;
  quantity: number;
  receivedAt: number;
  unitCostMinor: Money | null;
}

export interface ShopCategory extends Entity {
  name: string;
  profile: ShopCategoryType;
  enabled: boolean;
  sortOrder: number;
  builtIn: boolean;
}

export interface ShopSubcategory extends Entity {
  categoryId: string;
  name: string;
  sortOrder: number;
}

// ---------------------------------------------------------------------------
// Billing / invoices
// ---------------------------------------------------------------------------

export interface Invoice extends Entity {
  number: string;
  type: InvoiceType;
  customerId: string | null;
  sellerName: string | null;
  sellerAddress: string | null;
  sellerPhone: string | null;
  sellerGstin: string | null;
  sellerStateCode: string | null;
  sellerFssai: string | null;
  buyerName: string | null;
  buyerPhone: string | null;
  buyerGstin: string | null;
  placeOfSupply: string | null;
  gstRegistered: boolean;
  pricesIncludeTax: boolean;
  interState: boolean;
  subtotalMinor: Money;
  discountMinor: Money;
  discountReason: string | null;
  taxableMinor: Money;
  cgstMinor: Money;
  sgstMinor: Money;
  igstMinor: Money;
  roundOffMinor: Money;
  roundedToRupee: boolean;
  grandTotalMinor: Money;
  savingsMinor: Money;
  originalInvoiceId: string | null;
  originalInvoiceNumber: string | null;
  note: string | null;
}

export interface InvoiceLine extends Entity {
  invoiceId: string;
  variantId: string | null;
  menuItemId: string | null;
  productName: string;
  variantLabel: string | null;
  barcode: string | null;
  hsnCode: string | null;
  stockUnit: StockUnit;
  quantity: number;
  unitPriceMinor: Money;
  mrpMinor: Money | null;
  discountMinor: Money;
  discountReason: string | null;
  taxableMinor: Money;
  gstRateBp: number;
  cgstMinor: Money;
  sgstMinor: Money;
  igstMinor: Money;
  totalMinor: Money;
  returnedQuantity: number;
  originalLineId: string | null;
}

export interface Payment extends Entity {
  invoiceId: string;
  method: PaymentMethod;
  kind: PaymentKind;
  amountMinor: Money;
  reference: string | null;
  tenderedMinor: Money | null;
  changeMinor: Money | null;
}

export interface HeldBill extends Entity {
  label: string | null;
  itemCount: number;
  totalMinor: Money;
  /** Serialized cart contents; opaque to storage, interpreted by the billing module. */
  payload: string;
  tableNumber: string | null;
  tokenNumber: string | null;
}

export interface Quotation extends Entity {
  number: string;
  validUntilEpochDay: number | null;
  customerName: string | null;
  customerPhone: string | null;
  itemCount: number;
  totalMinor: Money;
  payload: string;
  status: QuotationStatus;
  convertedInvoiceId: string | null;
}

export interface NumberSequence {
  /** e.g. "INV|2025" (prefix|financialYearStart) */
  name: string;
  nextValue: number;
}

export interface AppliedRequest {
  requestId: string;
  kind: string;
  resultId: string | null;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Customers / loyalty
// ---------------------------------------------------------------------------

export interface Customer extends Entity {
  name: string;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  stateCode: string | null;
  address: string | null;
  creditLimitMinor: Money | null;
  notes: string | null;
}

export interface CustomerLedgerEntry extends Entity {
  customerId: string;
  type: CustomerLedgerEntryType;
  amountMinor: Money;
  invoiceId: string | null;
  method: PaymentMethod | null;
  reference: string | null;
  note: string | null;
  points: number | null;
}

export interface LoyaltySettings {
  enabled: boolean;
  spendPerPointMinor: Money;
  pointValueMinor: Money;
  /** Extra points awarded when a customer clears their full balance within ON_TIME_DAYS (30). 0 = off. */
  onTimeBonusPoints: number;
}

export const LOYALTY_ON_TIME_DAYS = 30;
export const LOYALTY_MIN_LEFT_TO_PAY_MINOR = 100 as Money; // ₹1, in minor units

// ---------------------------------------------------------------------------
// Purchasing (optional)
// ---------------------------------------------------------------------------

export interface Supplier extends Entity {
  name: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  gstin: string | null;
  stateCode: string | null;
  address: string | null;
  notes: string | null;
  active: boolean;
}

export interface PurchaseOrder extends Entity {
  supplierId: string;
  number: string;
  status: PurchaseOrderStatus;
  expectedEpochDay: number | null;
  note: string | null;
}

export interface PurchaseOrderLine extends Entity {
  orderId: string;
  variantId: string | null;
  productName: string;
  variantLabel: string | null;
  stockUnit: StockUnit;
  quantityOrdered: number;
  quantityReceived: number;
  unitCostMinor: Money;
}

export interface PurchaseReceipt extends Entity {
  supplierId: string;
  orderId: string | null;
  number: string;
  supplierInvoiceNumber: string | null;
  receivedAt: number;
  note: string | null;
  totalMinor: Money;
}

export interface PurchaseReceiptLine extends Entity {
  receiptId: string;
  orderLineId: string | null;
  variantId: string | null;
  productName: string;
  variantLabel: string | null;
  stockUnit: StockUnit;
  quantity: number;
  unitCostMinor: Money;
  batchNumber: string | null;
  expiryEpochDay: number | null;
  batchId: string | null;
}

// ---------------------------------------------------------------------------
// Shop / operations
// ---------------------------------------------------------------------------

export interface StoreSettings {
  storeName: string;
  address: string | null;
  phone: string | null;
  gstin: string | null;
  stateCode: string | null;
  gstRegistered: boolean;
  pricesIncludeTax: boolean;
  roundOff: boolean;
  invoicePrefix: string;
  creditNotePrefix: string;
  upiId: string | null;
  upiPayeeName: string | null;
  receiptPaperWidthMm: 58 | 76 | 80;
  receiptFooter: string | null;
  receiptShowHsn: boolean;
  receiptShowTaxBreakup: boolean;
  receiptShowSavings: boolean;
  receiptShowCustomer: boolean;
  receiptShowBarcode: boolean;
  receiptLanguage: "en" | "hi" | "bn";
  receiptShowUpiQr: boolean;
  /** 0, 500, 1000, 1500, 2000, 2500, 5000 or 10000 basis points (0 = employees cannot discount) */
  employeeDiscountLimitBp: number;
  expiryWarningDays: number;
  fssai: string | null;
  creditHoldDays: number;
}

export interface DayClosing extends Entity {
  businessDateEpochDay: number;
  bills: number;
  returns: number;
  netSalesMinor: Money;
  cashReceivedMinor: Money;
  cashRefundedMinor: Money;
  cashFromAccountsMinor: Money;
  upiNetMinor: Money;
  cardNetMinor: Money;
  onAccountNetMinor: Money;
  countedCashMinor: Money | null;
  note: string | null;
  closedAt: number;
  closedBy: string;
}

export interface StockCount extends Entity {
  startedAt: number;
  status: StockCountStatus;
  payload: string;
  finishedAt: number | null;
  reason: string | null;
  adjustedCount: number | null;
}

export interface AuditLogEntry {
  id: string;
  createdAt: number;
  actorId: string | null;
  actorName: string;
  actorRole: Role;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
}

// ---------------------------------------------------------------------------
// Users / sign-in (local-only: no accounts, no server — see domain/auth.ts)
// ---------------------------------------------------------------------------

export interface User extends Entity {
  name: string;
  role: Role;
  /** Only meaningful for EMPLOYEE; a SUPER_ADMIN always has every permission. */
  grantedPermissions: Permission[];
  pinHash: string;
  pinSalt: string;
  /** Hashes of unused one-time recovery codes; each is removed once redeemed. */
  recoveryCodeHashes: string[];
  active: boolean;
  lastSignedInAt: number | null;
}

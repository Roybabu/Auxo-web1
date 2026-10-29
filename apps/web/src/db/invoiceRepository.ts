import {
  applyStockAdjustment,
  financialYearStart,
  formatInvoiceNumber,
  invoiceSequenceKey,
  type BillCalculationResult,
  type Money,
  type PaymentKind,
  type PaymentMethod,
  type SqlDatabase,
  type StockUnit,
} from "@auxo/core";
import { NumberSequenceRepository } from "./numberSequenceRepository";
import { ProductVariantRepository } from "./productRepository";

export interface SaleLineMeta {
  lineId: string;
  variantId: string | null; // null for a custom (one-off) item
  productName: string;
  variantLabel: string | null;
  stockUnit: StockUnit;
  quantity: number;
  unitPriceMinor: Money;
}

export interface SalePaymentInput {
  method: PaymentMethod;
  kind: PaymentKind;
  amountMinor: Money;
  reference: string | null;
  tenderedMinor: Money | null;
  changeMinor: Money | null;
}

export interface CompleteSaleInput {
  invoicePrefix: string;
  customerId: string | null;
  gstRegistered: boolean;
  pricesIncludeTax: boolean;
  interState: boolean;
  discountReason: string | null;
  note: string | null;
  lines: SaleLineMeta[];
  calculation: BillCalculationResult;
  payments: SalePaymentInput[];
}

export interface CompletedSale {
  invoiceId: string;
  number: string;
}

function newId(): string {
  return crypto.randomUUID();
}

export class InvoiceRepository {
  constructor(private readonly db: SqlDatabase) {}

  async completeSale(input: CompleteSaleInput): Promise<CompletedSale> {
    return this.db.transaction(async (tx) => {
      const now = Date.now();
      const seqRepo = new NumberSequenceRepository(tx);
      const fyStart = financialYearStart(new Date(now));
      const seqKey = invoiceSequenceKey(input.invoicePrefix, fyStart);
      const sequence = await seqRepo.nextValue(seqKey);
      const number = formatInvoiceNumber(input.invoicePrefix, fyStart, sequence);

      const invoiceId = newId();
      const calc = input.calculation;

      await tx.exec(
        `INSERT INTO invoices
          (id, android_id, number, type, customer_id, gst_registered, prices_include_tax,
           inter_state, subtotal_minor, discount_minor, discount_reason, taxable_minor,
           cgst_minor, sgst_minor, igst_minor, round_off_minor, grand_total_minor, savings_minor,
           note, created_at, updated_at, deleted_at)
         VALUES (?, NULL, ?, 'SALE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        [
          invoiceId,
          number,
          input.customerId,
          input.gstRegistered ? 1 : 0,
          input.pricesIncludeTax ? 1 : 0,
          input.interState ? 1 : 0,
          calc.subtotalMinor,
          calc.billDiscountTotalMinor + calc.lineDiscountTotalMinor,
          input.discountReason,
          calc.taxableMinor,
          calc.cgstMinor,
          calc.sgstMinor,
          calc.igstMinor,
          calc.roundOffMinor,
          calc.grandTotalMinor,
          calc.savingsMinor,
          input.note,
          now,
          now,
        ],
      );

      const variantRepo = new ProductVariantRepository(tx);

      for (const meta of input.lines) {
        const lineResult = calc.lines.find((l) => l.lineId === meta.lineId);
        if (!lineResult) throw new Error(`No calculated result for line ${meta.lineId}`);

        await tx.exec(
          `INSERT INTO invoice_lines
            (id, android_id, invoice_id, variant_id, product_name, variant_label, stock_unit,
             quantity, unit_price_minor, discount_minor, taxable_minor, gst_rate_bp, cgst_minor,
             sgst_minor, igst_minor, total_minor, created_at, updated_at, deleted_at)
           VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
          [
            newId(),
            invoiceId,
            meta.variantId,
            meta.productName,
            meta.variantLabel,
            meta.stockUnit,
            meta.quantity,
            meta.unitPriceMinor,
            (meta.unitPriceMinor as number) * meta.quantity - (lineResult.netMinor as number),
            lineResult.taxableMinor,
            lineResult.gstRateBp,
            lineResult.cgstMinor,
            lineResult.sgstMinor,
            lineResult.igstMinor,
            lineResult.totalMinor,
            now,
            now,
          ],
        );

        if (meta.variantId) {
          const variant = await variantRepo.findById(meta.variantId);
          if (variant) {
            const { newQuantity, movementQuantityChange } = applyStockAdjustment(
              variant.stockQuantity,
              "SOLD",
              meta.quantity,
            );
            await tx.exec(
              `INSERT INTO stock_movements
                (id, android_id, variant_id, quantity_change, reason, note, invoice_id, batch_id,
                 receipt_id, created_at, updated_at, deleted_at)
               VALUES (?, NULL, ?, ?, 'SOLD', NULL, ?, NULL, NULL, ?, ?, NULL)`,
              [newId(), meta.variantId, movementQuantityChange, invoiceId, now, now],
            );
            await variantRepo.updateStockQuantity(meta.variantId, newQuantity, now);
          }
        }
      }

      for (const payment of input.payments) {
        await tx.exec(
          `INSERT INTO payments
            (id, android_id, invoice_id, method, kind, amount_minor, reference, tendered_minor,
             change_minor, created_at, updated_at, deleted_at)
           VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
          [
            newId(),
            invoiceId,
            payment.method,
            payment.kind,
            payment.amountMinor,
            payment.reference,
            payment.tenderedMinor,
            payment.changeMinor,
            now,
            now,
          ],
        );
      }

      return { invoiceId, number };
    });
  }
}

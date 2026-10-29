import { computeLedgerAging, type PeriodRange, type SqlDatabase } from "@auxo/core";
import { CustomerLedgerRepository, CustomerRepository } from "./customerRepository";

export interface SalesSummary {
  bills: number;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  grandTotalMinor: number;
}

export interface ItemSalesRow {
  productName: string;
  quantity: number;
  revenueMinor: number;
}

export interface CollectionsRow {
  method: string;
  amountMinor: number;
}

export interface GstRateRow {
  gstRateBp: number;
  taxableMinor: number;
  cgstMinor: number;
  sgstMinor: number;
  igstMinor: number;
}

export interface HsnSummaryRow {
  hsnCode: string;
  taxableMinor: number;
  taxMinor: number;
}

export interface StockMovementRow {
  createdAt: number;
  productName: string;
  reason: string;
  quantityChange: number;
  note: string | null;
}

export interface StockValueRow {
  productName: string;
  variantLabel: string | null;
  quantity: number;
  costMinor: number;
  valueMinor: number;
}

export interface LowStockRow {
  productName: string;
  variantLabel: string | null;
  quantity: number;
  threshold: number;
}

export interface ExpiryRow {
  productName: string;
  variantLabel: string | null;
  expiryEpochDay: number;
  quantity: number;
}

export interface CustomerBalanceRow {
  name: string;
  balanceMinor: number;
}

export interface CustomerAgingRow extends CustomerBalanceRow {
  upTo7DaysMinor: number;
  upTo30DaysMinor: number;
  over30DaysMinor: number;
}

export class ReportRepository {
  constructor(private readonly db: SqlDatabase) {}

  async salesSummary(range: PeriodRange): Promise<SalesSummary> {
    const rows = await this.db.query<{
      bills: number;
      subtotal: number | null;
      discount: number | null;
      tax: number | null;
      total: number | null;
    }>(
      `SELECT COUNT(*) as bills,
              SUM(subtotal_minor) as subtotal,
              SUM(discount_minor) as discount,
              SUM(cgst_minor + sgst_minor + igst_minor) as tax,
              SUM(grand_total_minor) as total
       FROM invoices
       WHERE type = 'SALE' AND deleted_at IS NULL AND created_at >= ? AND created_at < ?`,
      [range.startMillis, range.endMillis],
    );
    const row = rows[0];
    return {
      bills: row?.bills ?? 0,
      subtotalMinor: row?.subtotal ?? 0,
      discountMinor: row?.discount ?? 0,
      taxMinor: row?.tax ?? 0,
      grandTotalMinor: row?.total ?? 0,
    };
  }

  async itemSales(range: PeriodRange): Promise<ItemSalesRow[]> {
    const rows = await this.db.query<{ product_name: string; quantity: number; revenue: number }>(
      `SELECT il.product_name as product_name, SUM(il.quantity) as quantity, SUM(il.total_minor) as revenue
       FROM invoice_lines il
       JOIN invoices i ON i.id = il.invoice_id
       WHERE i.type = 'SALE' AND i.deleted_at IS NULL AND i.created_at >= ? AND i.created_at < ?
       GROUP BY il.product_name
       ORDER BY revenue DESC`,
      [range.startMillis, range.endMillis],
    );
    return rows.map((r) => ({ productName: r.product_name, quantity: r.quantity, revenueMinor: r.revenue }));
  }

  async collections(range: PeriodRange): Promise<CollectionsRow[]> {
    const rows = await this.db.query<{ method: string; amount: number }>(
      `SELECT p.method as method, SUM(p.amount_minor) as amount
       FROM payments p
       JOIN invoices i ON i.id = p.invoice_id
       WHERE p.kind = 'PAYMENT' AND i.deleted_at IS NULL AND p.created_at >= ? AND p.created_at < ?
       GROUP BY p.method
       ORDER BY amount DESC`,
      [range.startMillis, range.endMillis],
    );
    return rows.map((r) => ({ method: r.method, amountMinor: r.amount }));
  }

  async gstRates(range: PeriodRange): Promise<GstRateRow[]> {
    const rows = await this.db.query<{
      gst_rate_bp: number;
      taxable: number;
      cgst: number;
      sgst: number;
      igst: number;
    }>(
      `SELECT il.gst_rate_bp as gst_rate_bp, SUM(il.taxable_minor) as taxable,
              SUM(il.cgst_minor) as cgst, SUM(il.sgst_minor) as sgst, SUM(il.igst_minor) as igst
       FROM invoice_lines il
       JOIN invoices i ON i.id = il.invoice_id
       WHERE i.type = 'SALE' AND i.deleted_at IS NULL AND i.created_at >= ? AND i.created_at < ?
       GROUP BY il.gst_rate_bp
       ORDER BY il.gst_rate_bp`,
      [range.startMillis, range.endMillis],
    );
    return rows.map((r) => ({
      gstRateBp: r.gst_rate_bp,
      taxableMinor: r.taxable,
      cgstMinor: r.cgst,
      sgstMinor: r.sgst,
      igstMinor: r.igst,
    }));
  }

  async hsnSummary(range: PeriodRange): Promise<HsnSummaryRow[]> {
    const rows = await this.db.query<{ hsn_code: string | null; taxable: number; tax: number }>(
      `SELECT p.hsn_code as hsn_code, SUM(il.taxable_minor) as taxable,
              SUM(il.cgst_minor + il.sgst_minor + il.igst_minor) as tax
       FROM invoice_lines il
       JOIN invoices i ON i.id = il.invoice_id
       LEFT JOIN product_variants pv ON pv.id = il.variant_id
       LEFT JOIN products p ON p.id = pv.product_id
       WHERE i.type = 'SALE' AND i.deleted_at IS NULL AND i.created_at >= ? AND i.created_at < ?
       GROUP BY p.hsn_code
       ORDER BY tax DESC`,
      [range.startMillis, range.endMillis],
    );
    return rows.map((r) => ({ hsnCode: r.hsn_code ?? "(none)", taxableMinor: r.taxable, taxMinor: r.tax }));
  }

  async stockMovements(range: PeriodRange, reason?: string): Promise<StockMovementRow[]> {
    const params: unknown[] = [range.startMillis, range.endMillis];
    let sql = `SELECT sm.created_at as created_at, p.name as product_name, sm.reason as reason,
                      sm.quantity_change as quantity_change, sm.note as note
               FROM stock_movements sm
               JOIN product_variants pv ON pv.id = sm.variant_id
               JOIN products p ON p.id = pv.product_id
               WHERE sm.deleted_at IS NULL AND sm.created_at >= ? AND sm.created_at < ?`;
    if (reason) {
      sql += " AND sm.reason = ?";
      params.push(reason);
    }
    sql += " ORDER BY sm.created_at DESC";
    const rows = await this.db.query<{
      created_at: number;
      product_name: string;
      reason: string;
      quantity_change: number;
      note: string | null;
    }>(sql, params as never[]);
    return rows.map((r) => ({
      createdAt: r.created_at,
      productName: r.product_name,
      reason: r.reason,
      quantityChange: r.quantity_change,
      note: r.note,
    }));
  }

  async stockValue(): Promise<StockValueRow[]> {
    const rows = await this.db.query<{
      product_name: string;
      size: string | null;
      colour: string | null;
      quantity: number;
      cost: number | null;
    }>(
      `SELECT p.name as product_name, pv.size as size, pv.colour as colour,
              pv.stock_quantity as quantity, COALESCE(pv.cost_minor, pv.price_minor) as cost
       FROM product_variants pv
       JOIN products p ON p.id = pv.product_id
       WHERE pv.deleted_at IS NULL AND pv.stock_quantity > 0
       ORDER BY p.name`,
    );
    return rows.map((r) => ({
      productName: r.product_name,
      variantLabel: [r.size, r.colour].filter(Boolean).join(" / ") || null,
      quantity: r.quantity,
      costMinor: r.cost ?? 0,
      valueMinor: (r.cost ?? 0) * r.quantity,
    }));
  }

  async lowStock(): Promise<LowStockRow[]> {
    const rows = await this.db.query<{
      product_name: string;
      size: string | null;
      colour: string | null;
      quantity: number;
      threshold: number;
    }>(
      `SELECT p.name as product_name, pv.size as size, pv.colour as colour,
              pv.stock_quantity as quantity, pv.low_stock_threshold as threshold
       FROM product_variants pv
       JOIN products p ON p.id = pv.product_id
       WHERE pv.deleted_at IS NULL AND pv.low_stock_threshold IS NOT NULL
             AND pv.stock_quantity <= pv.low_stock_threshold
       ORDER BY pv.stock_quantity ASC`,
    );
    return rows.map((r) => ({
      productName: r.product_name,
      variantLabel: [r.size, r.colour].filter(Boolean).join(" / ") || null,
      quantity: r.quantity,
      threshold: r.threshold,
    }));
  }

  async expiringWithin(days: number, nowEpochDay: number): Promise<ExpiryRow[]> {
    const rows = await this.db.query<{
      product_name: string;
      size: string | null;
      colour: string | null;
      expiry_epoch_day: number;
      quantity: number;
    }>(
      `SELECT p.name as product_name, pv.size as size, pv.colour as colour,
              pv.expiry_epoch_day as expiry_epoch_day, pv.stock_quantity as quantity
       FROM product_variants pv
       JOIN products p ON p.id = pv.product_id
       WHERE pv.deleted_at IS NULL AND pv.expiry_epoch_day IS NOT NULL
             AND pv.expiry_epoch_day <= ? AND pv.stock_quantity > 0
       ORDER BY pv.expiry_epoch_day ASC`,
      [nowEpochDay + days],
    );
    return rows.map((r) => ({
      productName: r.product_name,
      variantLabel: [r.size, r.colour].filter(Boolean).join(" / ") || null,
      expiryEpochDay: r.expiry_epoch_day,
      quantity: r.quantity,
    }));
  }

  async customerBalances(nowMillis: number = Date.now()): Promise<CustomerBalanceRow[]> {
    const customers = await new CustomerRepository(this.db).listActive();
    const ledgerRepo = new CustomerLedgerRepository(this.db);
    const results: CustomerBalanceRow[] = [];
    for (const customer of customers) {
      const entries = await ledgerRepo.listForCustomer(customer.id);
      const aging = computeLedgerAging(entries, nowMillis);
      if (aging.balanceMinor > 0) {
        results.push({ name: customer.name, balanceMinor: aging.balanceMinor });
      }
    }
    return results.sort((a, b) => b.balanceMinor - a.balanceMinor);
  }

  async customerAging(nowMillis: number = Date.now()): Promise<CustomerAgingRow[]> {
    const customers = await new CustomerRepository(this.db).listActive();
    const ledgerRepo = new CustomerLedgerRepository(this.db);
    const results: CustomerAgingRow[] = [];
    for (const customer of customers) {
      const entries = await ledgerRepo.listForCustomer(customer.id);
      const aging = computeLedgerAging(entries, nowMillis);
      if (aging.balanceMinor > 0) {
        results.push({
          name: customer.name,
          balanceMinor: aging.balanceMinor,
          upTo7DaysMinor: aging.buckets.upTo7DaysMinor,
          upTo30DaysMinor: aging.buckets.upTo30DaysMinor,
          over30DaysMinor: aging.buckets.over30DaysMinor,
        });
      }
    }
    return results.sort((a, b) => b.balanceMinor - a.balanceMinor);
  }
}

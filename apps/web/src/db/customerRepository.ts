import {
  computeLedgerAging,
  type Customer,
  type CustomerLedgerEntry,
  type CustomerLedgerEntryType,
  type Money,
  type PaymentMethod,
  type SqlDatabase,
  type SqlRow,
} from "@auxo/core";

function rowToCustomer(row: SqlRow): Customer {
  return {
    id: row.id as string,
    androidId: (row.android_id as number | null) ?? null,
    name: row.name as string,
    phone: (row.phone as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    gstin: (row.gstin as string | null) ?? null,
    stateCode: (row.state_code as string | null) ?? null,
    address: (row.address as string | null) ?? null,
    creditLimitMinor: (row.credit_limit_minor as unknown as Money | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
    deletedAt: (row.deleted_at as number | null) ?? null,
  };
}

function rowToLedgerEntry(row: SqlRow): CustomerLedgerEntry {
  return {
    id: row.id as string,
    androidId: (row.android_id as number | null) ?? null,
    customerId: row.customer_id as string,
    type: row.type as CustomerLedgerEntryType,
    amountMinor: row.amount_minor as unknown as Money,
    invoiceId: (row.invoice_id as string | null) ?? null,
    method: (row.method as PaymentMethod | null) ?? null,
    reference: (row.reference as string | null) ?? null,
    note: (row.note as string | null) ?? null,
    points: (row.points as number | null) ?? null,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
    deletedAt: (row.deleted_at as number | null) ?? null,
  };
}

export class CustomerRepository {
  constructor(private readonly db: SqlDatabase) {}

  async create(customer: Customer): Promise<void> {
    await this.db.exec(
      `INSERT INTO customers
        (id, android_id, name, phone, email, gstin, state_code, address, credit_limit_minor,
         notes, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        customer.id,
        customer.androidId,
        customer.name,
        customer.phone,
        customer.email,
        customer.gstin,
        customer.stateCode,
        customer.address,
        customer.creditLimitMinor,
        customer.notes,
        customer.createdAt,
        customer.updatedAt,
        customer.deletedAt,
      ],
    );
  }

  async listActive(): Promise<Customer[]> {
    const rows = await this.db.query("SELECT * FROM customers WHERE deleted_at IS NULL ORDER BY name");
    return rows.map(rowToCustomer);
  }

  async findById(id: string): Promise<Customer | null> {
    const rows = await this.db.query("SELECT * FROM customers WHERE id = ?", [id]);
    return rows[0] ? rowToCustomer(rows[0]) : null;
  }
}

export class CustomerLedgerRepository {
  constructor(private readonly db: SqlDatabase) {}

  async listForCustomer(customerId: string): Promise<CustomerLedgerEntry[]> {
    const rows = await this.db.query(
      "SELECT * FROM customer_ledger WHERE customer_id = ? AND deleted_at IS NULL ORDER BY created_at",
      [customerId],
    );
    return rows.map(rowToLedgerEntry);
  }

  async add(entry: CustomerLedgerEntry): Promise<void> {
    await this.db.exec(
      `INSERT INTO customer_ledger
        (id, android_id, customer_id, type, amount_minor, invoice_id, method, reference, note,
         points, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.id,
        entry.androidId,
        entry.customerId,
        entry.type,
        entry.amountMinor,
        entry.invoiceId,
        entry.method,
        entry.reference,
        entry.note,
        entry.points,
        entry.createdAt,
        entry.updatedAt,
        entry.deletedAt,
      ],
    );
  }

  /** Current balance + aging, computed fresh from the ledger (FIFO settlement). */
  async aging(customerId: string, nowMillis: number = Date.now()) {
    const entries = await this.listForCustomer(customerId);
    return computeLedgerAging(entries, nowMillis);
  }
}

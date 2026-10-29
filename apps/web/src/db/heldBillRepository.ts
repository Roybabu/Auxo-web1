import type { HeldBill, Money, SqlDatabase, SqlRow } from "@auxo/core";

function rowToHeldBill(row: SqlRow): HeldBill {
  return {
    id: row.id as string,
    androidId: (row.android_id as number | null) ?? null,
    label: (row.label as string | null) ?? null,
    itemCount: row.item_count as number,
    totalMinor: row.total_minor as unknown as Money,
    payload: row.payload as string,
    tableNumber: (row.table_number as string | null) ?? null,
    tokenNumber: (row.token_number as string | null) ?? null,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
    deletedAt: (row.deleted_at as number | null) ?? null,
  };
}

export class HeldBillRepository {
  constructor(private readonly db: SqlDatabase) {}

  async park(bill: HeldBill): Promise<void> {
    await this.db.exec(
      `INSERT INTO held_bills
        (id, android_id, label, item_count, total_minor, payload, table_number, token_number,
         created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        bill.id,
        bill.androidId,
        bill.label,
        bill.itemCount,
        bill.totalMinor,
        bill.payload,
        bill.tableNumber,
        bill.tokenNumber,
        bill.createdAt,
        bill.updatedAt,
        bill.deletedAt,
      ],
    );
  }

  async listActive(): Promise<HeldBill[]> {
    const rows = await this.db.query(
      "SELECT * FROM held_bills WHERE deleted_at IS NULL ORDER BY created_at DESC",
    );
    return rows.map(rowToHeldBill);
  }

  async remove(id: string): Promise<void> {
    await this.db.exec("UPDATE held_bills SET deleted_at = ? WHERE id = ?", [Date.now(), id]);
  }
}

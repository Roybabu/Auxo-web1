import type { SqlDatabase } from "@auxo/core";

/** Atomically allocates the next value for a (prefix, financial-year) counter. */
export class NumberSequenceRepository {
  constructor(private readonly db: SqlDatabase) {}

  async nextValue(key: string): Promise<number> {
    const existing = await this.db.query<{ next_value: number }>(
      "SELECT next_value FROM number_sequences WHERE name = ?",
      [key],
    );
    const next = (existing[0]?.next_value as number | undefined) ?? 1;
    await this.db.exec(
      `INSERT INTO number_sequences (name, next_value) VALUES (?, ?)
       ON CONFLICT(name) DO UPDATE SET next_value = excluded.next_value`,
      [key, next + 1],
    );
    return next;
  }
}

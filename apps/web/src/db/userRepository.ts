import type { Permission, Role, SqlDatabase, SqlRow, User } from "@auxo/core";

function rowToUser(row: SqlRow): User {
  return {
    id: row.id as string,
    androidId: (row.android_id as number | null) ?? null,
    name: row.name as string,
    role: row.role as Role,
    grantedPermissions: JSON.parse(row.granted_permissions as string) as Permission[],
    pinHash: row.pin_hash as string,
    pinSalt: row.pin_salt as string,
    recoveryCodeHashes: JSON.parse(row.recovery_code_hashes as string) as string[],
    active: Boolean(row.active),
    lastSignedInAt: (row.last_signed_in_at as number | null) ?? null,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
    deletedAt: (row.deleted_at as number | null) ?? null,
  };
}

export class UserRepository {
  constructor(private readonly db: SqlDatabase) {}

  async create(user: User): Promise<void> {
    await this.db.exec(
      `INSERT INTO users
        (id, android_id, name, role, granted_permissions, pin_hash, pin_salt,
         recovery_code_hashes, active, last_signed_in_at, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        user.id,
        user.androidId,
        user.name,
        user.role,
        JSON.stringify(user.grantedPermissions),
        user.pinHash,
        user.pinSalt,
        JSON.stringify(user.recoveryCodeHashes),
        user.active ? 1 : 0,
        user.lastSignedInAt,
        user.createdAt,
        user.updatedAt,
        user.deletedAt,
      ],
    );
  }

  async update(user: User): Promise<void> {
    await this.db.exec(
      `UPDATE users SET
        name = ?, role = ?, granted_permissions = ?, pin_hash = ?, pin_salt = ?,
        recovery_code_hashes = ?, active = ?, last_signed_in_at = ?, updated_at = ?
       WHERE id = ?`,
      [
        user.name,
        user.role,
        JSON.stringify(user.grantedPermissions),
        user.pinHash,
        user.pinSalt,
        JSON.stringify(user.recoveryCodeHashes),
        user.active ? 1 : 0,
        user.lastSignedInAt,
        user.updatedAt,
        user.id,
      ],
    );
  }

  async listActive(): Promise<User[]> {
    const rows = await this.db.query("SELECT * FROM users WHERE active = 1 AND deleted_at IS NULL ORDER BY created_at");
    return rows.map(rowToUser);
  }

  async findById(id: string): Promise<User | null> {
    const rows = await this.db.query("SELECT * FROM users WHERE id = ?", [id]);
    return rows[0] ? rowToUser(rows[0]) : null;
  }

  async hasAnySuperAdmin(): Promise<boolean> {
    const rows = await this.db.query<{ count: number }>(
      "SELECT COUNT(*) as count FROM users WHERE role = 'SUPER_ADMIN' AND deleted_at IS NULL",
    );
    return (rows[0]?.count ?? 0) > 0;
  }
}

import { asRollbackJournalDatabase, type SqlDatabase, type SqlDatabaseFactory, type SqlRow, type SqlValue } from "@auxo/core";

/**
 * Main-thread client for the OPFS SQLite worker (see `opfsWorker.ts` for why this has to run in
 * a worker at all). Talks to it over a small request/response RPC keyed by an incrementing id.
 */

type PendingResolvers = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

class OpfsWorkerClient {
  private readonly worker: Worker;
  private nextId = 1;
  private readonly pending = new Map<number, PendingResolvers>();

  constructor() {
    this.worker = new Worker(new URL("./opfsWorker.ts", import.meta.url), { type: "module" });
    this.worker.addEventListener("message", (event: MessageEvent) => {
      const response = event.data as { id: number; ok: boolean; result?: unknown; error?: string };
      const pending = this.pending.get(response.id);
      if (!pending) return;
      this.pending.delete(response.id);
      if (response.ok) {
        pending.resolve(response.result);
      } else {
        pending.reject(new Error(response.error ?? "Unknown OPFS worker error"));
      }
    });
  }

  call(message: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...message, id });
    });
  }
}

async function requestPersistentStorage(): Promise<void> {
  try {
    if (navigator.storage?.persist) {
      await navigator.storage.persist();
    }
  } catch {
    // Best-effort only; the app still works without a persistence guarantee.
  }
}

class OpfsSqlDatabase implements SqlDatabase {
  constructor(
    private readonly client: OpfsWorkerClient,
    private readonly handle: number,
  ) {}

  async exec(sql: string, params?: SqlValue[]): Promise<void> {
    await this.client.call({ type: "exec", handle: this.handle, sql, params });
  }

  async query<T extends SqlRow = SqlRow>(sql: string, params?: SqlValue[]): Promise<T[]> {
    const rows = await this.client.call({ type: "query", handle: this.handle, sql, params });
    return rows as T[];
  }

  async transaction<T>(fn: (db: SqlDatabase) => Promise<T>): Promise<T> {
    await this.exec("BEGIN");
    try {
      const result = await fn(this);
      await this.exec("COMMIT");
      return result;
    } catch (error) {
      await this.exec("ROLLBACK");
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.client.call({ type: "close", handle: this.handle });
  }
}

// The "opfs-sahpool" VFS holds exclusive access handles for as long as its worker is alive, so
// only one worker may hold them at a time. A tab therefore gets exactly one shared worker for
// the whole session; opening a "second" database from the same tab reuses it rather than
// spawning a competing worker (which would otherwise fail with "Access Handles cannot be
// created..."). A fresh worker only ever appears after a real page reload, which tears the old
// one down first.
let sharedClient: OpfsWorkerClient | null = null;
function getSharedClient(): OpfsWorkerClient {
  sharedClient ??= new OpfsWorkerClient();
  return sharedClient;
}

export class OpfsSqlDatabaseFactory implements SqlDatabaseFactory {
  async open(name: string): Promise<SqlDatabase> {
    await requestPersistentStorage();
    const client = getSharedClient();
    const handle = (await client.call({ type: "open", name })) as number;
    return new OpfsSqlDatabase(client, handle);
  }

  /** Raw bytes of the named database file, for building a backup. */
  async exportBytes(name: string): Promise<Uint8Array> {
    const client = getSharedClient();
    return (await client.call({ type: "exportBytes", name })) as Uint8Array;
  }

  /** Every table's rows from a SQLite file's bytes, read in a throwaway in-memory database. */
  async readSqliteTables(bytes: Uint8Array): Promise<Record<string, Record<string, unknown>[]>> {
    const client = getSharedClient();
    return (await client.call({ type: "readSqlite", bytes: asRollbackJournalDatabase(bytes) })) as Record<string, Record<string, unknown>[]>;
  }

  /**
   * Overwrites the named database file with `bytes` (a restore). Any existing open handle to
   * that database must be closed first — the SAH pool allows only one access handle per file.
   */
  async importBytes(name: string, bytes: Uint8Array): Promise<void> {
    const client = getSharedClient();
    await client.call({ type: "importBytes", name, bytes });
  }
}

/// <reference lib="webworker" />
import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import type { Database, SAHPoolUtil, Sqlite3Static } from "@sqlite.org/sqlite-wasm";

/**
 * `FileSystemFileHandle.prototype.createSyncAccessHandle` (which the "opfs-sahpool" VFS needs)
 * is only exposed inside a dedicated Worker, not on the main thread — this is standard,
 * spec-compliant browser behavior, not a workaround for a bug. So all SQLite/OPFS work has to
 * happen in here; `opfsDatabase.ts` on the main thread talks to this worker over a small
 * request/response RPC.
 */

type Request =
  | { id: number; type: "open"; name: string }
  | { id: number; type: "exec"; handle: number; sql: string; params?: unknown[] }
  | { id: number; type: "query"; handle: number; sql: string; params?: unknown[] }
  | { id: number; type: "close"; handle: number }
  | { id: number; type: "exportBytes"; name: string }
  | { id: number; type: "importBytes"; name: string; bytes: Uint8Array };

type Response =
  | { id: number; ok: true; result?: unknown }
  | { id: number; ok: false; error: string };

let sqlite3: Sqlite3Static | null = null;
let poolUtil: SAHPoolUtil | null = null;
let readyPromise: Promise<SAHPoolUtil> | null = null;
const openDbs = new Map<number, Database>();
let nextHandle = 1;

// Two concurrent callers (e.g. React StrictMode double-invoking an effect) must not both reach
// `installOpfsSAHPoolVfs()`: the library's own comments warn that calling it twice in rapid
// succession before the first call's promise is cached can make both calls try to open the same
// OPFS access handles, failing with "Access Handles cannot be created...". Caching the in-flight
// promise (not just the resolved `poolUtil`) ensures every caller awaits the same single init.
async function ensureReady(): Promise<SAHPoolUtil> {
  if (poolUtil) return poolUtil;
  readyPromise ??= (async () => {
    sqlite3 ??= await sqlite3InitModule();
    if (!sqlite3.installOpfsSAHPoolVfs) {
      throw new Error("OPFS SAH pool VFS is not available in this environment");
    }
    const pool = await sqlite3.installOpfsSAHPoolVfs({ name: "auxo-opfs" });
    poolUtil = pool;
    return pool;
  })();
  return readyPromise;
}

async function handle(request: Request): Promise<unknown> {
  switch (request.type) {
    case "open": {
      const pool = await ensureReady();
      const db = new pool.OpfsSAHPoolDb(`/${request.name}.sqlite3`);
      const dbHandle = nextHandle++;
      openDbs.set(dbHandle, db);
      return dbHandle;
    }
    case "exec": {
      const db = requireDb(request.handle);
      db.exec(request.params ? { sql: request.sql, bind: request.params as never } : { sql: request.sql });
      return undefined;
    }
    case "query": {
      const db = requireDb(request.handle);
      return db.exec({
        sql: request.sql,
        ...(request.params ? { bind: request.params as never } : {}),
        returnValue: "resultRows" as const,
        rowMode: "object" as const,
      });
    }
    case "close": {
      const db = requireDb(request.handle);
      db.close();
      openDbs.delete(request.handle);
      return undefined;
    }
    case "exportBytes": {
      const pool = await ensureReady();
      return pool.exportFile(`/${request.name}.sqlite3`);
    }
    case "importBytes": {
      const pool = await ensureReady();
      await pool.importDb(`/${request.name}.sqlite3`, request.bytes);
      return undefined;
    }
  }
}

function requireDb(handle: number): Database {
  const db = openDbs.get(handle);
  if (!db) throw new Error(`No open database for handle ${handle}`);
  return db;
}

self.addEventListener("message", (event: MessageEvent<Request>) => {
  const request = event.data;
  handle(request)
    .then((result) => {
      const response: Response = { id: request.id, ok: true, result };
      self.postMessage(response);
    })
    .catch((error: unknown) => {
      const response: Response = {
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
      self.postMessage(response);
    });
});

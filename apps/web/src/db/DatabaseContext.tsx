import type { SqlDatabase } from "@auxo/core";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { OpfsSqlDatabaseFactory } from "../storage/opfsDatabase";
import { ensureSchema } from "./schema";

const DB_NAME = "auxo";

interface DatabaseState {
  status: "loading" | "ready" | "error";
  db: SqlDatabase | null;
  error: string | null;
}

interface DatabaseContextValue extends DatabaseState {
  /**
   * Closes the current connection and re-opens the database from scratch — for use right after
   * a restore has overwritten the underlying file. Reuses the same shared OPFS worker rather
   * than reloading the page: tearing down and recreating that worker races the browser's own
   * (not-necessarily-synchronous) release of its OPFS access handles, which a second worker can
   * lose, so the one already holding the SAH pool just reopens the file itself instead.
   */
  reopen(): Promise<void>;
}

const DatabaseContext = createContext<DatabaseContextValue>({
  status: "loading",
  db: null,
  error: null,
  reopen: async () => {},
});

export function DatabaseProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DatabaseState>({ status: "loading", db: null, error: null });
  const factoryRef = useRef(new OpfsSqlDatabaseFactory());

  async function openFresh(): Promise<void> {
    try {
      const db = await factoryRef.current.open(DB_NAME);
      await ensureSchema(db);
      setState({ status: "ready", db, error: null });
    } catch (error) {
      setState({ status: "error", db: null, error: error instanceof Error ? error.message : String(error) });
    }
  }

  useEffect(() => {
    void openFresh();
  }, []);

  async function reopen(): Promise<void> {
    // Deliberately doesn't flip `status` to "loading" first: `AppShell` renders nothing while
    // loading, which would unmount the whole tree (losing e.g. a just-shown confirmation
    // message) for no benefit — the old `db` stays valid to render against until the new one
    // is ready, and `AuthContext`'s effect already re-fires on `db`'s reference changing alone.
    await openFresh();
  }

  return <DatabaseContext.Provider value={{ ...state, reopen }}>{children}</DatabaseContext.Provider>;
}

export function useDatabase(): DatabaseContextValue {
  return useContext(DatabaseContext);
}

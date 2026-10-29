import type { SqlDatabase } from "@auxo/core";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { OpfsSqlDatabaseFactory } from "../storage/opfsDatabase";
import { ensureSchema } from "./schema";

interface DatabaseState {
  status: "loading" | "ready" | "error";
  db: SqlDatabase | null;
  error: string | null;
}

const DatabaseContext = createContext<DatabaseState>({ status: "loading", db: null, error: null });

export function DatabaseProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DatabaseState>({ status: "loading", db: null, error: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const factory = new OpfsSqlDatabaseFactory();
        const db = await factory.open("auxo");
        await ensureSchema(db);
        if (!cancelled) setState({ status: "ready", db, error: null });
      } catch (error) {
        if (!cancelled) {
          setState({
            status: "error",
            db: null,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return <DatabaseContext.Provider value={state}>{children}</DatabaseContext.Provider>;
}

export function useDatabase(): DatabaseState {
  return useContext(DatabaseContext);
}

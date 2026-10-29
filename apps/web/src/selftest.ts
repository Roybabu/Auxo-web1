/**
 * A standalone diagnostic page (not linked from the app's normal navigation) that exercises the
 * OPFS SQLite storage adapter end-to-end in a real browser: create a table, insert rows, query
 * them back, run a transaction — and, when reloaded with `?verify=1`, confirm the earlier data
 * survived a full page reload (a fresh worker, not just a fresh JS heap). Useful on its own
 * during development and again for the stage-8 "offline checks" work.
 */
import { OpfsSqlDatabaseFactory } from "./storage/opfsDatabase";

const resultEl = document.getElementById("result");

function report(lines: string[]): void {
  if (resultEl) resultEl.textContent = lines.join("\n");
}

async function run(): Promise<void> {
  const lines: string[] = [];
  const verifyOnly = new URLSearchParams(location.search).get("verify") === "1";
  try {
    const factory = new OpfsSqlDatabaseFactory();
    const db = await factory.open("selftest");

    if (!verifyOnly) {
      await db.exec("DROP TABLE IF EXISTS selftest_rows");
      await db.exec("CREATE TABLE selftest_rows (id INTEGER PRIMARY KEY, label TEXT NOT NULL)");
      await db.exec("INSERT INTO selftest_rows (id, label) VALUES (?, ?)", [1, "hello opfs"]);
      await db.exec("INSERT INTO selftest_rows (id, label) VALUES (?, ?)", [2, "second row"]);
      const rowsAfterInsert = await db.query("SELECT id, label FROM selftest_rows ORDER BY id");
      lines.push(`after insert: ${JSON.stringify(rowsAfterInsert)}`);

      const txResult = await db.transaction(async (tx) => {
        await tx.exec("INSERT INTO selftest_rows (id, label) VALUES (?, ?)", [3, "in transaction"]);
        return tx.query("SELECT COUNT(*) as count FROM selftest_rows");
      });
      lines.push(`transaction result: ${JSON.stringify(txResult)}`);
    } else {
      const rowsAfterReload = await db.query("SELECT id, label FROM selftest_rows ORDER BY id");
      lines.push(`after full page reload: ${JSON.stringify(rowsAfterReload)}`);
      if (rowsAfterReload.length !== 3) {
        throw new Error(`expected 3 rows to have persisted across reload, got ${rowsAfterReload.length}`);
      }
    }

    await db.close();
    lines.push("STATUS: OK");
  } catch (error) {
    lines.push(`STATUS: FAILED — ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  }
  report(lines);
}

void run();

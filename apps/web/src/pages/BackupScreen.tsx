import { createBackup, looksLikeAndroidDatabase, mapAndroidToWeb, restoreBackup } from "@auxo/core";
import { useRef, useState } from "react";
import { importAndroidData } from "../db/androidImport";
import { useDatabase } from "../db/DatabaseContext";
import { ShopRepository } from "../db/shopRepository";
import { OpfsSqlDatabaseFactory } from "../storage/opfsDatabase";
import styles from "./BackupScreen.module.css";

const MIN_PASSPHRASE_LENGTH = 10;
const DB_NAME = "auxo";

export function BackupScreen({ onBack }: { onBack: () => void }) {
  const { db, reopen } = useDatabase();
  const [createPassphrase, setCreatePassphrase] = useState("");
  const [restorePassphrase, setRestorePassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleCreateBackup() {
    setError(null);
    setSuccess(null);
    if (createPassphrase.length < MIN_PASSPHRASE_LENGTH) {
      return setError(`Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters`);
    }
    if (!db) return setError("Storage is not ready yet");

    setBusy(true);
    try {
      const factory = new OpfsSqlDatabaseFactory();
      const plainDatabaseBytes = await factory.exportBytes(DB_NAME);
      const shop = await new ShopRepository(db).get();

      const { auxobak } = await createBackup({
        backupPassphrase: createPassphrase,
        plainDatabaseBytes,
        databaseVersion: 1,
        appVersion: "0.0.0",
        appearance: {
          accent: null,
          darkMode: null,
          restaurantMenu: null,
          suppliers: null,
          creditHoldDays: null,
          onTimeBonusPoints: null,
        },
        counts: shop ? { shop: 1 } : {},
        // Our OPFS export is ordinary SQLite WASM output with no codec ever attached, so it has
        // none of SQLCipher's per-page reserved space. Locking it with the SQLCipher page cipher
        // would silently corrupt the last 80 bytes of every page. The outer Tink envelope
        // (always applied) still fully encrypts the file end to end.
        lockDatabase: false,
      });

      const blob = new Blob([auxobak as unknown as BlobPart], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const dateLabel = new Date().toISOString().slice(0, 10);
      a.download = `${shop?.storeName.replace(/[^a-z0-9]+/gi, "-") ?? "auxo"}-${dateLabel}.auxobak`;
      a.click();
      URL.revokeObjectURL(url);

      setCreatePassphrase("");
      setSuccess("Backup downloaded.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleRestoreBackup(file: File) {
    setError(null);
    setSuccess(null);
    if (restorePassphrase.length < MIN_PASSPHRASE_LENGTH) {
      return setError(`Enter the backup's passphrase (at least ${MIN_PASSPHRASE_LENGTH} characters)`);
    }
    if (!db) return setError("Storage is not ready yet");

    setBusy(true);
    try {
      const fileBytes = new Uint8Array(await file.arrayBuffer());
      const restored = await restoreBackup(restorePassphrase, fileBytes);
      const factory = new OpfsSqlDatabaseFactory();
      const tables = await factory.readSqliteTables(restored.databaseBytes);

      if (looksLikeAndroidDatabase(Object.keys(tables))) {
        const mapped = mapAndroidToWeb(tables);
        const counts = mapped.tables
          .filter((t) => t.table !== "number_sequences")
          .map((t) => `${t.rows.length} ${t.table.replace(/_/g, " ")}`)
          .join(", ");
        const proceed = window.confirm(
          `This is a backup from the Auxo Android app. Importing replaces this device's products, customers, bills and stock history with: ${counts}. Your sign-in accounts here are kept. Continue?`,
        );
        if (!proceed) return;
        await importAndroidData(db, mapped);
        const notes = [
          ...Object.entries(mapped.skipped).map(([table, n]) => `${n} ${table.replace(/_/g, " ")} (not supported on web yet)`),
          ...mapped.warnings,
        ];
        window.alert(
          `Imported ${counts}.${notes.length ? `\n\nNot carried over:\n- ${notes.join("\n- ")}` : ""}`,
        );
        await reopen();
        return;
      }

      const confirmed = window.confirm(
        "Restoring will replace everything currently stored on this device with the backup's contents. This cannot be undone. Continue?",
      );
      if (!confirmed) return;

      // The SAH pool allows only one open access handle per file, so the current connection
      // must be closed before the restored bytes can be written over it.
      await db.close();
      await factory.importBytes(DB_NAME, restored.databaseBytes);

      await reopen();
      setSuccess("Restored.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <button type="button" className={styles.backButton} onClick={onBack}>
          ← Back
        </button>
        <h1 className={styles.title}>Backup &amp; restore</h1>
      </header>

      {error && <p className={styles.error}>{error}</p>}
      {success && <p className={styles.success}>{success}</p>}

      <div className={styles.card}>
        <p className={styles.cardTitle}>Create a backup</p>
        <p className={styles.cardNote}>
          Downloads an encrypted file with everything stored on this device. You'll need the
          passphrase to restore it — if you lose it, the backup can't be recovered.
        </p>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="createPassphrase">
            Passphrase (at least {MIN_PASSPHRASE_LENGTH} characters)
          </label>
          <input
            id="createPassphrase"
            className={styles.input}
            type="password"
            value={createPassphrase}
            onChange={(e) => setCreatePassphrase(e.target.value)}
          />
        </div>
        <button type="button" className={styles.button} disabled={busy} onClick={handleCreateBackup}>
          {busy ? "Working…" : "Create and download backup"}
        </button>
      </div>

      <div className={styles.card}>
        <p className={styles.cardTitle}>Restore a backup</p>
        <p className={styles.cardNote}>Replaces everything on this device with the backup's contents.</p>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="restorePassphrase">
            Backup passphrase
          </label>
          <input
            id="restorePassphrase"
            className={styles.input}
            type="password"
            value={restorePassphrase}
            onChange={(e) => setRestorePassphrase(e.target.value)}
          />
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".auxobak"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleRestoreBackup(file);
          }}
        />
        <button
          type="button"
          className={styles.dangerButton}
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
        >
          {busy ? "Working…" : "Choose backup file and restore"}
        </button>
        <p className={styles.warning}>
          Backups from the Auxo Android app can be restored here too: products, customers, bills,
          payments, the credit book, stock history and bill numbering are imported, and your sign-in
          accounts on this device are kept. Suppliers, purchase orders, quotations, parked bills, the
          day-close history and the activity log are not imported yet. Backups made here can't be
          opened in the Android app yet.
        </p>
      </div>
    </main>
  );
}

# android-backup-vectors

A standalone JVM tool (not part of the shipped web app) that generates real `.auxobak`-format
test vectors using the **same cryptographic libraries** the Android app uses, so the TypeScript
backup/restore code can be verified against real encrypted bytes instead of a hand-rolled
re-implementation that merely looks plausible.

It does **not** reuse Android code (none is linked here) — it reimplements the two crypto layers
from the format spec, using the real upstream libraries for each layer:

- **Outer envelope** — `com.google.crypto.tink:tink` (the actual Tink Java library; the Android
  app uses `com.google.crypto.tink:tink-android`, same `AesGcmHkdfStreaming` implementation) for
  the `AUXOENC1` header + PBKDF2-HMAC-SHA256 + Tink streaming AEAD.
- **Inner database** — `io.github.willena:sqlite-jdbc`, which bundles
  [SQLite3 Multiple Ciphers](https://utelle.github.io/SQLite3MultipleCiphers/) with a
  `legacy=4` mode that reproduces upstream SQLCipher 4's on-disk page format (same KDF, HMAC,
  page size, salt placement) byte-for-byte — not Android's SQLCipher binary itself, but the same
  on-disk format, which is what matters for compatibility.

## What this proved (see `vectors/sample.auxobak.json` for the actual run's values)

- **The `database.key` 64-hex-char string is a SQLCipher *passphrase*, not a raw key.** This was
  the single highest-risk open question in the format spec. Resolved by reading SQLCipher's own
  C source (`sqlcipher/sqlcipher`, `src/sqlcipher.c` lines ~1876–1920): a raw key is only
  recognized when the string is wrapped as `x'<hex>'`; anything else — including a bare 64-hex-char
  string — falls through to PBKDF2-HMAC-SHA512 (256,000 iterations, SQLCipher 4 defaults). Cross-checked
  against `net.zetetic:sqlcipher-android`'s Kotlin/Java layer (`SQLiteDatabase.java`,
  `sqlcipher-android` repo): `getBytes(String)` is a plain UTF-8 encode with no `x'...'` wrapping
  or hex-detection, so the Android app's 64-hex `database.key` always takes the passphrase path.
- The outer Tink `AesGcmHkdfStreaming` envelope (PBKDF2-HMAC-SHA256, 600,000 iterations, 1 MiB
  segments, 28-byte header as associated data) round-trips byte-for-byte, and a wrong passphrase
  is rejected on the first segment read, matching the spec's "fail fast" requirement.
- A SQLCipher-4-compatible database can be created, keyed the same way (`PRAGMA key` as a
  passphrase string), read back correctly, and a wrong key is rejected.

## What this does **not** prove yet

- It does not use the real Android app or a real device-generated `.auxobak` file — the Android
  code was read, not executed. The SQLCipher page format compatibility relies on SQLite3 Multiple
  Ciphers' own claim of SQLCipher-4 byte compatibility, which is widely used and credible, but a
  real Android-generated backup has not yet been produced to diff against.
- The database built here has two throwaway tables, not the full 25-table Room schema. Full
  schema fidelity (including the `room_master_table` row format Room itself writes, not a
  hand-written stand-in) is stage-2 follow-up work.
- `PhotoFiles`, `PassphraseStrength`, and `DatabaseCheck` constants are still unverified (see the
  extracted spec's "not fully verified" section).

**Before shipping backup/restore, get at least one real `.auxobak` file exported from an actual
Android device/emulator and diff it against this tool's output.** This tool makes the TypeScript
implementation buildable and testable in the meantime, not a replacement for that final check.

## Running it

```sh
mvn package
java -jar target/android-backup-vectors-jar-with-dependencies.jar vectors
```

Writes `vectors/sample.auxobak` (a real encrypted backup file) and `vectors/sample.auxobak.json`
(every intermediate value — passphrase, salt, derived keys, hashes — needed to write a
TypeScript test that decrypts the same file and asserts the same plaintext).

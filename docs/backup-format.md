# Auxo backup format (`.auxobak`)

Reference for the web app's backup/restore implementation. Extracted from the Android app
(`Roybabu/Auxo`, branch `temp`, commit `c02ea8cedf91f0c279af625be7607159234cb1b9`) and, where
marked **verified**, cross-checked against real cryptographic libraries rather than trusted from
reading source alone. See `tools/android-backup-vectors/` for the generator that produced the
verification evidence.

## 1. Outer encrypted file

```
Offset  Bytes  Content
0       8      ASCII "AUXOENC1"                          (magic)
8       4      PBKDF2 iteration count, big-endian uint32  (default 600000)
12      16     salt (random)
28      ...    Tink AesGcmHkdfStreaming ciphertext stream
```

- The full 28-byte header is passed as **associated data** to the streaming AEAD.
- Key derivation: `PBKDF2WithHmacSHA256(passphrase, salt, iterations, 256 bits)`.
- Stream cipher: Tink `AesGcmHkdfStreaming(key, "HmacSha256", keySizeBytes=32, segmentSize=1<<20, firstSegmentOffset=0)`.
- **Verified**: this envelope round-trips byte-for-byte against the real Tink Java library, and a
  wrong passphrase is rejected on the first segment read (see
  `tools/android-backup-vectors/vectors/sample.auxobak.json`).
- Minimum passphrase length: 10 characters (enforced by the app; exact "not too common" rule in
  `PassphraseStrength.kt` not yet re-verified).
- A plain zip (no `AUXOENC1` magic) is rejected as `NOT_LOCKED` — only locked backups are ever
  produced or accepted.

## 2. Zip payload (what the Tink stream decrypts to)

Standard DEFLATE zip, entries matched by exact name:

- `manifest.properties` — Java `.properties` text. Required keys: `app` (must be `"auxo"`),
  `format` (`"1"`; greater than the app's own FORMAT is rejected as a newer backup),
  `database_version`. Optional: `created`, `app_version`, `shop`, `products`, `customers`,
  `invoices` (counts, written only when known).
- `auxo.db` — the database file (SQLCipher-locked; max 1 GiB on read).
- `database.key` — present only when the database is locked. Exactly 64 lowercase hex
  characters, US-ASCII, no trailing newline.
- `appearance.properties` — `.properties` text (UTF-8). Keys: `accent`, `dark_mode`,
  `restaurant_menu`, `suppliers`, `credit_hold_days`, `on_time_bonus_points`.
- `photos/<name>.jpg` — zero or more. Naming/count/size limits (`PhotoFiles.kt`) not yet
  re-verified.
- Any text entry over 64 KiB is rejected as corrupt. Unknown entries are ignored.

## 3. Database file (`auxo.db`)

- SQLCipher 4 generation (page-level AES-256-CBC, HMAC-SHA512 per page, 4096-byte pages,
  16-byte salt in page 1).
- KDF: **PBKDF2-HMAC-SHA512, 256,000 iterations** (SQLCipher 4 library default — confirmed
  against SQLCipher's own C source, `sqlcipher/sqlcipher` `src/sqlcipher.c`, not assumed).
- **`database.key` (the 64-hex-char string) is used as a passphrase, not a raw key — verified,
  not assumed.** SQLCipher only treats a key as "raw" when it is wrapped as `x'<hex>'`
  (`src/sqlcipher.c` lines ~1880–1920: `blob_format` requires a literal `x'` prefix and trailing
  `'`). The Android/Kotlin layer (`net.zetetic:sqlcipher-android`, `SQLiteDatabase.java`
  `getBytes(String)`) does a plain UTF-8 encode with no such wrapping before calling
  `sqlite3_key()`. So the bare 64-hex string always falls through to the PBKDF2 passphrase path.
  **This means the outer-envelope passphrase and the inner `database.key` go through two
  independent, differently-parameterized PBKDF2 derivations (SHA-256/600k for the envelope,
  SHA-512/256k for the database) — do not conflate them.**
- A plaintext (unlocked) database starts with the literal 16 bytes `SQLite format 3\0`; a locked
  one starts with the random salt instead — this is how the app tells them apart.
- `PRAGMA user_version` must be preserved/written to match Room's schema version (1, as of the
  read commit).

### Page cipher — verified against SQLCipher's own C source

Page size is 4096 bytes. Every page reserves 80 trailing bytes (`reserve_sz = iv_sz(16) +
hmac_sz(64)`, full SHA-512 digest, not truncated — confirmed in `sqlcipher.c`'s
`sqlcipher_cipher_ctx_init` and `EVP_MAC_final`'s two-pass call in `crypto_openssl.c`).

- **Page 1 only**: bytes `[0, 16)` are the KDF salt on disk (unencrypted); the *decrypted,
  logical* view replaces those 16 bytes with the literal `SQLite format 3\0` magic — this is a
  substitution SQLCipher performs, not a decryption (`sqlite3Codec`, `CODEC_READ_OP` branch).
  Content therefore starts at byte 16 for page 1, byte 0 for every other page.
- **Content**: AES-256-CBC, **no padding** (SQLCipher never pads; content is already
  block-aligned — this is why Web Crypto's `AES-CBC`, which always auto-strips PKCS7 padding,
  cannot be used directly for this layer; see `packages/core/src/backup/sqlcipherPage.ts` for
  how that's worked around).
- **IV**: 16 bytes, stored in the clear immediately after the content.
- **HMAC-SHA512**: covers `content_ciphertext || IV || pgno` where `pgno` is the page number as
  a **4-byte little-endian** integer (`sqlcipher_page_hmac`, default `CIPHER_FLAG_LE_PGNO`).
- **Keys**: `encryptionKey = PBKDF2-HMAC-SHA512(database.key, kdfSalt, 256000 iter, 32 bytes)`.
  `hmacKey` is derived *from the encryption key*, not the passphrase:
  `PBKDF2-HMAC-SHA512(encryptionKey, kdfSalt XOR 0x3a (every byte), 2 iter, 32 bytes)` — the
  `0x3a` mask and 2-iteration "fast KDF" are SQLCipher constants (`HMAC_SALT_MASK`,
  `FAST_PBKDF2_ITER`, `sqlcipher.c`).

**Verified**: `packages/core/src/backup/sqlcipherPage.ts` decrypts a real SQLCipher-4-compatible
database (produced independently by `tools/android-backup-vectors` via a different library —
SQLite3 Multiple Ciphers, not SQLCipher's own amalgamation) and recovers the exact row content
written into it (see `packages/core/src/backup/sqlcipherPage.test.ts`). This proves the page
cipher's key derivation, HMAC, and AES-256-CBC framing are implemented correctly against the
documented SQLCipher 4 format — it does not yet prove compatibility with a database written by
the real `net.zetetic:sqlcipher-android` binary itself (see "still open" below).

## 4. Room identity

- `app/schemas/com.auxo.pos.data.local.AuxoDatabase/1.json`: `version = 1`,
  `room_master_table` identity hash = `a44482f9e76a1450e31cded5d5e2ad8f`. A web-generated
  Android-format backup must reproduce this exact row (table name, identity hash, and
  `PRAGMA user_version = 1`) for the Android app's Room validator to accept it.

## 5. Restore flow (Android `BackupManager.restoreFrom`, for the web implementation to mirror)

1. Detect encrypted (`AUXOENC1` magic) vs. plain zip (`PK`) vs. neither; reject plain zips.
2. Decrypt → unzip → read manifest/db/key/preferences/photos.
3. Check `app == "auxo"`, `format <= FORMAT`, run `PRAGMA integrity_check`, refuse a database
   version newer than supported.
4. Keep a safety copy of the current data before swapping in the restored data; roll back on any
   failure during copy-in.
5. Apply preferences and photos after the data swap. A backup with no photos clears existing
   photos (replace-all, not merge).

## Still open (do not assume — verify before shipping)

- Exact `PhotoFiles` naming/limits constants.
- Exact `PassphraseStrength` "not too common" rule.
- Exact `DatabaseCheck.kt` version-refusal comparison.
- A real Android-device-generated `.auxobak` file has not yet been diffed against this tool's
  output — get one before calling backup/restore done.

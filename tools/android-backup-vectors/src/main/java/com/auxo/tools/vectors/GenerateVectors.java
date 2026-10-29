package com.auxo.tools.vectors;

import com.google.crypto.tink.StreamingAead;
import com.google.crypto.tink.subtle.AesGcmHkdfStreaming;
import org.sqlite.mc.SQLiteMCConfig;
import org.sqlite.mc.SQLiteMCSqlCipherConfig;

import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Properties;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

/**
 * Generates real Auxo-format (.auxobak) backup test vectors using the same cryptographic
 * primitives the Android app uses: Tink's AesGcmHkdfStreaming for the outer envelope, and
 * SQLCipher-4-compatible page encryption (via SQLite3 Multiple Ciphers' legacy=4 mode) for
 * the inner database — not hand-rolled approximations. See README.md in this directory for
 * what each part proves and what it does not.
 */
public final class GenerateVectors {

    private static final byte[] MAGIC = "AUXOENC1".getBytes(StandardCharsets.US_ASCII);
    private static final int ITERATIONS = 600_000;
    private static final int SALT_LEN = 16;
    private static final int HEADER_LEN = 8 + 4 + SALT_LEN;
    private static final int TINK_KEY_SIZE = 32;
    private static final int SEGMENT_SIZE = 1 << 20;

    // Room's room_master_table identity hash for AuxoDatabase schema version 1, read directly
    // from app/schemas/com.auxo.pos.data.local.AuxoDatabase/1.json in the Android repo.
    private static final String ROOM_IDENTITY_HASH = "a44482f9e76a1450e31cded5d5e2ad8f";

    public static void main(String[] args) throws Exception {
        Path outDir = Path.of(args.length > 0 ? args[0] : "vectors");
        Files.createDirectories(outDir);

        SecureRandom random = new SecureRandom();

        String passphrase = "Vector-Backup-Passphrase-01"; // fixed, >=10 chars, documented in sidecar
        byte[] outerSalt = new byte[SALT_LEN];
        random.nextBytes(outerSalt);

        byte[] databaseKeyRaw = new byte[32];
        random.nextBytes(databaseKeyRaw);
        String databaseKeyHex = toHex(databaseKeyRaw); // the 64-hex-char SQLCipher passphrase

        Map<String, Object> sidecar = new LinkedHashMap<>();
        sidecar.put("passphrase", passphrase);
        sidecar.put("outerIterations", ITERATIONS);
        sidecar.put("outerSaltHex", toHex(outerSalt));
        sidecar.put("databaseKeyHex", databaseKeyHex);
        sidecar.put("roomIdentityHash", ROOM_IDENTITY_HASH);

        // ---- 1. Build a SQLCipher-4-compatible auxo.db, keyed exactly as the Android app
        //         keys it: PRAGMA key = '<64-hex-char string>' (a passphrase, NOT a raw key —
        //         see README.md for why, verified against sqlcipher.c source). ----
        Path dbPath = outDir.resolve("auxo.db");
        Files.deleteIfExists(dbPath);
        buildDatabase(dbPath, databaseKeyHex);

        byte[] dbBytes = Files.readAllBytes(dbPath);
        sidecar.put("databaseFileBytes", dbBytes.length);
        sidecar.put("databaseSha256", sha256Hex(dbBytes));
        sidecar.put("databaseFirst16BytesHex", toHex(Arrays.copyOfRange(dbBytes, 0, 16)));
        sidecar.put(
                "databaseLooksEncrypted",
                !Arrays.equals(Arrays.copyOfRange(dbBytes, 0, 16), "SQLite format 3\0".getBytes(StandardCharsets.US_ASCII)));

        // Round-trip proof: reopen with the same key and read back what we wrote.
        String roundTrip = reopenAndRead(dbPath, databaseKeyHex);
        sidecar.put("databaseRoundTripIdentityHash", roundTrip);
        if (!ROOM_IDENTITY_HASH.equals(roundTrip)) {
            throw new IllegalStateException("Round-trip read did not return the identity hash we wrote");
        }

        // Negative proof: a wrong key must fail to read meaningful data (integrity_check error).
        boolean wrongKeyFails = wrongKeyIsRejected(dbPath);
        sidecar.put("wrongKeyRejected", wrongKeyFails);
        if (!wrongKeyFails) {
            throw new IllegalStateException("Expected a wrong SQLCipher key to be rejected");
        }

        // ---- 2. Build the zip payload: manifest.properties, auxo.db, database.key,
        //         appearance.properties — same entry names and java.util.Properties text
        //         format the Kotlin BackupArchive.kt uses (java.util.Properties is the same
        //         JVM class on Android and here). ----
        byte[] zipBytes = buildZip(dbBytes, databaseKeyHex);
        sidecar.put("zipBytes", zipBytes.length);
        sidecar.put("zipSha256", sha256Hex(zipBytes));

        // ---- 3. Outer envelope: AUXOENC1 header + PBKDF2-HMAC-SHA256 key + Tink
        //         AesGcmHkdfStreaming(key, "HmacSha256", 32, 1<<20, 0), associated data =
        //         the 28-byte header, exactly as BackupCrypto.kt is documented to do. ----
        byte[] header = buildHeader(outerSalt);
        byte[] outerKey = pbkdf2HmacSha256(passphrase, outerSalt, ITERATIONS, TINK_KEY_SIZE);
        sidecar.put("outerKeyHex", toHex(outerKey));

        AesGcmHkdfStreaming streaming =
                new AesGcmHkdfStreaming(outerKey, "HmacSha256", TINK_KEY_SIZE, SEGMENT_SIZE, 0);

        Path auxobak = outDir.resolve("sample.auxobak");
        try (OutputStream fileOut = Files.newOutputStream(auxobak)) {
            fileOut.write(header);
            try (OutputStream encryptingStream = streaming.newEncryptingStream(fileOut, header)) {
                encryptingStream.write(zipBytes);
            }
        }
        byte[] auxobakBytes = Files.readAllBytes(auxobak);
        sidecar.put("auxobakBytes", auxobakBytes.length);
        sidecar.put("auxobakSha256", sha256Hex(auxobakBytes));
        sidecar.put("auxobakHeaderHex", toHex(Arrays.copyOfRange(auxobakBytes, 0, HEADER_LEN)));

        // ---- 4. Round-trip proof: decrypt what we just wrote and compare byte-for-byte to
        //         the original zip. ----
        byte[] decrypted;
        try (InputStream fileIn = Files.newInputStream(auxobak)) {
            byte[] readHeader = fileIn.readNBytes(HEADER_LEN);
            if (!Arrays.equals(readHeader, header)) {
                throw new IllegalStateException("Header mismatch on readback");
            }
            try (InputStream decryptingStream = streaming.newDecryptingStream(fileIn, readHeader)) {
                decrypted = decryptingStream.readAllBytes();
            }
        }
        boolean roundTripMatches = Arrays.equals(decrypted, zipBytes);
        sidecar.put("outerRoundTripMatches", roundTripMatches);
        if (!roundTripMatches) {
            throw new IllegalStateException("Decrypted zip does not match original zip bytes");
        }

        // ---- 5. Negative proof: a wrong passphrase must fail on the very first segment. ----
        byte[] wrongOuterKey = pbkdf2HmacSha256("the-wrong-passphrase-entirely", outerSalt, ITERATIONS, TINK_KEY_SIZE);
        AesGcmHkdfStreaming wrongStreaming =
                new AesGcmHkdfStreaming(wrongOuterKey, "HmacSha256", TINK_KEY_SIZE, SEGMENT_SIZE, 0);
        boolean wrongPassphraseRejectedOnFirstByte = false;
        try (InputStream fileIn = Files.newInputStream(auxobak)) {
            byte[] readHeader = fileIn.readNBytes(HEADER_LEN);
            try (InputStream decryptingStream = wrongStreaming.newDecryptingStream(fileIn, readHeader)) {
                decryptingStream.read(); // must throw here, on the first segment
            }
        } catch (IOException | java.security.GeneralSecurityException expected) {
            wrongPassphraseRejectedOnFirstByte = true;
        }
        sidecar.put("wrongPassphraseRejectedOnFirstSegment", wrongPassphraseRejectedOnFirstByte);
        if (!wrongPassphraseRejectedOnFirstByte) {
            throw new IllegalStateException("Expected wrong passphrase to be rejected on first segment");
        }

        writeJson(outDir.resolve("sample.auxobak.json"), sidecar);

        System.out.println("Wrote " + auxobak.toAbsolutePath());
        System.out.println("Wrote " + outDir.resolve("sample.auxobak.json").toAbsolutePath());
        sidecar.forEach((k, v) -> System.out.println("  " + k + " = " + v));
    }

    private static void buildDatabase(Path dbPath, String databaseKeyHex) throws Exception {
        SQLiteMCConfig config = SQLiteMCSqlCipherConfig.getV4Defaults().withKey(databaseKeyHex).build();
        try (Connection conn = config.createConnection("jdbc:sqlite:file:" + dbPath.toAbsolutePath())) {
            try (Statement st = conn.createStatement()) {
                st.execute("PRAGMA user_version = 1");
                st.execute(
                        "CREATE TABLE room_master_table (id INTEGER PRIMARY KEY, identity_hash TEXT)");
                st.execute(
                        "INSERT INTO room_master_table (id, identity_hash) VALUES (42, '" + ROOM_IDENTITY_HASH + "')");
                st.execute(
                        "CREATE TABLE products (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER)");
                st.execute(
                        "INSERT INTO products (id, name, created_at) VALUES ('p1', 'Sample Product', 1700000000000)");
                try (ResultSet rs = st.executeQuery("PRAGMA integrity_check")) {
                    rs.next();
                    String result = rs.getString(1);
                    if (!"ok".equalsIgnoreCase(result)) {
                        throw new IllegalStateException("integrity_check failed: " + result);
                    }
                }
            }
        }
    }

    private static String reopenAndRead(Path dbPath, String databaseKeyHex) throws Exception {
        SQLiteMCConfig config = SQLiteMCSqlCipherConfig.getV4Defaults().withKey(databaseKeyHex).build();
        try (Connection conn = config.createConnection("jdbc:sqlite:file:" + dbPath.toAbsolutePath());
             Statement st = conn.createStatement();
             ResultSet rs = st.executeQuery("SELECT identity_hash FROM room_master_table WHERE id = 42")) {
            rs.next();
            return rs.getString(1);
        }
    }

    private static boolean wrongKeyIsRejected(Path dbPath) {
        String wrongKey = "0".repeat(64);
        SQLiteMCConfig config = SQLiteMCSqlCipherConfig.getV4Defaults().withKey(wrongKey).build();
        try (Connection conn = config.createConnection("jdbc:sqlite:file:" + dbPath.toAbsolutePath());
             Statement st = conn.createStatement();
             ResultSet rs = st.executeQuery("SELECT identity_hash FROM room_master_table WHERE id = 42")) {
            rs.next();
            rs.getString(1);
            return false; // should not get a readable result with the wrong key
        } catch (Exception expected) {
            return true;
        }
    }

    private static byte[] buildZip(byte[] dbBytes, String databaseKeyHex) throws IOException {
        Properties manifest = new Properties();
        manifest.setProperty("app", "auxo");
        manifest.setProperty("format", "1");
        manifest.setProperty("created", String.valueOf(System.currentTimeMillis()));
        manifest.setProperty("database_version", "1");
        manifest.setProperty("app_version", "0.0.0-test-vector");
        manifest.setProperty("shop", "1");
        manifest.setProperty("products", "1");
        manifest.setProperty("customers", "0");
        manifest.setProperty("invoices", "0");

        Properties appearance = new Properties();
        appearance.setProperty("accent", "0");
        appearance.setProperty("dark_mode", "true");
        appearance.setProperty("restaurant_menu", "false");
        appearance.setProperty("suppliers", "false");
        appearance.setProperty("credit_hold_days", "0");
        appearance.setProperty("on_time_bonus_points", "0");

        ByteArrayOutputStream zipBuffer = new ByteArrayOutputStream();
        try (ZipOutputStream zip = new ZipOutputStream(zipBuffer)) {
            putPropertiesEntry(zip, "manifest.properties", manifest);
            zip.putNextEntry(new ZipEntry("auxo.db"));
            zip.write(dbBytes);
            zip.closeEntry();
            zip.putNextEntry(new ZipEntry("database.key"));
            zip.write(databaseKeyHex.getBytes(StandardCharsets.US_ASCII));
            zip.closeEntry();
            putPropertiesEntry(zip, "appearance.properties", appearance);
        }
        return zipBuffer.toByteArray();
    }

    private static void putPropertiesEntry(ZipOutputStream zip, String name, Properties properties)
            throws IOException {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        properties.store(buffer, null);
        zip.putNextEntry(new ZipEntry(name));
        zip.write(buffer.toByteArray());
        zip.closeEntry();
    }

    private static byte[] buildHeader(byte[] salt) {
        // Big-endian 4-byte iteration count, written by hand to avoid any ByteBuffer
        // byte-order ambiguity.
        byte[] header = new byte[HEADER_LEN];
        System.arraycopy(MAGIC, 0, header, 0, MAGIC.length);
        header[8] = (byte) (ITERATIONS >>> 24);
        header[9] = (byte) (ITERATIONS >>> 16);
        header[10] = (byte) (ITERATIONS >>> 8);
        header[11] = (byte) (ITERATIONS);
        System.arraycopy(salt, 0, header, 12, SALT_LEN);
        return header;
    }

    private static byte[] pbkdf2HmacSha256(String passphrase, byte[] salt, int iterations, int keyLenBytes)
            throws Exception {
        PBEKeySpec spec = new PBEKeySpec(passphrase.toCharArray(), salt, iterations, keyLenBytes * 8);
        SecretKeyFactory factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256");
        return factory.generateSecret(spec).getEncoded();
    }

    private static String toHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    }

    private static String sha256Hex(byte[] data) throws Exception {
        return toHex(MessageDigest.getInstance("SHA-256").digest(data));
    }

    private static void writeJson(Path path, Map<String, Object> map) throws IOException {
        StringBuilder sb = new StringBuilder();
        sb.append("{\n");
        int i = 0;
        for (Map.Entry<String, Object> entry : map.entrySet()) {
            Object value = entry.getValue();
            sb.append("  \"").append(entry.getKey()).append("\": ");
            if (value instanceof String s) {
                sb.append('"').append(s.replace("\\", "\\\\").replace("\"", "\\\"")).append('"');
            } else {
                sb.append(value);
            }
            if (++i < map.size()) {
                sb.append(',');
            }
            sb.append('\n');
        }
        sb.append("}\n");
        Files.writeString(path, sb.toString(), StandardCharsets.UTF_8);
    }
}

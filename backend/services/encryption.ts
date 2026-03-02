/**
 * Encryption Service — AES-256-GCM (authenticated encryption)
 * 
 * Upgraded from AES-256-CBC:
 * - GCM provides authentication + encryption (detects tampering)
 * - Per-operation random 12-byte IV (nonce)
 * - Auth tag stored alongside ciphertext
 * - Format: iv:authTag:ciphertext (all hex)
 * 
 * Backwards compatible: auto-detects CBC format (iv:ciphertext) and decrypts with legacy mode.
 */
import crypto from "crypto";

const GCM_ALGORITHM = "aes-256-gcm";
const CBC_ALGORITHM = "aes-256-cbc";
const GCM_IV_LENGTH = 12;   // 96-bit nonce for GCM
const CBC_IV_LENGTH = 16;   // 128-bit IV for CBC
const AUTH_TAG_LENGTH = 16;  // 128-bit auth tag

function getMasterKey(): Buffer {
    const key = process.env.MASTER_KEY;
    if (!key) {
        throw new Error("MASTER_KEY environment variable is required (64 hex chars = 32 bytes)");
    }
    return Buffer.from(key, "hex");
}

/**
 * Encrypt with AES-256-GCM.
 * Returns: iv:authTag:ciphertext (all hex)
 */
export function encrypt(text: string): string {
    const masterKey = getMasterKey();
    const iv = crypto.randomBytes(GCM_IV_LENGTH);
    const cipher = crypto.createCipheriv(GCM_ALGORITHM, masterKey, iv, {
        authTagLength: AUTH_TAG_LENGTH,
    });
    let encrypted = cipher.update(text, "utf8");
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    const authTag = cipher.getAuthTag();
    return iv.toString("hex") + ":" + authTag.toString("hex") + ":" + encrypted.toString("hex");
}

/**
 * Decrypt — auto-detects GCM (3 parts) vs legacy CBC (2 parts).
 */
export function decrypt(hash: string): string {
    const parts = hash.split(":");

    // GCM format: iv:authTag:ciphertext
    if (parts.length === 3) {
        return decryptGCM(parts[0], parts[1], parts[2]);
    }

    // Legacy CBC format: iv:ciphertext
    if (parts.length === 2) {
        return decryptCBC(parts[0], parts[1]);
    }

    throw new Error("Invalid encrypted data format");
}

function decryptGCM(ivHex: string, authTagHex: string, ciphertextHex: string): string {
    const masterKey = getMasterKey();
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const encrypted = Buffer.from(ciphertextHex, "hex");

    const decipher = crypto.createDecipheriv(GCM_ALGORITHM, masterKey, iv, {
        authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString("utf8");
}

/** Legacy CBC decrypt for backwards compatibility with existing wallets */
function decryptCBC(ivHex: string, encryptedHex: string): string {
    const masterKey = getMasterKey();
    const iv = Buffer.from(ivHex, "hex");
    const encrypted = Buffer.from(encryptedHex, "hex");
    const decipher = crypto.createDecipheriv(CBC_ALGORITHM, masterKey, iv);
    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString("utf8");
}

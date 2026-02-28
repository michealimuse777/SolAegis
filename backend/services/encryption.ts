import crypto from "crypto";

const algorithm = "aes-256-cbc";

function getMasterKey(): Buffer {
    const key = process.env.MASTER_KEY;
    if (!key) {
        throw new Error("MASTER_KEY environment variable is required (64 hex chars = 32 bytes)");
    }
    return Buffer.from(key, "hex");
}

export function encrypt(text: string): string {
    const masterKey = getMasterKey();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(algorithm, masterKey, iv);
    let encrypted = cipher.update(text, "utf8");
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString("hex") + ":" + encrypted.toString("hex");
}

export function decrypt(hash: string): string {
    const masterKey = getMasterKey();
    const [ivHex, encryptedHex] = hash.split(":");
    if (!ivHex || !encryptedHex) {
        throw new Error("Invalid encrypted data format");
    }
    const iv = Buffer.from(ivHex, "hex");
    const encrypted = Buffer.from(encryptedHex, "hex");
    const decipher = crypto.createDecipheriv(algorithm, masterKey, iv);
    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString("utf8");
}

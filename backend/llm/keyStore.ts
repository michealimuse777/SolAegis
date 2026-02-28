import crypto from "crypto";

const algorithm = "aes-256-cbc";

function getMasterKey(): Buffer {
    const key = process.env.MASTER_KEY;
    if (!key) throw new Error("MASTER_KEY env var required for LLM key encryption");
    return Buffer.from(key, "hex");
}

/**
 * Encrypted storage for multiple LLM API keys.
 * Supports round-robin rotation and quota-based switching.
 */
export class KeyStore {
    private encryptedKeys: string[] = [];
    private requestCounts: number[] = [];

    /**
     * Add an API key (will be encrypted at rest).
     */
    addKey(rawKey: string): void {
        const masterKey = getMasterKey();
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(algorithm, masterKey, iv);
        let encrypted = cipher.update(rawKey, "utf8", "hex");
        encrypted += cipher.final("hex");
        this.encryptedKeys.push(iv.toString("hex") + ":" + encrypted);
        this.requestCounts.push(0);
    }

    /**
     * Decrypt and return a key by index.
     */
    getDecryptedKey(index: number): string {
        if (index < 0 || index >= this.encryptedKeys.length) {
            throw new Error(`Invalid key index: ${index}`);
        }
        const masterKey = getMasterKey();
        const [ivHex, encrypted] = this.encryptedKeys[index].split(":");
        const iv = Buffer.from(ivHex, "hex");
        const decipher = crypto.createDecipheriv(algorithm, masterKey, iv);
        let decrypted = decipher.update(encrypted, "hex", "utf8");
        decrypted += decipher.final("utf8");
        return decrypted;
    }

    /**
     * Track API usage for a key.
     */
    incrementUsage(index: number): void {
        if (index >= 0 && index < this.requestCounts.length) {
            this.requestCounts[index]++;
        }
    }

    /**
     * Get usage stats.
     */
    getUsageStats(): { index: number; requests: number }[] {
        return this.requestCounts.map((count, index) => ({ index, requests: count }));
    }

    /**
     * Find the least-used key index for load balancing.
     */
    getLeastUsedIndex(): number {
        if (this.encryptedKeys.length === 0) return -1;
        let minIdx = 0;
        for (let i = 1; i < this.requestCounts.length; i++) {
            if (this.requestCounts[i] < this.requestCounts[minIdx]) {
                minIdx = i;
            }
        }
        return minIdx;
    }

    totalKeys(): number {
        return this.encryptedKeys.length;
    }

    /**
     * Load keys from environment variables (LLM_KEY_1, LLM_KEY_2, etc.)
     */
    loadFromEnv(): void {
        for (let i = 1; i <= 10; i++) {
            const key = process.env[`LLM_KEY_${i}`];
            if (key && key.trim().length > 0) {
                this.addKey(key.trim());
                console.log(`[KeyStore] Loaded LLM_KEY_${i}`);
            }
        }
    }
}

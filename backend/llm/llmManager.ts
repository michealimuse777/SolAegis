import { KeyStore } from "./keyStore.js";

export interface LLMResponse {
    output: string;
    provider: string;
    model: string;
    tokensUsed?: number;
    error?: boolean;
    fallbackUsed?: boolean;
}

/**
 * LLM Manager with multi-key rotation, exponential backoff,
 * key blacklisting, and streaming support.
 */
export class LLMManager {
    private currentKeyIndex = 0;
    private maxRetries = 6; // Try all keys (even if > 5) before giving up

    // Per-key error tracking for blacklisting
    private keyErrors: Map<number, { count: number; blacklistedUntil: number }> = new Map();
    private readonly BLACKLIST_DURATION_MS = 120_000; // 2 min blacklist after consecutive failures
    private readonly MAX_KEY_ERRORS = 3;

    constructor(
        private keyStore: KeyStore,
        private provider: string = "gemini",
        private model: string = "gemini-2.5-flash"
    ) { }

    /**
     * Simple text completion — returns just the output string.
     */
    async complete(prompt: string, _maxTokens?: number): Promise<string> {
        const resp = await this.query(prompt);
        return resp.output;
    }

    /**
     * Streaming text completion — calls onChunk for each text fragment.
     * Uses Gemini streamGenerateContent API.
     */
    async streamComplete(
        prompt: string,
        onChunk: (text: string) => void,
    ): Promise<string> {
        if (this.keyStore.totalKeys() === 0) {
            const msg = "No LLM API keys configured — using deterministic rules";
            onChunk(msg);
            return msg;
        }

        const key = this.getNextAvailableKey();
        if (!key) {
            const msg = "All LLM keys temporarily blacklisted — try again shortly";
            onChunk(msg);
            return msg;
        }

        try {
            const url = this.getStreamUrl(key.apiKey);
            const body = this.formatRequestBody(prompt);

            const res = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });

            if (!res.ok) {
                this.recordKeyError(key.index, res.status);
                const errText = await res.text().catch(() => "");
                const msg = `LLM error: ${res.status} — ${errText.slice(0, 100)}`;
                onChunk(msg);
                return msg;
            }

            // Reset error count on success
            this.keyErrors.delete(key.index);
            this.keyStore.incrementUsage(key.index);

            // Stream the response
            const fullText = await this.processStream(res, onChunk);
            return fullText;

        } catch (err: any) {
            this.recordKeyError(key.index, 0);
            const msg = `Stream error: ${err.message}`;
            onChunk(msg);
            return msg;
        }
    }

    /**
     * Process a streaming response body, calling onChunk for each text piece.
     */
    private async processStream(
        res: Response,
        onChunk: (text: string) => void,
    ): Promise<string> {
        const reader = res.body?.getReader();
        if (!reader) {
            const data = await res.json();
            const text = this.parseResponse(data).output;
            onChunk(text);
            return text;
        }

        const decoder = new TextDecoder();
        let fullText = "";
        let buffer = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // Parse JSON objects from the stream buffer
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed === "[" || trimmed === "]" || trimmed === ",") continue;

                // Remove leading comma if present
                const cleanLine = trimmed.startsWith(",") ? trimmed.slice(1).trim() : trimmed;
                if (!cleanLine) continue;

                try {
                    const obj = JSON.parse(cleanLine);
                    const text = obj?.candidates?.[0]?.content?.parts?.[0]?.text;
                    if (text) {
                        fullText += text;
                        onChunk(text);
                    }
                } catch {
                    // Partial JSON — will be completed in next chunk
                }
            }
        }

        return fullText;
    }

    /**
     * Query the LLM with automatic key rotation, exponential backoff,
     * and key blacklisting on consecutive failures.
     */
    async query(prompt: string): Promise<LLMResponse> {
        if (this.keyStore.totalKeys() === 0) {
            return {
                output: JSON.stringify({
                    action: "hold",
                    reason: "No LLM API keys configured — using deterministic rules",
                }),
                provider: "none",
                model: "none",
                error: true,
            };
        }

        let attempts = 0;
        const totalKeys = this.keyStore.totalKeys();
        let lastError = "";

        while (attempts < this.maxRetries) {
            const key = this.getNextAvailableKey();
            if (!key) {
                // All keys blacklisted — wait briefly then retry
                await this.sleep(1000);
                attempts++;
                continue;
            }

            try {
                const response = await this.callProvider(key.apiKey, prompt);
                // Success — reset error count
                this.keyErrors.delete(key.index);
                this.keyStore.incrementUsage(key.index);
                return response;
            } catch (err: any) {
                lastError = err.message;
                const status = err.status || 0;
                console.warn(
                    `[LLMManager] Key ${key.index} failed (${status}): ${err.message}`
                );

                // Record error and potentially blacklist
                this.recordKeyError(key.index, status);

                // Exponential backoff: 500ms, 1s, 2s
                const backoffMs = Math.min(500 * Math.pow(2, attempts), 4000);
                await this.sleep(backoffMs);

                // Move to next key
                this.currentKeyIndex = (key.index + 1) % totalKeys;
                attempts++;
            }
        }

        // All retries exhausted
        return {
            output: JSON.stringify({
                action: "hold",
                reason: `All LLM keys exhausted after ${attempts} retries — ${lastError}`,
            }),
            provider: "fallback",
            model: "deterministic",
            error: true,
            fallbackUsed: true,
        };
    }

    /**
     * Get the next available (non-blacklisted) key.
     */
    private getNextAvailableKey(): { apiKey: string; index: number } | null {
        const totalKeys = this.keyStore.totalKeys();
        const now = Date.now();

        for (let i = 0; i < totalKeys; i++) {
            const idx = (this.currentKeyIndex + i) % totalKeys;
            const err = this.keyErrors.get(idx);
            if (err && err.count >= this.MAX_KEY_ERRORS && now < err.blacklistedUntil) {
                continue; // Blacklisted — skip
            }
            // Clear expired blacklist
            if (err && now >= err.blacklistedUntil) {
                this.keyErrors.delete(idx);
            }
            this.currentKeyIndex = idx;
            return { apiKey: this.keyStore.getDecryptedKey(idx), index: idx };
        }

        return null; // All keys blacklisted
    }

    /**
     * Record an error for a key. Blacklist after MAX_KEY_ERRORS consecutive failures.
     */
    private recordKeyError(keyIndex: number, httpStatus: number): void {
        const existing = this.keyErrors.get(keyIndex) || { count: 0, blacklistedUntil: 0 };
        existing.count++;
        if (existing.count >= this.MAX_KEY_ERRORS) {
            existing.blacklistedUntil = Date.now() + this.BLACKLIST_DURATION_MS;
            console.warn(
                `[LLMManager] Key ${keyIndex} blacklisted for ${this.BLACKLIST_DURATION_MS / 1000}s after ${existing.count} consecutive failures (last status: ${httpStatus})`
            );
        }
        this.keyErrors.set(keyIndex, existing);
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Internal: call the appropriate LLM provider.
     */
    private async callProvider(
        apiKey: string,
        prompt: string
    ): Promise<LLMResponse> {
        const url = this.getProviderUrl(apiKey);
        const body = this.formatRequestBody(prompt);
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
        };

        if (this.provider !== "gemini") {
            headers["Authorization"] = `Bearer ${apiKey}`;
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30_000); // 30s timeout

        try {
            const res = await fetch(url, {
                method: "POST",
                headers,
                body: JSON.stringify(body),
                signal: controller.signal,
            });

            if (res.status === 429) {
                const err: any = new Error("Rate limited (429)");
                err.status = 429;
                throw err;
            }

            if (res.status >= 500) {
                const err: any = new Error(`Server error (${res.status})`);
                err.status = res.status;
                throw err;
            }

            if (!res.ok) {
                const errBody = await res.text().catch(() => "");
                const err: any = new Error(`API error: ${res.status} — ${errBody.slice(0, 200)}`);
                err.status = res.status;
                throw err;
            }

            const data = await res.json();
            return this.parseResponse(data);
        } finally {
            clearTimeout(timeout);
        }
    }

    private getProviderUrl(apiKey: string): string {
        switch (this.provider) {
            case "gemini":
                return `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${apiKey}`;
            case "openai":
                return "https://api.openai.com/v1/chat/completions";
            default:
                return `https://api.${this.provider}.com/v1/query`;
        }
    }

    private getStreamUrl(apiKey: string): string {
        switch (this.provider) {
            case "gemini":
                return `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:streamGenerateContent?alt=sse&key=${apiKey}`;
            default:
                return this.getProviderUrl(apiKey);
        }
    }

    private formatRequestBody(prompt: string): any {
        switch (this.provider) {
            case "gemini":
                return {
                    contents: [{ parts: [{ text: prompt }] }],
                };
            case "openai":
                return {
                    model: this.model,
                    messages: [{ role: "user", content: prompt }],
                    stream: true,
                };
            default:
                return { model: this.model, prompt };
        }
    }

    private parseResponse(data: any): LLMResponse {
        let output = "";

        if (this.provider === "gemini") {
            output =
                data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        } else if (this.provider === "openai") {
            output = data?.choices?.[0]?.message?.content ?? "";
        } else {
            output = data?.output ?? JSON.stringify(data);
        }

        return {
            output,
            provider: this.provider,
            model: this.model,
        };
    }

    /**
     * Switch provider and model at runtime.
     */
    setProvider(provider: string, model: string): void {
        this.provider = provider;
        this.model = model;
    }

    /**
     * Get current key usage stats.
     */
    getUsageStats() {
        const stats = this.keyStore.getUsageStats();
        const blacklisted: number[] = [];
        const now = Date.now();
        this.keyErrors.forEach((err, idx) => {
            if (err.count >= this.MAX_KEY_ERRORS && now < err.blacklistedUntil) {
                blacklisted.push(idx);
            }
        });
        return { ...stats, blacklistedKeys: blacklisted };
    }
}

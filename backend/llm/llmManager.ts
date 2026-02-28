import { KeyStore } from "./keyStore.js";

export interface LLMResponse {
    output: string;
    provider: string;
    model: string;
    tokensUsed?: number;
}

/**
 * LLM Manager with multi-key rotation and automatic retry on 429 (rate limit).
 * Supports round-robin key cycling and provider switching.
 */
export class LLMManager {
    private currentKeyIndex = 0;
    private maxRetries = 3;

    constructor(
        private keyStore: KeyStore,
        private provider: string = "gemini",
        private model: string = "gemini-pro"
    ) { }

    /**
     * Query the LLM with automatic key rotation on rate limiting.
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
            };
        }

        let attempts = 0;
        const startIndex = this.currentKeyIndex;

        while (attempts < this.maxRetries) {
            const key = this.keyStore.getDecryptedKey(this.currentKeyIndex);

            try {
                const response = await this.callProvider(key, prompt);
                this.keyStore.incrementUsage(this.currentKeyIndex);
                return response;
            } catch (err: any) {
                console.warn(
                    `[LLMManager] Key ${this.currentKeyIndex} failed: ${err.message}`
                );

                // Rotate to next key
                this.currentKeyIndex =
                    (this.currentKeyIndex + 1) % this.keyStore.totalKeys();

                // If we've cycled through all keys, stop
                if (this.currentKeyIndex === startIndex) {
                    attempts++;
                }
            }
        }

        // All keys exhausted — return fallback
        return {
            output: JSON.stringify({
                action: "hold",
                reason: "All LLM keys exhausted — falling back to deterministic rules",
            }),
            provider: "fallback",
            model: "deterministic",
        };
    }

    /**
     * Internal: call the appropriate LLM provider.
     */
    private async callProvider(
        apiKey: string,
        prompt: string
    ): Promise<LLMResponse> {
        const url = this.getProviderUrl();
        const body = this.formatRequestBody(prompt);

        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(body),
        });

        if (res.status === 429) {
            throw new Error("Rate limited (429)");
        }

        if (!res.ok) {
            throw new Error(`API error: ${res.status} ${res.statusText}`);
        }

        const data = await res.json();
        return this.parseResponse(data);
    }

    private getProviderUrl(): string {
        switch (this.provider) {
            case "gemini":
                return `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`;
            case "openai":
                return "https://api.openai.com/v1/chat/completions";
            default:
                return `https://api.${this.provider}.com/v1/query`;
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
        return this.keyStore.getUsageStats();
    }
}

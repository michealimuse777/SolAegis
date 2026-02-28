import { LLMManager, LLMResponse } from "./llmManager.js";
import { KeyStore } from "./keyStore.js";

export interface FallbackConfig {
    primary: { provider: string; model: string };
    fallback: { provider: string; model: string };
}

/**
 * Multi-provider LLM fallback logic.
 * Tries primary provider first, falls back to secondary on failure.
 */
export class LLMFallback {
    private primaryManager: LLMManager;
    private fallbackManager: LLMManager;

    constructor(private keyStore: KeyStore, config: FallbackConfig) {
        this.primaryManager = new LLMManager(
            keyStore,
            config.primary.provider,
            config.primary.model
        );
        this.fallbackManager = new LLMManager(
            keyStore,
            config.fallback.provider,
            config.fallback.model
        );
    }

    /**
     * Query with automatic provider fallback.
     */
    async query(prompt: string): Promise<LLMResponse> {
        try {
            const response = await this.primaryManager.query(prompt);

            // If primary returned a fallback/deterministic response, try secondary
            if (response.provider === "fallback") {
                console.log("[LLMFallback] Primary exhausted, trying fallback provider");
                return await this.fallbackManager.query(prompt);
            }

            return response;
        } catch (err: any) {
            console.warn(`[LLMFallback] Primary failed: ${err.message}, switching to fallback`);

            try {
                return await this.fallbackManager.query(prompt);
            } catch (fallbackErr: any) {
                console.error(`[LLMFallback] All providers failed: ${fallbackErr.message}`);
                return {
                    output: JSON.stringify({
                        action: "hold",
                        reason: "All LLM providers failed — agent holding until next cycle",
                    }),
                    provider: "none",
                    model: "deterministic",
                };
            }
        }
    }

    /**
     * Get combined usage stats from all providers.
     */
    getStats() {
        return {
            primary: this.primaryManager.getUsageStats(),
            fallback: this.fallbackManager.getUsageStats(),
        };
    }
}

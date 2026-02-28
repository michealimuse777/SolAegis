/**
 * Capital Allocation Engine
 * 
 * Constrains AI decisions with portfolio % rules:
 * - Max % per single action
 * - Diversification limits
 * - Volatility-based risk scaling
 */

export interface AllocationRules {
    maxSingleActionPct: number;     // Max % of portfolio per action (default 30%)
    maxSingleTokenPct: number;      // Max % in one token (default 50%)
    minReserveSOL: number;          // Always keep this much SOL (default 0.05)
    riskMultiplier: number;         // 0.5 = conservative, 1.0 = normal, 2.0 = aggressive
}

export interface AllocationResult {
    allowed: boolean;
    maxAmount: number;              // Maximum SOL/tokens allowed for this action
    reason?: string;
    adjustedParams?: Record<string, any>;
}

const DEFAULT_RULES: AllocationRules = {
    maxSingleActionPct: 0.30,
    maxSingleTokenPct: 0.50,
    minReserveSOL: 0.05,
    riskMultiplier: 1.0,
};

export class CapitalAllocator {
    private rules: AllocationRules;

    constructor(rules?: Partial<AllocationRules>) {
        this.rules = { ...DEFAULT_RULES, ...rules };
    }

    /**
     * Checks if an action is allowed given current portfolio state.
     * Returns the maximum allowed amount.
     */
    checkAllocation(
        action: string,
        requestedAmount: number,
        solBalance: number,
        tokenHoldings: { mint: string; balance: number; valueSOL: number }[],
        targetMint?: string
    ): AllocationResult {
        const totalPortfolioSOL = solBalance +
            tokenHoldings.reduce((sum, t) => sum + t.valueSOL, 0);

        // Ensure minimum reserve
        const availableSOL = Math.max(0, solBalance - this.rules.minReserveSOL);

        if (availableSOL <= 0) {
            return {
                allowed: false,
                maxAmount: 0,
                reason: `Insufficient balance after reserve (${this.rules.minReserveSOL} SOL reserve required)`,
            };
        }

        // Max single action cap
        const maxActionSOL = totalPortfolioSOL * this.rules.maxSingleActionPct * this.rules.riskMultiplier;

        // Diversification check for token-specific actions
        if (targetMint && (action === "swap" || action === "liquidity")) {
            const existingPosition = tokenHoldings.find(t => t.mint === targetMint);
            const existingValueSOL = existingPosition?.valueSOL ?? 0;
            const maxTokenSOL = totalPortfolioSOL * this.rules.maxSingleTokenPct;

            if (existingValueSOL >= maxTokenSOL) {
                return {
                    allowed: false,
                    maxAmount: 0,
                    reason: `Diversification limit: already ${((existingValueSOL / totalPortfolioSOL) * 100).toFixed(0)}% in this token (max ${this.rules.maxSingleTokenPct * 100}%)`,
                };
            }

            // Cap amount to not exceed diversification limit
            const roomSOL = maxTokenSOL - existingValueSOL;
            const cappedAmount = Math.min(requestedAmount, roomSOL, maxActionSOL, availableSOL);

            if (cappedAmount < requestedAmount) {
                return {
                    allowed: true,
                    maxAmount: cappedAmount,
                    reason: `Amount reduced from ${requestedAmount} to ${cappedAmount.toFixed(4)} SOL (diversification + action cap)`,
                    adjustedParams: { amount: cappedAmount },
                };
            }
        }

        // General action cap
        const cappedAmount = Math.min(requestedAmount, maxActionSOL, availableSOL);

        if (cappedAmount <= 0) {
            return {
                allowed: false,
                maxAmount: 0,
                reason: "Amount exceeds portfolio allocation limits",
            };
        }

        if (cappedAmount < requestedAmount) {
            return {
                allowed: true,
                maxAmount: cappedAmount,
                reason: `Amount capped: ${requestedAmount} -> ${cappedAmount.toFixed(4)} SOL (${(this.rules.maxSingleActionPct * 100).toFixed(0)}% max per action)`,
                adjustedParams: { amount: cappedAmount },
            };
        }

        return { allowed: true, maxAmount: requestedAmount };
    }

    /**
     * Gets a portfolio diversification report.
     */
    getDiversificationReport(
        solBalance: number,
        tokenHoldings: { mint: string; balance: number; valueSOL: number }[]
    ): {
        totalValueSOL: number;
        solPct: number;
        tokenAllocations: { mint: string; pct: number; overLimit: boolean }[];
        diversified: boolean;
        warnings: string[];
    } {
        const totalValueSOL = solBalance + tokenHoldings.reduce((sum, t) => sum + t.valueSOL, 0);
        const solPct = totalValueSOL > 0 ? solBalance / totalValueSOL : 1;

        const tokenAllocations = tokenHoldings.map(t => {
            const pct = totalValueSOL > 0 ? t.valueSOL / totalValueSOL : 0;
            return {
                mint: t.mint,
                pct,
                overLimit: pct > this.rules.maxSingleTokenPct,
            };
        });

        const warnings: string[] = [];
        if (solPct < 0.1) warnings.push("SOL reserves below 10% of portfolio");
        for (const t of tokenAllocations) {
            if (t.overLimit) {
                warnings.push(`Token ${t.mint.slice(0, 8)}... is ${(t.pct * 100).toFixed(0)}% of portfolio (max ${this.rules.maxSingleTokenPct * 100}%)`);
            }
        }

        return {
            totalValueSOL,
            solPct,
            tokenAllocations,
            diversified: warnings.length === 0,
            warnings,
        };
    }

    /**
     * Returns current rules for display.
     */
    getRules(): AllocationRules {
        return { ...this.rules };
    }

    /**
     * Updates risk multiplier dynamically (e.g., based on market conditions).
     */
    setRiskMultiplier(multiplier: number): void {
        this.rules.riskMultiplier = Math.max(0.1, Math.min(3.0, multiplier));
    }
}

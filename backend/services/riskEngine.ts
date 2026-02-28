import {
    Connection,
    Transaction,
    PublicKey,
    LAMPORTS_PER_SOL,
    ComputeBudgetProgram,
    Keypair,
} from "@solana/web3.js";

export interface ValidationResult {
    valid: boolean;
    reason?: string;
    computeUnits?: number;
    estimatedFee?: number;
}

export interface SendResult {
    success: boolean;
    signature?: string;
    error?: string;
    attempts: number;
}

export class RiskEngine {
    private recentTxHashes = new Set<string>();

    constructor(private connection: Connection) { }

    /**
     * Full pre-execution validation:
     * - SOL balance check (minimum 0.01 SOL for fees)
     * - Transaction simulation
     * - Dynamic compute budget adjustment
     * - Duplicate transaction prevention
     */
    async validateTransaction(
        tx: Transaction,
        payer: PublicKey
    ): Promise<ValidationResult> {
        // 1. Balance check
        const balance = await this.connection.getBalance(payer);
        if (balance < 0.01 * LAMPORTS_PER_SOL) {
            return {
                valid: false,
                reason: `Insufficient SOL balance for fees: ${balance / LAMPORTS_PER_SOL} SOL`,
            };
        }

        // 2. Set fee payer and blockhash for simulation
        tx.feePayer = payer;
        const { blockhash } = await this.connection.getLatestBlockhash();
        tx.recentBlockhash = blockhash;

        // 3. Duplicate check (hash-based)
        const txKey = this.computeTxKey(tx);
        if (this.recentTxHashes.has(txKey)) {
            return {
                valid: false,
                reason: "Duplicate transaction detected -- skipping",
            };
        }

        // 4. Simulate with retry
        const simResult = await this.simulateWithRetry(tx, 2);
        if (!simResult.valid) return simResult;

        // 5. Dynamic compute budget: set CU limit to 1.2x simulated usage
        const computeUnits = simResult.computeUnits ?? 200_000;
        if (computeUnits > 0) {
            const adjustedCU = Math.min(Math.ceil(computeUnits * 1.2), 1_400_000);
            tx.instructions.unshift(
                ComputeBudgetProgram.setComputeUnitLimit({ units: adjustedCU })
            );
        }

        // 6. Track this tx to prevent duplicates
        this.recentTxHashes.add(txKey);
        setTimeout(() => this.recentTxHashes.delete(txKey), 60_000);

        return {
            valid: true,
            computeUnits,
            estimatedFee: 5000,
        };
    }

    /**
     * Signs and sends a transaction with retry, blockhash refresh, and exponential backoff.
     * Max 3 attempts.
     */
    async sendWithRetry(
        tx: Transaction,
        keypair: Keypair,
        maxAttempts: number = 3
    ): Promise<SendResult> {
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                // Refresh blockhash on retry (prevents expiry)
                if (attempt > 1) {
                    const { blockhash, lastValidBlockHeight } =
                        await this.connection.getLatestBlockhash();
                    tx.recentBlockhash = blockhash;
                    console.log(`[RiskEngine] Retry ${attempt}/${maxAttempts} — refreshed blockhash`);
                }

                tx.feePayer = keypair.publicKey;
                tx.sign(keypair);

                const signature = await this.connection.sendRawTransaction(
                    tx.serialize(),
                    {
                        skipPreflight: false,
                        preflightCommitment: "confirmed",
                        maxRetries: 2,
                    }
                );

                // Confirm with timeout
                const confirmation = await this.connection.confirmTransaction(
                    signature,
                    "confirmed"
                );

                if (confirmation.value.err) {
                    throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
                }

                return { success: true, signature, attempts: attempt };
            } catch (err: any) {
                const isRetryable = this.isRetryableError(err);

                if (attempt === maxAttempts || !isRetryable) {
                    return {
                        success: false,
                        error: err.message,
                        attempts: attempt,
                    };
                }

                // Exponential backoff: 1s, 2s, 4s
                const backoffMs = 1000 * Math.pow(2, attempt - 1);
                console.log(`[RiskEngine] Attempt ${attempt} failed (${err.message}), retrying in ${backoffMs}ms...`);
                await this.sleep(backoffMs);
            }
        }

        return { success: false, error: "Max retries exceeded", attempts: maxAttempts };
    }

    /**
     * Quick balance-only check (for DerMercist decision layer).
     */
    async checkBalance(payer: PublicKey): Promise<{ sufficient: boolean; balance: number }> {
        const balance = await this.connection.getBalance(payer);
        return {
            sufficient: balance >= 0.01 * LAMPORTS_PER_SOL,
            balance: balance / LAMPORTS_PER_SOL,
        };
    }

    /**
     * Simulates a transaction with retry on network errors.
     */
    private async simulateWithRetry(
        tx: Transaction,
        maxRetries: number
    ): Promise<ValidationResult> {
        for (let i = 0; i <= maxRetries; i++) {
            try {
                const sim = await this.connection.simulateTransaction(tx);

                if (sim.value.err) {
                    return {
                        valid: false,
                        reason: `Simulation failed: ${JSON.stringify(sim.value.err)}`,
                    };
                }

                const computeUnits = sim.value.unitsConsumed ?? 0;
                if (computeUnits > 1_400_000) {
                    return {
                        valid: false,
                        reason: `Compute budget too high: ${computeUnits} CU (max 1,400,000)`,
                        computeUnits,
                    };
                }

                return { valid: true, computeUnits };
            } catch (err: any) {
                if (i === maxRetries || !this.isNetworkError(err)) {
                    return {
                        valid: false,
                        reason: `Simulation error: ${err.message}`,
                    };
                }
                await this.sleep(500 * (i + 1));
            }
        }

        return { valid: false, reason: "Simulation failed after retries" };
    }

    /**
     * Determines if an error is retryable (network issues, timeouts, rate limits).
     */
    private isRetryableError(err: any): boolean {
        const msg = err.message?.toLowerCase() || "";
        return (
            msg.includes("timeout") ||
            msg.includes("blockhash not found") ||
            msg.includes("block height exceeded") ||
            msg.includes("too many requests") ||
            msg.includes("429") ||
            msg.includes("503") ||
            msg.includes("network") ||
            msg.includes("econnreset") ||
            msg.includes("econnrefused") ||
            msg.includes("socket hang up")
        );
    }

    private isNetworkError(err: any): boolean {
        return this.isRetryableError(err);
    }

    private computeTxKey(tx: Transaction): string {
        const data = tx.instructions
            .map((ix) => ix.data.toString("hex"))
            .join("-");
        return data;
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}

import {
    Connection,
    Transaction,
    PublicKey,
    LAMPORTS_PER_SOL,
} from "@solana/web3.js";

export interface ValidationResult {
    valid: boolean;
    reason?: string;
    computeUnits?: number;
    estimatedFee?: number;
}

export class RiskEngine {
    private recentTxHashes = new Set<string>();

    constructor(private connection: Connection) { }

    /**
     * Full pre-execution validation:
     * - SOL balance check (minimum 0.01 SOL for fees)
     * - Transaction simulation
     * - Compute budget validation (< 1.4M CU)
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
                reason: "Duplicate transaction detected — skipping",
            };
        }

        // 4. Simulate
        try {
            const sim = await this.connection.simulateTransaction(tx);

            if (sim.value.err) {
                return {
                    valid: false,
                    reason: `Simulation failed: ${JSON.stringify(sim.value.err)}`,
                };
            }

            // 5. Compute budget check
            const computeUnits = sim.value.unitsConsumed ?? 0;
            if (computeUnits > 1_400_000) {
                return {
                    valid: false,
                    reason: `Compute budget too high: ${computeUnits} CU (max 1,400,000)`,
                    computeUnits,
                };
            }

            // 6. Track this tx to prevent duplicates
            this.recentTxHashes.add(txKey);
            // Auto-expire after 60s
            setTimeout(() => this.recentTxHashes.delete(txKey), 60_000);

            return {
                valid: true,
                computeUnits,
                estimatedFee: 5000, // base fee in lamports
            };
        } catch (err: any) {
            return {
                valid: false,
                reason: `Simulation error: ${err.message}`,
            };
        }
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

    private computeTxKey(tx: Transaction): string {
        // Simple hash based on instruction data
        const data = tx.instructions
            .map((ix) => ix.data.toString("hex"))
            .join("-");
        return data;
    }
}

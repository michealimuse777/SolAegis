/**
 * Transaction Simulation — Enforce simulation before ANY on-chain execution.
 * 
 * Before any transfer, swap, or scheduled execution:
 * 1. Build the transaction
 * 2. Call connection.simulateTransaction()
 * 3. If simulation fails → block the transaction
 * 4. Log simulation result to audit log
 * 
 * This prevents failed transactions from wasting SOL on fees
 * and catches errors before they hit the chain.
 */
import { Connection, Transaction, VersionedTransaction, SendOptions } from "@solana/web3.js";

// ─────────── Types ───────────

export interface SimulationResult {
    success: boolean;
    error?: string;
    logs?: string[];
    unitsConsumed?: number;
}

// ─────────── Simulation ───────────

/**
 * Simulate a transaction before sending.
 * Returns simulation result with success/failure and logs.
 */
export async function simulateTransaction(
    connection: Connection,
    transaction: Transaction | VersionedTransaction,
): Promise<SimulationResult> {
    try {
        let result;

        if (transaction instanceof VersionedTransaction) {
            result = await connection.simulateTransaction(transaction, {
                sigVerify: false,
                replaceRecentBlockhash: true,
            });
        } else {
            // Legacy transaction — needs recent blockhash
            if (!transaction.recentBlockhash) {
                const { blockhash } = await connection.getLatestBlockhash("finalized");
                transaction.recentBlockhash = blockhash;
            }
            result = await connection.simulateTransaction(transaction);
        }

        if (result.value.err) {
            return {
                success: false,
                error: typeof result.value.err === "string"
                    ? result.value.err
                    : JSON.stringify(result.value.err),
                logs: result.value.logs || undefined,
                unitsConsumed: result.value.unitsConsumed || undefined,
            };
        }

        return {
            success: true,
            logs: result.value.logs || undefined,
            unitsConsumed: result.value.unitsConsumed || undefined,
        };
    } catch (err: any) {
        return {
            success: false,
            error: `Simulation RPC error: ${err.message}`,
        };
    }
}

/**
 * Validate and simulate a transfer before execution.
 * This is a higher-level check that validates inputs before even building the tx.
 */
export function validateTransferInputs(
    amount: number,
    maxSolPerTx: number,
    balance: number,
): { valid: boolean; error?: string } {
    if (amount <= 0) {
        return { valid: false, error: "Transfer amount must be positive" };
    }
    if (amount > maxSolPerTx) {
        return { valid: false, error: `Amount ${amount} SOL exceeds max per-tx limit of ${maxSolPerTx} SOL` };
    }
    if (amount > balance) {
        return { valid: false, error: `Insufficient balance. Have ${balance} SOL, trying to send ${amount} SOL` };
    }
    // Include fee buffer (0.001 SOL ~= 5000 lamports)
    if (amount + 0.001 > balance) {
        return { valid: false, error: `Insufficient balance for transfer + fees. Have ${balance} SOL, need ${amount + 0.001} SOL` };
    }
    return { valid: true };
}

/**
 * Format simulation result for logging/response.
 */
export function formatSimulationResult(result: SimulationResult): string {
    if (result.success) {
        return `✅ Simulation passed (${result.unitsConsumed || "N/A"} compute units)`;
    }
    return `❌ Simulation FAILED: ${result.error}${result.logs ? "\nLogs: " + result.logs.slice(-3).join("\n") : ""}`;
}

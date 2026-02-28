import { createTransferInstruction } from "@solana/spl-token";
import {
    Keypair,
    PublicKey,
    Transaction,
} from "@solana/web3.js";

export interface SwapParams {
    payer: Keypair;
    userTokenAccountA: PublicKey;   // User's token A account
    userTokenAccountB: PublicKey;   // User's token B account
    poolVaultA: PublicKey;          // Pool's token A vault
    poolVaultB: PublicKey;          // Pool's token B vault
    amountIn: number | bigint;     // Amount of token A to swap in
    amountOut: number | bigint;    // Amount of token B to receive
}

/**
 * Creates a devnet swap transaction.
 * Simplified AMM logic: deposit token A into pool, withdraw token B from pool.
 * In production, this would interact with Raydium/Orca program instructions.
 */
export async function swapTokens(params: SwapParams): Promise<Transaction> {
    const {
        payer,
        userTokenAccountA,
        userTokenAccountB,
        poolVaultA,
        poolVaultB,
        amountIn,
        amountOut,
    } = params;

    const tx = new Transaction();

    // Deposit token A into pool vault
    tx.add(
        createTransferInstruction(
            userTokenAccountA,
            poolVaultA,
            payer.publicKey,
            amountIn
        )
    );

    // Withdraw token B from pool vault  
    tx.add(
        createTransferInstruction(
            poolVaultB,
            userTokenAccountB,
            payer.publicKey,
            amountOut
        )
    );

    return tx;
}

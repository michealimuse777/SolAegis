import { createTransferInstruction } from "@solana/spl-token";
import {
    Keypair,
    PublicKey,
    Transaction,
} from "@solana/web3.js";

export interface LiquidityParams {
    payer: Keypair;
    userTokenAccountA: PublicKey;
    userTokenAccountB: PublicKey;
    poolVaultA: PublicKey;
    poolVaultB: PublicKey;
    amountA: number | bigint;
    amountB: number | bigint;
}

/**
 * Creates a transaction to provide dual-sided liquidity.
 * Deposits both token A and token B into pool vaults.
 */
export async function provideLiquidity(params: LiquidityParams): Promise<Transaction> {
    const {
        payer,
        userTokenAccountA,
        userTokenAccountB,
        poolVaultA,
        poolVaultB,
        amountA,
        amountB,
    } = params;

    const tx = new Transaction();

    // Deposit token A
    tx.add(
        createTransferInstruction(
            userTokenAccountA,
            poolVaultA,
            payer.publicKey,
            amountA
        )
    );

    // Deposit token B
    tx.add(
        createTransferInstruction(
            userTokenAccountB,
            poolVaultB,
            payer.publicKey,
            amountB
        )
    );

    return tx;
}

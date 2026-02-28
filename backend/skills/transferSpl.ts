import {
    getOrCreateAssociatedTokenAccount,
    createTransferInstruction,
} from "@solana/spl-token";
import {
    Connection,
    Keypair,
    PublicKey,
    Transaction,
} from "@solana/web3.js";

export interface TransferParams {
    connection: Connection;
    payer: Keypair;
    mint: PublicKey;
    to: PublicKey;
    amount: number | bigint;
}

/**
 * Creates a transaction to transfer SPL tokens.
 * Automatically creates associated token accounts if they don't exist.
 */
export async function transferSPL(params: TransferParams): Promise<Transaction> {
    const { connection, payer, mint, to, amount } = params;

    // Get or create sender's token account
    const fromAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        mint,
        payer.publicKey
    );

    // Get or create recipient's token account
    const toAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        mint,
        to
    );

    const tx = new Transaction().add(
        createTransferInstruction(
            fromAccount.address,
            toAccount.address,
            payer.publicKey,
            amount
        )
    );

    return tx;
}

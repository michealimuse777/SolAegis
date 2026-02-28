import {
    createCloseAccountInstruction,
} from "@solana/spl-token";
import {
    Connection,
    Keypair,
    PublicKey,
    Transaction,
} from "@solana/web3.js";

export interface RecoveryParams {
    connection: Connection;
    payer: Keypair;
    tokenAccount: PublicKey;
}

/**
 * Creates a transaction to close an empty token account and reclaim its rent SOL.
 * Only works when the token account balance is zero.
 */
export async function recoverRent(params: RecoveryParams): Promise<Transaction> {
    const { payer, tokenAccount } = params;

    const tx = new Transaction().add(
        createCloseAccountInstruction(
            tokenAccount,      // Account to close
            payer.publicKey,    // Destination for rent SOL
            payer.publicKey     // Authority
        )
    );

    return tx;
}

/**
 * Scans for empty token accounts that can be closed to recover rent.
 */
export async function findRecoverableAccounts(
    connection: Connection,
    wallet: PublicKey
): Promise<PublicKey[]> {
    const { TOKEN_PROGRAM_ID } = await import("@solana/spl-token");

    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(wallet, {
        programId: TOKEN_PROGRAM_ID,
    });

    const recoverable: PublicKey[] = [];

    for (const account of tokenAccounts.value) {
        const amount = account.account.data.parsed.info.tokenAmount.uiAmount ?? 0;
        if (amount === 0) {
            recoverable.push(account.pubkey);
        }
    }

    return recoverable;
}

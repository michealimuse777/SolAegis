import {
    createCloseAccountInstruction,
    TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
    Connection,
    Keypair,
    PublicKey,
    Transaction,
    LAMPORTS_PER_SOL,
} from "@solana/web3.js";

export interface RecoveryParams {
    connection: Connection;
    payer: Keypair;
    tokenAccount: PublicKey;
}

export interface RecoverableAccount {
    address: PublicKey;
    mint: string;
    balance: number;
    rentLamports: number;       // Estimated recoverable rent
    type: "empty" | "dust";
}

export interface RecoverySummary {
    totalAccounts: number;
    emptyAccounts: number;
    dustAccounts: number;
    totalRecoverableSOL: number;
    recovered: RecoverableAccount[];
}

const DUST_THRESHOLD = 0.001;  // Tokens worth less than this are dust
const RENT_EXEMPT_MINIMUM = 2_039_280; // ~0.00204 SOL per token account

/**
 * Creates a transaction to close an empty token account and reclaim its rent SOL.
 */
export async function recoverRent(params: RecoveryParams): Promise<Transaction> {
    const { payer, tokenAccount } = params;

    const tx = new Transaction().add(
        createCloseAccountInstruction(
            tokenAccount,
            payer.publicKey,
            payer.publicKey
        )
    );

    return tx;
}

/**
 * Advanced: Scans for ALL recoverable accounts:
 * - Zero-balance accounts (can close immediately)
 * - Dust accounts (balance < threshold, can send dust then close)
 * - Stranded lamport remnants
 */
export async function findAllRecoverable(
    connection: Connection,
    wallet: PublicKey,
    dustThreshold: number = DUST_THRESHOLD
): Promise<RecoverableAccount[]> {
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(wallet, {
        programId: TOKEN_PROGRAM_ID,
    });

    const recoverable: RecoverableAccount[] = [];

    for (const account of tokenAccounts.value) {
        const info = account.account.data.parsed.info;
        const amount = info.tokenAmount.uiAmount ?? 0;
        const mint = info.mint as string;
        const rentLamports = account.account.lamports;

        if (amount === 0) {
            recoverable.push({
                address: account.pubkey,
                mint,
                balance: 0,
                rentLamports,
                type: "empty",
            });
        } else if (amount > 0 && amount < dustThreshold) {
            recoverable.push({
                address: account.pubkey,
                mint,
                balance: amount,
                rentLamports,
                type: "dust",
            });
        }
    }

    return recoverable;
}

/**
 * Batch recovery: closes multiple empty token accounts in one transaction.
 * Returns a single transaction with multiple close instructions.
 * Max 10 accounts per transaction to stay within compute limits.
 */
export async function batchRecover(
    connection: Connection,
    payer: Keypair,
    accounts: PublicKey[]
): Promise<{ tx: Transaction; count: number; estimatedSOL: number }> {
    const batch = accounts.slice(0, 10); // Max 10 per tx
    const tx = new Transaction();

    for (const account of batch) {
        tx.add(
            createCloseAccountInstruction(
                account,
                payer.publicKey,
                payer.publicKey
            )
        );
    }

    const estimatedSOL = (batch.length * RENT_EXEMPT_MINIMUM) / LAMPORTS_PER_SOL;

    return { tx, count: batch.length, estimatedSOL };
}

/**
 * Full recovery summary: scans, categorizes, and reports all recoverable value.
 */
export async function getRecoverySummary(
    connection: Connection,
    wallet: PublicKey
): Promise<RecoverySummary> {
    const recoverable = await findAllRecoverable(connection, wallet);

    const emptyAccounts = recoverable.filter(a => a.type === "empty");
    const dustAccounts = recoverable.filter(a => a.type === "dust");
    const totalRecoverableSOL = recoverable.reduce(
        (sum, a) => sum + a.rentLamports / LAMPORTS_PER_SOL, 0
    );

    return {
        totalAccounts: recoverable.length,
        emptyAccounts: emptyAccounts.length,
        dustAccounts: dustAccounts.length,
        totalRecoverableSOL,
        recovered: recoverable,
    };
}

/**
 * Detects stranded lamport dust in the main SOL account.
 * Returns amount below the minimum useful threshold.
 */
export async function detectStrandedLamports(
    connection: Connection,
    wallet: PublicKey,
    minUsefulSOL: number = 0.001
): Promise<{ stranded: boolean; amount: number }> {
    const balance = await connection.getBalance(wallet);
    const solBalance = balance / LAMPORTS_PER_SOL;

    if (solBalance > 0 && solBalance < minUsefulSOL) {
        return { stranded: true, amount: solBalance };
    }

    return { stranded: false, amount: 0 };
}

import {
    Connection,
    PublicKey,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

export interface AirdropScanResult {
    mint: string;
    account: string;
    amount: number;
    suspicious: boolean;
    reason?: string;
}

/**
 * Scans all token accounts owned by a wallet.
 * Identifies suspicious dust tokens and potential airdrops.
 */
export async function scanAirdrops(
    connection: Connection,
    wallet: PublicKey
): Promise<AirdropScanResult[]> {
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(wallet, {
        programId: TOKEN_PROGRAM_ID,
    });

    const results: AirdropScanResult[] = [];

    for (const account of tokenAccounts.value) {
        const parsed = account.account.data.parsed;
        const info = parsed.info;
        const amount = info.tokenAmount.uiAmount ?? 0;
        const mint = info.mint;

        let suspicious = false;
        let reason: string | undefined;

        // Flag dust amounts (potential airdrop spam / scam)
        if (amount > 0 && amount < 0.0001) {
            suspicious = true;
            reason = "Dust amount — possible airdrop spam";
        }

        // Flag very large amounts from unknown sources
        if (amount > 1_000_000_000) {
            suspicious = true;
            reason = "Abnormally large balance — possible scam token";
        }

        results.push({
            mint,
            account: account.pubkey.toBase58(),
            amount,
            suspicious,
            reason,
        });
    }

    return results;
}

/**
 * Filters only suspicious/claimable tokens from scan results.
 */
export function filterSuspicious(results: AirdropScanResult[]): AirdropScanResult[] {
    return results.filter((r) => r.suspicious);
}

/**
 * Filters only safe, non-suspicious tokens.
 */
export function filterSafe(results: AirdropScanResult[]): AirdropScanResult[] {
    return results.filter((r) => !r.suspicious);
}

import { getMint } from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";

export interface TokenSafetyResult {
    safe: boolean;
    reason?: string;
    details: {
        hasFreezeAuthority: boolean;
        hasMintAuthority: boolean;
        supply: bigint;
        decimals: number;
    };
}

/**
 * Performs heuristic safety checks on a token mint.
 * 
 * Flags:
 * - Freeze authority enabled (can freeze your tokens)
 * - Mint authority still active (can inflate supply)
 * - Suspicious large supply (> 1 trillion)
 * - Unusual decimals
 */
export async function checkTokenSafety(
    connection: Connection,
    mintAddress: PublicKey
): Promise<TokenSafetyResult> {
    try {
        const mint = await getMint(connection, mintAddress);

        const details = {
            hasFreezeAuthority: mint.freezeAuthority !== null,
            hasMintAuthority: mint.mintAuthority !== null,
            supply: mint.supply,
            decimals: mint.decimals,
        };

        // Check freeze authority
        if (mint.freezeAuthority !== null) {
            return {
                safe: false,
                reason: "Freeze authority enabled — token holder funds can be frozen",
                details,
            };
        }

        // Check mint authority
        if (mint.mintAuthority !== null) {
            return {
                safe: false,
                reason: "Mint authority still active — supply can be inflated",
                details,
            };
        }

        // Check suspicious supply
        if (mint.supply > 1_000_000_000_000n) {
            return {
                safe: false,
                reason: `Suspicious large supply: ${mint.supply.toString()}`,
                details,
            };
        }

        // Check unusual decimals
        if (mint.decimals > 18) {
            return {
                safe: false,
                reason: `Unusual decimals: ${mint.decimals}`,
                details,
            };
        }

        return { safe: true, details };
    } catch (err: any) {
        return {
            safe: false,
            reason: `Failed to fetch mint data: ${err.message}`,
            details: {
                hasFreezeAuthority: false,
                hasMintAuthority: false,
                supply: 0n,
                decimals: 0,
            },
        };
    }
}

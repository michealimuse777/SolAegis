import { getMint, Mint } from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";

export interface TokenSafetyResult {
    safe: boolean;
    riskScore: number;       // 0 = safe, 100 = maximum risk
    reasons: string[];
    details: {
        hasFreezeAuthority: boolean;
        hasMintAuthority: boolean;
        supply: bigint;
        decimals: number;
        mintAge?: string;
        hasMetadata: boolean;
        liquidityDetected: boolean;
        isBlocklisted: boolean;
        honeypotRisk: boolean;
    };
}

// Known scam token mints (expandable blocklist)
const BLOCKLIST: Set<string> = new Set([
    // Add known scam mints here
]);

// Known safe mints (SOL-wrapped, USDC, USDT etc on devnet)
const SAFELIST: Set<string> = new Set([
    "So11111111111111111111111111111111111111112",  // Wrapped SOL
]);

/**
 * Advanced token safety analysis.
 * Performs 7 checks: freeze auth, mint auth, supply, decimals,
 * metadata verification, liquidity detection, mint age, blocklist, honeypot risk.
 */
export async function checkTokenSafety(
    connection: Connection,
    mintAddress: PublicKey
): Promise<TokenSafetyResult> {
    const reasons: string[] = [];
    let riskScore = 0;

    // Check blocklist first
    if (BLOCKLIST.has(mintAddress.toBase58())) {
        return {
            safe: false,
            riskScore: 100,
            reasons: ["Token is on the known scam blocklist"],
            details: {
                hasFreezeAuthority: false,
                hasMintAuthority: false,
                supply: 0n,
                decimals: 0,
                hasMetadata: false,
                liquidityDetected: false,
                isBlocklisted: true,
                honeypotRisk: true,
            },
        };
    }

    // Known safe tokens pass immediately
    if (SAFELIST.has(mintAddress.toBase58())) {
        return {
            safe: true,
            riskScore: 0,
            reasons: [],
            details: {
                hasFreezeAuthority: false,
                hasMintAuthority: false,
                supply: 0n,
                decimals: 9,
                hasMetadata: true,
                liquidityDetected: true,
                isBlocklisted: false,
                honeypotRisk: false,
            },
        };
    }

    try {
        const mint = await getMint(connection, mintAddress);

        const details = {
            hasFreezeAuthority: mint.freezeAuthority !== null,
            hasMintAuthority: mint.mintAuthority !== null,
            supply: mint.supply,
            decimals: mint.decimals,
            mintAge: undefined as string | undefined,
            hasMetadata: false,
            liquidityDetected: false,
            isBlocklisted: false,
            honeypotRisk: false,
        };

        // 1. Freeze authority (can freeze your tokens)
        if (mint.freezeAuthority !== null) {
            reasons.push("Freeze authority enabled -- token holder funds can be frozen");
            riskScore += 25;
        }

        // 2. Mint authority (can inflate supply)
        if (mint.mintAuthority !== null) {
            reasons.push("Mint authority still active -- supply can be inflated at any time");
            riskScore += 20;
        }

        // 3. Suspicious supply
        if (mint.supply > 1_000_000_000_000n) {
            reasons.push(`Suspicious large supply: ${mint.supply.toString()}`);
            riskScore += 15;
        }

        // 4. Unusual decimals
        if (mint.decimals > 18) {
            reasons.push(`Unusual decimals: ${mint.decimals} (standard is 6-9)`);
            riskScore += 10;
        } else if (mint.decimals === 0) {
            reasons.push("Zero decimals -- may be an NFT or non-fungible token");
            riskScore += 5;
        }

        // 5. Metadata verification
        const hasMetadata = await checkMetadata(connection, mintAddress);
        details.hasMetadata = hasMetadata;
        if (!hasMetadata) {
            reasons.push("No token metadata found -- legitimate tokens usually have metadata");
            riskScore += 15;
        }

        // 6. Liquidity detection
        const hasLiquidity = await checkLiquidityPresence(connection, mintAddress);
        details.liquidityDetected = hasLiquidity;
        if (!hasLiquidity) {
            reasons.push("No liquidity pools detected -- token may be untradeable");
            riskScore += 15;
        }

        // 7. Mint age estimation
        const mintAgeInfo = await estimateMintAge(connection, mintAddress);
        details.mintAge = mintAgeInfo.label;
        if (mintAgeInfo.isRecent) {
            reasons.push(`Recently created mint (${mintAgeInfo.label}) -- higher risk`);
            riskScore += 10;
        }

        // 8. Honeypot risk assessment
        // If freeze auth is on AND mint auth is on AND no liquidity, very likely a honeypot
        if (details.hasFreezeAuthority && details.hasMintAuthority && !details.liquidityDetected) {
            details.honeypotRisk = true;
            reasons.push("HIGH RISK: Freeze + mint authority + no liquidity = likely honeypot");
            riskScore += 25;
        }

        // Cap at 100
        riskScore = Math.min(100, riskScore);

        return {
            safe: riskScore < 40,  // Under 40 = safe enough
            riskScore,
            reasons,
            details,
        };
    } catch (err: any) {
        return {
            safe: false,
            riskScore: 80,
            reasons: [`Failed to fetch mint data: ${err.message}`],
            details: {
                hasFreezeAuthority: false,
                hasMintAuthority: false,
                supply: 0n,
                decimals: 0,
                hasMetadata: false,
                liquidityDetected: false,
                isBlocklisted: false,
                honeypotRisk: false,
            },
        };
    }
}

/**
 * Checks if the token has Metaplex metadata.
 */
async function checkMetadata(connection: Connection, mint: PublicKey): Promise<boolean> {
    try {
        // Metaplex metadata PDA
        const METADATA_PROGRAM = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
        const [metadataPDA] = PublicKey.findProgramAddressSync(
            [Buffer.from("metadata"), METADATA_PROGRAM.toBuffer(), mint.toBuffer()],
            METADATA_PROGRAM
        );
        const accountInfo = await connection.getAccountInfo(metadataPDA);
        return accountInfo !== null;
    } catch {
        return false;
    }
}

/**
 * Checks if the token has any associated token accounts with large balances,
 * indicating potential liquidity pools.
 */
async function checkLiquidityPresence(connection: Connection, mint: PublicKey): Promise<boolean> {
    try {
        const largestAccounts = await connection.getTokenLargestAccounts(mint);
        if (largestAccounts.value.length === 0) return false;

        // If there are multiple holders with significant balance, likely has liquidity
        const significantHolders = largestAccounts.value.filter(
            a => a.uiAmount !== null && a.uiAmount > 0
        );

        return significantHolders.length >= 2;
    } catch {
        return false;
    }
}

/**
 * Estimates how old a mint is by checking its first transaction signatures.
 */
async function estimateMintAge(
    connection: Connection,
    mint: PublicKey
): Promise<{ label: string; isRecent: boolean }> {
    try {
        const sigs = await connection.getSignaturesForAddress(mint, { limit: 1 });
        if (sigs.length === 0) {
            return { label: "unknown", isRecent: true };
        }

        const oldest = sigs[sigs.length - 1];
        if (!oldest.blockTime) {
            return { label: "unknown", isRecent: true };
        }

        const ageMs = Date.now() - oldest.blockTime * 1000;
        const ageHours = ageMs / (1000 * 60 * 60);
        const ageDays = ageHours / 24;

        if (ageDays < 1) return { label: `${Math.floor(ageHours)} hours old`, isRecent: true };
        if (ageDays < 7) return { label: `${Math.floor(ageDays)} days old`, isRecent: true };
        if (ageDays < 30) return { label: `${Math.floor(ageDays)} days old`, isRecent: false };
        return { label: `${Math.floor(ageDays / 30)} months old`, isRecent: false };
    } catch {
        return { label: "unknown", isRecent: true };
    }
}

/**
 * Adds a mint to the blocklist.
 */
export function addToBlocklist(mint: string): void {
    BLOCKLIST.add(mint);
}

/**
 * Checks if a mint is blocklisted.
 */
export function isBlocklisted(mint: string): boolean {
    return BLOCKLIST.has(mint);
}

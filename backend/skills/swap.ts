/**
 * Orca Whirlpools Swap — Devnet-compatible token swaps via Orca's concentrated liquidity.
 * 
 * Why Orca Whirlpools:
 * - Same program ID on devnet & mainnet (whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc)
 * - Built-in devnet support with existing liquidity pools
 * - Direct pool execution (no aggregator routing = smaller tx, fewer errors)
 * - Uses @orca-so/whirlpools-sdk v0.20 (compatible with @solana/web3.js v1)
 * 
 * Devnet token mints (Orca's devTokens):
 *   SOL     = So11111111111111111111111111111111111111112
 *   devUSDC = 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
 *   devUSDT = H9gBUDs5KnAXGPXrYsRsdkQ7sAfhDjQXiMVt5G5cMiee
 *   devSAMO = Jd4M8bfJG3sAkd82RkGRyRBSiS2XscMB4SSCQU2hLk2X
 *   devTMAC = Afn8YB1p4NsoZeWC1GPhsUGQ5ys4VrB9ojNZ6aQ5pump
 */
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import {
    WhirlpoolContext,
    PDAUtil,
    swapQuoteByInputToken,
    buildWhirlpoolClient,
    ORCA_WHIRLPOOL_PROGRAM_ID,
} from "@orca-so/whirlpools-sdk";
import { DecimalUtil, Percentage } from "@orca-so/common-sdk";
import Decimal from "decimal.js";

// ─────────── Constants ───────────

// Orca's devnet Whirlpools config address
const DEVNET_WHIRLPOOLS_CONFIG = new PublicKey("FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR");

// Known devnet token mints
export const DEVNET_TOKENS: Record<string, { mint: string; decimals: number; name: string }> = {
    SOL: { mint: "So11111111111111111111111111111111111111112", decimals: 9, name: "SOL" },
    devUSDC: { mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", decimals: 6, name: "devUSDC" },
    devUSDT: { mint: "H9gBUDs5KnAXGPXrYsRsdkQ7sAfhDjQXiMVt5G5cMiee", decimals: 6, name: "devUSDT" },
    devSAMO: { mint: "Jd4M8bfJG3sAkd82RkGRyRBSiS2XscMB4SSCQU2hLk2X", decimals: 9, name: "devSAMO" },
    devTMAC: { mint: "Afn8YB1p4NsoZeWC1GPhsUGQ5ys4VrB9ojNZ6aQ5pump", decimals: 6, name: "devTMAC" },
};

// Common tick spacings to try when finding pools
const TICK_SPACINGS = [1, 8, 16, 64, 128, 256];

// ─────────── Types ───────────

export interface SwapParams {
    connection: Connection;
    payer: Keypair;
    inputMint: string;
    outputMint: string;
    amount: number;         // Human-readable amount (e.g., 0.1 SOL)
    slippageBps?: number;   // Slippage tolerance in basis points (default: 100 = 1%)
}

export interface SwapResult {
    signature: string;
    inputMint: string;
    outputMint: string;
    pool: string;
    route: string;
    estimatedOutput?: string;
}

// ─────────── Helpers ───────────

/**
 * Resolve a token symbol or mint address to a PublicKey + decimals.
 */
function resolveToken(mintOrSymbol: string): { mint: PublicKey; decimals: number } {
    // Check known devnet tokens (case-insensitive)
    for (const [key, val] of Object.entries(DEVNET_TOKENS)) {
        if (key.toLowerCase() === mintOrSymbol.toLowerCase() || val.mint === mintOrSymbol) {
            return { mint: new PublicKey(val.mint), decimals: val.decimals };
        }
    }
    // Assume raw mint address with unknown decimals (default 9)
    return { mint: new PublicKey(mintOrSymbol), decimals: 9 };
}

/**
 * Find a Whirlpool PDA for a given token pair — tries multiple tick spacings.
 */
async function findWhirlpoolAddress(
    connection: Connection,
    tokenMintA: PublicKey,
    tokenMintB: PublicKey,
): Promise<{ address: PublicKey; tickSpacing: number } | null> {
    // Whirlpool PDAs require tokens sorted by bytes
    const [sortedA, sortedB] = tokenMintA.toBuffer().compare(tokenMintB.toBuffer()) < 0
        ? [tokenMintA, tokenMintB]
        : [tokenMintB, tokenMintA];

    for (const tickSpacing of TICK_SPACINGS) {
        const pda = PDAUtil.getWhirlpool(
            ORCA_WHIRLPOOL_PROGRAM_ID,
            DEVNET_WHIRLPOOLS_CONFIG,
            sortedA,
            sortedB,
            tickSpacing,
        );

        try {
            const accountInfo = await connection.getAccountInfo(pda.publicKey);
            if (accountInfo && accountInfo.data.length > 0) {
                console.log(`[OrcaSwap] Found pool: ${pda.publicKey.toBase58()} (tickSpacing: ${tickSpacing})`);
                return { address: pda.publicKey, tickSpacing };
            }
        } catch (e) {
            // Continue to next tick spacing
        }
    }

    return null;
}

// ─────────── Main Swap Function ───────────

/**
 * Execute a token swap via Orca Whirlpools on devnet.
 * 
 * Flow:
 * 1. Create WhirlpoolContext using WhirlpoolContext.from()
 * 2. Find pool PDA for the token pair
 * 3. Get swap quote (with slippage)
 * 4. Build and send swap transaction
 */
export async function swapTokens(params: SwapParams): Promise<SwapResult> {
    const { connection, payer, inputMint, outputMint, amount, slippageBps = 100 } = params;

    // Resolve tokens
    const inputToken = resolveToken(inputMint);
    const outputToken = resolveToken(outputMint);

    console.log(`[OrcaSwap] Swapping ${amount} ${inputMint} → ${outputMint}`);
    console.log(`[OrcaSwap]   Input:  ${inputToken.mint.toBase58()} (${inputToken.decimals} decimals)`);
    console.log(`[OrcaSwap]   Output: ${outputToken.mint.toBase58()} (${outputToken.decimals} decimals)`);

    // Step 1: Create context
    const wallet = new Wallet(payer);
    const ctx = WhirlpoolContext.from(connection, wallet);
    const client = buildWhirlpoolClient(ctx);

    // Step 2: Try all tick spacings to find a working pool
    const [sortedA, sortedB] = inputToken.mint.toBuffer().compare(outputToken.mint.toBuffer()) < 0
        ? [inputToken.mint, outputToken.mint]
        : [outputToken.mint, inputToken.mint];

    const inputAmount = DecimalUtil.toBN(new Decimal(amount), inputToken.decimals);
    const slippage = Percentage.fromFraction(slippageBps, 10000);

    let lastError = "";

    for (const tickSpacing of TICK_SPACINGS) {
        const pda = PDAUtil.getWhirlpool(
            ORCA_WHIRLPOOL_PROGRAM_ID,
            DEVNET_WHIRLPOOLS_CONFIG,
            sortedA,
            sortedB,
            tickSpacing,
        );

        // Check if pool exists
        const accountInfo = await connection.getAccountInfo(pda.publicKey);
        if (!accountInfo || accountInfo.data.length === 0) continue;

        console.log(`[OrcaSwap] Trying pool ${pda.publicKey.toBase58()} (tickSpacing: ${tickSpacing})`);

        try {
            const whirlpool = await client.getPool(pda.publicKey);

            console.log(`[OrcaSwap] Getting quote for ${inputAmount.toString()} (raw) with ${slippageBps}bps slippage...`);

            const quote = await swapQuoteByInputToken(
                whirlpool,
                inputToken.mint,
                inputAmount,
                slippage,
                ctx.program.programId,
                ctx.fetcher,
                { maxStaleness: 30000 } as any,  // Allow slightly stale data
            );

            const estOutput = DecimalUtil.fromBN(quote.estimatedAmountOut, outputToken.decimals).toString();
            console.log(`[OrcaSwap] Quote: input=${quote.estimatedAmountIn.toString()}, output=${quote.estimatedAmountOut.toString()} (${estOutput} human)`);

            // Step 4: Build and execute
            const tx = await whirlpool.swap(quote);
            const signature = await tx.buildAndExecute();

            await connection.confirmTransaction(signature, "confirmed");
            console.log(`[OrcaSwap] ✅ Swap confirmed: ${signature}`);

            return {
                signature,
                inputMint: inputToken.mint.toBase58(),
                outputMint: outputToken.mint.toBase58(),
                pool: pda.publicKey.toBase58(),
                route: `Orca Whirlpool (tickSpacing: ${tickSpacing})`,
                estimatedOutput: estOutput,
            };
        } catch (err: any) {
            lastError = err.message;
            console.warn(`[OrcaSwap] Pool tickSpacing=${tickSpacing} failed: ${err.message}`);
            continue; // Try next tick spacing
        }
    }

    const available = Object.keys(DEVNET_TOKENS).join(", ");
    throw new Error(
        `Orca swap failed for ${inputMint} → ${outputMint}: ${lastError}. ` +
        `Available devnet tokens: ${available}.`
    );
}

/**
 * List available Orca devnet tokens.
 */
export function listAvailableTokens(): typeof DEVNET_TOKENS {
    return DEVNET_TOKENS;
}

/**
 * Creates a pool — not needed for Orca Whirlpools (pools already exist on devnet).
 */
export async function createPool(
    _connection: Connection,
    _payer: Keypair,
    _tokenMintA: string,
    _tokenMintB: string,
    _initialAmountA: number,
    _initialAmountB: number,
): Promise<any> {
    throw new Error(
        "Pool creation not needed with Orca Whirlpools. " +
        "Orca maintains devnet pools for SOL/devUSDC, SOL/devUSDT, SOL/devSAMO, and SOL/devTMAC. " +
        "Simply swap between these pairs directly."
    );
}

export function listPools(): any[] {
    return Object.entries(DEVNET_TOKENS).map(([symbol, info]) => ({
        id: symbol,
        tokenMintA: DEVNET_TOKENS.SOL.mint,
        tokenMintB: info.mint,
        name: `SOL/${symbol}`,
        source: "Orca Whirlpools (devnet)",
    })).filter(p => p.id !== "SOL");
}

export function findPool(inputMint: string, outputMint: string): any {
    const pools = listPools();
    return pools.find(p =>
        (p.tokenMintA === inputMint && p.tokenMintB === outputMint) ||
        (p.tokenMintA === outputMint && p.tokenMintB === inputMint)
    ) || null;
}

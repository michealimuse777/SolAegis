import { Connection, Keypair } from "@solana/web3.js";
import { executePoolSwap, findPool, createSwapPool, listPools, PoolInfo } from "./tokenSwapPool.js";

export interface SwapParams {
    connection: Connection;
    payer: Keypair;
    inputMint: string;      // Token mint to sell (or create pool with)
    outputMint: string;     // Token mint to buy (or create pool with)
    amount: number;         // Raw token amount to swap
    slippageBps?: number;   // Not used for SPL Token Swap (accepts any)
}

export interface SwapResult {
    signature: string;
    inputMint: string;
    outputMint: string;
    pool: string;
    route: string;
}

/**
 * Executes a swap via SPL Token Swap on devnet.
 * If no pool exists for the pair, throws with instructions.
 */
export async function swapTokens(params: SwapParams): Promise<SwapResult> {
    const { connection, payer, inputMint, outputMint, amount } = params;

    // Find existing pool for this pair
    const pool = findPool(inputMint, outputMint);
    if (!pool) {
        const pools = listPools();
        const available = pools.length > 0
            ? pools.map(p => `${p.tokenMintA.slice(0, 8)}...↔${p.tokenMintB.slice(0, 8)}...`).join(", ")
            : "none";
        throw new Error(`No pool found for ${inputMint.slice(0, 8)}...↔${outputMint.slice(0, 8)}... Available pools: ${available}. Create a pool first via /api/pools/create.`);
    }

    const { signature } = await executePoolSwap(
        connection, payer, pool.tokenSwapAddress, inputMint, amount,
    );

    return {
        signature,
        inputMint,
        outputMint,
        pool: pool.tokenSwapAddress,
        route: "SPL Token Swap (Constant Product AMM)",
    };
}

/**
 * Creates a new swap pool and returns its info.
 */
export async function createPool(
    connection: Connection,
    payer: Keypair,
    tokenMintA: string,
    tokenMintB: string,
    initialAmountA: number,
    initialAmountB: number,
): Promise<PoolInfo> {
    return createSwapPool(connection, payer, tokenMintA, tokenMintB, initialAmountA, initialAmountB);
}

/**
 * Gets all available pools.
 */
export { listPools } from "./tokenSwapPool.js";
export { findPool } from "./tokenSwapPool.js";

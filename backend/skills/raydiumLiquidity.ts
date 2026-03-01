import {
    Connection,
    Keypair,
    PublicKey,
    clusterApiUrl,
} from "@solana/web3.js";
import { Raydium, TxVersion } from "@raydium-io/raydium-sdk-v2";
import BN from "bn.js";

let raydiumInstance: Raydium | null = null;

/**
 * Initialize the Raydium SDK for devnet.
 */
async function getRaydium(connection: Connection, owner: Keypair): Promise<Raydium> {
    if (!raydiumInstance) {
        raydiumInstance = await Raydium.load({
            connection,
            owner,
            cluster: "devnet",
            disableFeatureCheck: true,
            blockhashCommitment: "finalized",
        });
    }
    return raydiumInstance;
}

export interface LiquidityResult {
    success: boolean;
    signature?: string;
    message: string;
    poolId?: string;
}

/**
 * Creates a new CLMM pool on Raydium devnet.
 */
export async function createRaydiumPool(
    connection: Connection,
    payer: Keypair,
    mintA: string,
    mintB: string,
    initialPrice: number,
): Promise<LiquidityResult> {
    try {
        const raydium = await getRaydium(connection, payer);

        // Get mint info
        const mintInfoA = await raydium.token.getTokenInfo(mintA);
        const mintInfoB = await raydium.token.getTokenInfo(mintB);

        if (!mintInfoA || !mintInfoB) {
            return { success: false, message: "One or both token mints not found on devnet" };
        }

        // Create CLMM pool
        const { execute, extInfo } = await raydium.clmm.createPool({
            programId: new PublicKey("devi51mZmdwUJGU9hjN27vEz64Gps7uUefqxBMY9cnR"), // Raydium devnet CLMM
            mint1: { address: mintA, decimals: mintInfoA.decimals, programId: mintInfoA.programId },
            mint2: { address: mintB, decimals: mintInfoB.decimals, programId: mintInfoB.programId },
            ammConfig: {
                id: new PublicKey("CQYbhr6amPayMsMDvWpqFijHcBfoVudeQBfFCqgFzNnq"), // devnet config
                index: 0,
                protocolFeeRate: 120000,
                tradeFeeRate: 100,
                tickSpacing: 10,
                fundFeeRate: 0,
                fundOwner: "",
                description: "",
            },
            initialPrice: new BN(Math.floor(initialPrice * 1e9)),
            startTime: new BN(0),
            txVersion: TxVersion.V0,
        });

        const { txIds } = await execute({ sequentially: true });
        const poolId = extInfo?.mockPoolInfo?.id;

        return {
            success: true,
            signature: txIds[0],
            message: `CLMM pool created`,
            poolId: poolId || "unknown",
        };
    } catch (err: any) {
        return { success: false, message: `Failed to create Raydium pool: ${err.message}` };
    }
}

/**
 * Adds liquidity to a Raydium CLMM pool.
 */
export async function addLiquidity(
    connection: Connection,
    payer: Keypair,
    poolId: string,
    amountA: number,
    amountB: number,
    priceLower: number,
    priceUpper: number,
): Promise<LiquidityResult> {
    try {
        const raydium = await getRaydium(connection, payer);

        // Fetch pool info
        let poolInfo;
        try {
            const data = await raydium.api.fetchPoolById({ ids: poolId });
            poolInfo = data[0];
        } catch {
            // If API fails on devnet, try RPC
            const data = await raydium.clmm.getPoolInfoFromRpc(poolId);
            poolInfo = data.poolInfo;
        }

        if (!poolInfo) {
            return { success: false, message: `Pool ${poolId} not found` };
        }

        // Open position with liquidity
        const { execute } = await raydium.clmm.openPositionFromBase({
            poolInfo: poolInfo as any,
            ownerInfo: {
                useSOLBalance: true,
            },
            base: "MintA",
            baseAmount: new BN(amountA),
            priceLower: new BN(Math.floor(priceLower * 1e9)),
            priceUpper: new BN(Math.floor(priceUpper * 1e9)),
            txVersion: TxVersion.V0,
        });

        const { txIds } = await execute({ sequentially: true });

        return {
            success: true,
            signature: txIds[0],
            message: `Added liquidity to pool ${poolId.slice(0, 8)}...`,
            poolId,
        };
    } catch (err: any) {
        return { success: false, message: `Failed to add liquidity: ${err.message}` };
    }
}

/**
 * Removes liquidity from a Raydium CLMM position.
 */
export async function removeLiquidity(
    connection: Connection,
    payer: Keypair,
    poolId: string,
    positionNftMint: string,
    percentage: number, // 0-100
): Promise<LiquidityResult> {
    try {
        const raydium = await getRaydium(connection, payer);

        // Fetch pool info
        let poolInfo;
        try {
            const data = await raydium.api.fetchPoolById({ ids: poolId });
            poolInfo = data[0];
        } catch {
            const data = await raydium.clmm.getPoolInfoFromRpc(poolId);
            poolInfo = data.poolInfo;
        }

        if (!poolInfo) {
            return { success: false, message: `Pool ${poolId} not found` };
        }

        // Decrease liquidity from position
        const bps = Math.floor(percentage * 100); // percentage to bps (100% = 10000)
        const { execute } = await raydium.clmm.decreaseLiquidity({
            poolInfo: poolInfo as any,
            ownerPosition: { nftMint: new PublicKey(positionNftMint) } as any,
            liquidity: new BN(bps),
            amountMinA: new BN(0),
            amountMinB: new BN(0),
            txVersion: TxVersion.V0,
        });

        const { txIds } = await execute({ sequentially: true });

        return {
            success: true,
            signature: txIds[0],
            message: `Removed ${percentage}% liquidity from pool ${poolId.slice(0, 8)}...`,
            poolId,
        };
    } catch (err: any) {
        return { success: false, message: `Failed to remove liquidity: ${err.message}` };
    }
}

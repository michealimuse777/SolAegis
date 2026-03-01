import {
    Connection,
    Keypair,
    PublicKey,
    SystemProgram,
    Transaction,
    sendAndConfirmTransaction,
    LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
    TOKEN_PROGRAM_ID,
    createMint,
    createAccount,
    mintTo,
    getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import {
    TokenSwap,
    CurveType,
    TOKEN_SWAP_PROGRAM_ID,
} from "@solana/spl-token-swap";
import * as fs from "fs";
import * as path from "path";

const POOLS_FILE = path.join(process.cwd(), ".pools.json");

export interface PoolInfo {
    poolAddress: string;
    tokenSwapAddress: string;
    authority: string;
    tokenMintA: string;
    tokenMintB: string;
    tokenAccountA: string;
    tokenAccountB: string;
    poolMint: string;
    feeAccount: string;
    createdAt: number;
}

// In-memory pool registry
let poolRegistry: PoolInfo[] = [];

function loadPools() {
    try {
        if (fs.existsSync(POOLS_FILE)) {
            poolRegistry = JSON.parse(fs.readFileSync(POOLS_FILE, "utf-8"));
            console.log(`[PoolRegistry] Loaded ${poolRegistry.length} pool(s)`);
        }
    } catch { }
}

function savePools() {
    try {
        fs.writeFileSync(POOLS_FILE, JSON.stringify(poolRegistry, null, 2), "utf-8");
    } catch { }
}

loadPools();

/**
 * Creates an SPL Token Swap pool between two token mints on devnet.
 * Seeds both sides with initial liquidity.
 */
export async function createSwapPool(
    connection: Connection,
    payer: Keypair,
    tokenMintA: string,
    tokenMintB: string,
    initialAmountA: number,
    initialAmountB: number,
): Promise<PoolInfo> {
    const mintA = new PublicKey(tokenMintA);
    const mintB = new PublicKey(tokenMintB);

    // 1. Create the token swap state account
    const tokenSwapAccount = Keypair.generate();

    // 2. Derive the swap authority PDA
    const [authority, bumpSeed] = PublicKey.findProgramAddressSync(
        [tokenSwapAccount.publicKey.toBuffer()],
        TOKEN_SWAP_PROGRAM_ID,
    );

    // 3. Create pool token accounts owned by authority PDA (allowOwnerOffCurve: true)
    const tokenAccountAInfo = await getOrCreateAssociatedTokenAccount(
        connection, payer, mintA, authority, true,
    );
    const tokenAccountBInfo = await getOrCreateAssociatedTokenAccount(
        connection, payer, mintB, authority, true,
    );
    const tokenAccountA = tokenAccountAInfo.address;
    const tokenAccountB = tokenAccountBInfo.address;
    console.log("[PoolCreate] Created pool vault accounts");

    // 4. Fund pool token accounts with initial liquidity
    const NATIVE_MINT = "So11111111111111111111111111111111111111112";
    const { createTransferInstruction, createSyncNativeInstruction } = await import("@solana/spl-token");

    for (const [mint, mintStr, amount, poolAccount] of [
        [mintA, tokenMintA, initialAmountA, tokenAccountA],
        [mintB, tokenMintB, initialAmountB, tokenAccountB],
    ] as const) {
        if (mintStr === NATIVE_MINT) {
            // Transfer SOL directly into pool vault (WSOL account) + sync
            const wrapTx = new Transaction();
            wrapTx.add(
                SystemProgram.transfer({
                    fromPubkey: payer.publicKey,
                    toPubkey: poolAccount,
                    lamports: amount,
                }),
                createSyncNativeInstruction(poolAccount),
            );
            await sendAndConfirmTransaction(connection, wrapTx, [payer]);
        } else {
            const payerAta = await getOrCreateAssociatedTokenAccount(connection, payer, mint, payer.publicKey);
            const fundTx = new Transaction();
            fundTx.add(createTransferInstruction(payerAta.address, poolAccount, payer.publicKey, BigInt(amount)));
            await sendAndConfirmTransaction(connection, fundTx, [payer]);
        }
    }
    console.log("[PoolCreate] Funded both pool token accounts");

    // 5. Create pool token mint (LP tokens)
    const poolMint = await createMint(connection, payer, authority, null, 9);

    // 6. Create fee and recipient accounts for LP tokens
    const feeAccountInfo = await getOrCreateAssociatedTokenAccount(
        connection, payer, poolMint, payer.publicKey,
    );
    // Recipient needs a separate account (can't reuse fee account)
    const poolTokenRecipientKeypair = Keypair.generate();
    const { createInitializeAccountInstruction, getMinimumBalanceForRentExemptAccount } = await import("@solana/spl-token");
    const accountLamports = await getMinimumBalanceForRentExemptAccount(connection);
    const recipientTx = new Transaction().add(
        SystemProgram.createAccount({
            fromPubkey: payer.publicKey,
            newAccountPubkey: poolTokenRecipientKeypair.publicKey,
            lamports: accountLamports,
            space: 165,
            programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeAccountInstruction(poolTokenRecipientKeypair.publicKey, poolMint, payer.publicKey),
    );
    await sendAndConfirmTransaction(connection, recipientTx, [payer, poolTokenRecipientKeypair]);
    const feeAccount = feeAccountInfo.address;
    const poolTokenRecipient = poolTokenRecipientKeypair.publicKey;
    console.log("[PoolCreate] Created LP fee + recipient accounts");

    // 7. Create the swap pool
    const tokenSwap = await TokenSwap.createTokenSwap(
        connection,
        payer,
        tokenSwapAccount,
        authority,
        tokenAccountA,
        tokenAccountB,
        poolMint,
        mintA,
        mintB,
        feeAccount,
        poolTokenRecipient,
        TOKEN_SWAP_PROGRAM_ID,
        TOKEN_PROGRAM_ID,
        BigInt(25),       // tradeFeeNumerator
        BigInt(10000),    // tradeFeeDenominator  (0.25%)
        BigInt(5),        // ownerTradeFeeNumerator
        BigInt(10000),    // ownerTradeFeeDenominator (0.05%)
        BigInt(0),        // ownerWithdrawFeeNumerator
        BigInt(0),        // ownerWithdrawFeeDenominator
        BigInt(20),       // hostFeeNumerator
        BigInt(100),      // hostFeeDenominator
        CurveType.ConstantProduct,
    );

    const poolInfo: PoolInfo = {
        poolAddress: tokenSwap.tokenSwap.toBase58(),
        tokenSwapAddress: tokenSwapAccount.publicKey.toBase58(),
        authority: authority.toBase58(),
        tokenMintA: tokenMintA,
        tokenMintB: tokenMintB,
        tokenAccountA: tokenAccountA.toBase58(),
        tokenAccountB: tokenAccountB.toBase58(),
        poolMint: poolMint.toBase58(),
        feeAccount: feeAccount.toBase58(),
        createdAt: Date.now(),
    };

    poolRegistry.push(poolInfo);
    savePools();

    return poolInfo;
}

/**
 * Executes a swap through an existing pool.
 */
export async function executePoolSwap(
    connection: Connection,
    payer: Keypair,
    poolAddress: string,
    inputMint: string,
    amount: number,
): Promise<{ signature: string; pool: PoolInfo }> {
    const pool = poolRegistry.find(p => p.tokenSwapAddress === poolAddress);
    if (!pool) throw new Error(`Pool not found: ${poolAddress}`);

    const isAtoB = inputMint === pool.tokenMintA;
    const sourceMint = isAtoB ? new PublicKey(pool.tokenMintA) : new PublicKey(pool.tokenMintB);
    const destMint = isAtoB ? new PublicKey(pool.tokenMintB) : new PublicKey(pool.tokenMintA);

    // Get or create user's token accounts — explicitly force TOKEN_PROGRAM_ID
    // (@solana/spl-token@0.4.14 auto-detects and may use Token-2022 otherwise)
    const NATIVE_MINT_STR = "So11111111111111111111111111111111111111112";
    const userSourceAta = await getOrCreateAssociatedTokenAccount(
        connection, payer, sourceMint, payer.publicKey,
        false, undefined, undefined, TOKEN_PROGRAM_ID,
    );
    const userDestAta = await getOrCreateAssociatedTokenAccount(
        connection, payer, destMint, payer.publicKey,
        false, undefined, undefined, TOKEN_PROGRAM_ID,
    );

    // If source is WSOL, wrap native SOL into the ATA
    if (inputMint === NATIVE_MINT_STR) {
        const { createSyncNativeInstruction } = await import("@solana/spl-token");
        const wrapTx = new Transaction();
        wrapTx.add(
            SystemProgram.transfer({
                fromPubkey: payer.publicKey,
                toPubkey: userSourceAta.address,
                lamports: amount,
            }),
            createSyncNativeInstruction(userSourceAta.address, TOKEN_PROGRAM_ID),
        );
        await sendAndConfirmTransaction(connection, wrapTx, [payer]);
    }

    // Load the TokenSwap instance (reads poolTokenProgramId from on-chain data)
    const tokenSwap = await TokenSwap.loadTokenSwap(
        connection,
        new PublicKey(pool.tokenSwapAddress),
        TOKEN_SWAP_PROGRAM_ID,
        payer,
    );

    // Create a userTransferAuthority keypair and approve it to spend tokens
    const userTransferAuthority = Keypair.generate();
    const { createApproveInstruction } = await import("@solana/spl-token");
    const approveTx = new Transaction().add(
        createApproveInstruction(
            userSourceAta.address,
            userTransferAuthority.publicKey,
            payer.publicKey,
            BigInt(amount),
            [],
            TOKEN_PROGRAM_ID,
        ),
    );
    await sendAndConfirmTransaction(connection, approveTx, [payer]);

    // Execute swap via instance method (handles token programs from on-chain state)
    const sig = await tokenSwap.swap(
        userSourceAta.address,
        isAtoB ? tokenSwap.tokenAccountA : tokenSwap.tokenAccountB,
        isAtoB ? tokenSwap.tokenAccountB : tokenSwap.tokenAccountA,
        userDestAta.address,
        sourceMint,
        destMint,
        TOKEN_PROGRAM_ID,  // sourceTokenProgramId
        TOKEN_PROGRAM_ID,  // destinationTokenProgramId
        null,              // hostFeeAccount
        userTransferAuthority,
        BigInt(amount),
        BigInt(0),         // minimum out (accept any for devnet)
    );

    return { signature: sig, pool };
}

/**
 * Lists all known pools.
 */
export function listPools(): PoolInfo[] {
    return poolRegistry;
}

/**
 * Gets a specific pool by mint pair.
 */
export function findPool(mintA: string, mintB: string): PoolInfo | undefined {
    return poolRegistry.find(
        p => (p.tokenMintA === mintA && p.tokenMintB === mintB) ||
            (p.tokenMintA === mintB && p.tokenMintB === mintA)
    );
}

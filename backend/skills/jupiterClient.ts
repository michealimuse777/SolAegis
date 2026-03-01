import { PublicKey, VersionedTransaction, Connection } from "@solana/web3.js";

const JUPITER_API = "https://quote-api.jup.ag/v6";

export interface JupiterQuote {
    inputMint: string;
    outputMint: string;
    inAmount: string;
    outAmount: string;
    otherAmountThreshold: string;
    priceImpactPct: string;
    routePlan: Array<{
        swapInfo: {
            ammKey: string;
            label: string;
            inputMint: string;
            outputMint: string;
            inAmount: string;
            outAmount: string;
            feeAmount: string;
            feeMint: string;
        };
        percent: number;
    }>;
    slippageBps: number;
    swapMode: string;
}

/**
 * Gets a swap quote from Jupiter Aggregator.
 */
export async function getQuote(
    inputMint: string,
    outputMint: string,
    amount: number,
    slippageBps: number = 100,
): Promise<JupiterQuote> {
    const url = `${JUPITER_API}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippageBps}`;
    const res = await fetch(url);
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Jupiter quote failed: ${res.status} — ${text}`);
    }
    return res.json() as Promise<JupiterQuote>;
}

/**
 * Gets a serialized swap transaction from Jupiter.
 */
export async function getSwapTransaction(
    quoteResponse: JupiterQuote,
    userPublicKey: string,
): Promise<Buffer> {
    const res = await fetch(`${JUPITER_API}/swap`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            quoteResponse,
            userPublicKey,
            wrapAndUnwrapSol: true,
            dynamicComputeUnitLimit: true,
        }),
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Jupiter swap tx failed: ${res.status} — ${text}`);
    }

    const data = await res.json() as { swapTransaction: string };
    return Buffer.from(data.swapTransaction, "base64");
}

/**
 * Full Jupiter swap: quote → get tx → sign → send → confirm.
 */
export async function executeJupiterSwap(
    connection: Connection,
    keypair: import("@solana/web3.js").Keypair,
    inputMint: string,
    outputMint: string,
    amount: number,
    slippageBps: number = 100,
): Promise<{ signature: string; quote: JupiterQuote }> {
    // 1. Get quote
    const quote = await getQuote(inputMint, outputMint, amount, slippageBps);

    // 2. Get serialized swap transaction
    const swapTxBuf = await getSwapTransaction(quote, keypair.publicKey.toBase58());

    // 3. Deserialize versioned transaction
    const tx = VersionedTransaction.deserialize(swapTxBuf);

    // 4. Sign
    tx.sign([keypair]);

    // 5. Send and confirm
    const signature = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: true,
        maxRetries: 3,
    });
    await connection.confirmTransaction(signature, "confirmed");

    return { signature, quote };
}

// Well-known devnet token mints
export const DEVNET_TOKENS: Record<string, { mint: string; decimals: number; name: string }> = {
    SOL: { mint: "So11111111111111111111111111111111111111112", decimals: 9, name: "SOL (Wrapped)" },
    USDC: { mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", decimals: 6, name: "USDC (Devnet)" },
    USDT: { mint: "EJwZgeZrdC8TXTQbQBoL6bfuAnFUQSssqJtgNxV5c4Ee", decimals: 6, name: "USDT (Devnet)" },
};

/**
 * Converts a human-readable amount to raw lamports/atoms.
 */
export function toRawAmount(amount: number, decimals: number): number {
    return Math.floor(amount * 10 ** decimals);
}

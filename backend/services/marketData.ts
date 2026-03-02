/**
 * Market Data Service — fetches SOL price, trend, and volume from CoinGecko free API.
 * Cached with 5-minute TTL to avoid rate limits.
 * No free browsing — only hardcoded trusted endpoint.
 */

export interface MarketSnapshot {
    sol_price: number;
    change_24h: number;
    trend: "up" | "down" | "neutral";
    volume_24h: number;
    market_cap: number;
    last_updated: number;
}

// ─────────── Cache ───────────

let cachedSnapshot: MarketSnapshot | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ─────────── CoinGecko Free API ───────────

const COINGECKO_URL = "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true";

/**
 * Fetch current SOL market data. Returns cached data if within TTL.
 */
export async function getMarketData(): Promise<MarketSnapshot> {
    // Return cached if still fresh
    if (cachedSnapshot && Date.now() - cacheTimestamp < CACHE_TTL) {
        return cachedSnapshot;
    }

    try {
        const res = await fetch(COINGECKO_URL);
        if (!res.ok) throw new Error(`CoinGecko returned ${res.status}`);

        const data: any = await res.json();
        const sol = data.solana;

        if (!sol || !sol.usd) {
            throw new Error("Invalid CoinGecko response");
        }

        const change = sol.usd_24h_change || 0;
        const snapshot: MarketSnapshot = {
            sol_price: Math.round(sol.usd * 100) / 100,
            change_24h: Math.round(change * 100) / 100,
            trend: change > 1 ? "up" : change < -1 ? "down" : "neutral",
            volume_24h: Math.round(sol.usd_24h_vol || 0),
            market_cap: Math.round(sol.usd_market_cap || 0),
            last_updated: Date.now(),
        };

        cachedSnapshot = snapshot;
        cacheTimestamp = Date.now();
        console.log(`[MarketData] SOL $${snapshot.sol_price} (${snapshot.change_24h > 0 ? "+" : ""}${snapshot.change_24h}%)`);
        return snapshot;
    } catch (err: any) {
        console.warn("[MarketData] Fetch failed:", err.message);

        // Return stale cache if available
        if (cachedSnapshot) {
            return cachedSnapshot;
        }

        // Fallback — return empty snapshot
        return {
            sol_price: 0,
            change_24h: 0,
            trend: "neutral",
            volume_24h: 0,
            market_cap: 0,
            last_updated: 0,
        };
    }
}

/**
 * Build a human-readable market summary for LLM context.
 */
export function marketToPrompt(snapshot: MarketSnapshot): string {
    if (snapshot.sol_price === 0) return "";

    const trendEmoji = snapshot.trend === "up" ? "📈" : snapshot.trend === "down" ? "📉" : "➡️";
    const changeStr = snapshot.change_24h > 0 ? `+${snapshot.change_24h}%` : `${snapshot.change_24h}%`;
    const volStr = snapshot.volume_24h > 1_000_000_000
        ? `$${(snapshot.volume_24h / 1_000_000_000).toFixed(1)}B`
        : `$${(snapshot.volume_24h / 1_000_000).toFixed(0)}M`;

    return `\nCURRENT MARKET DATA:\n${trendEmoji} SOL Price: $${snapshot.sol_price} (${changeStr} 24h)\nVolume: ${volStr} | Market Cap: $${(snapshot.market_cap / 1_000_000_000).toFixed(1)}B`;
}

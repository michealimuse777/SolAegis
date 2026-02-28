import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

const POSITIONS_FILE = path.join(process.cwd(), ".positions.json");

export interface TokenPosition {
    mint: string;
    account: string;
    balance: number;
    decimals: number;
    costBasis: number;      // Average cost in SOL per token
    totalInvested: number;  // Total SOL spent acquiring this token
    lastUpdated: number;    // Timestamp
}

export interface PortfolioSnapshot {
    solBalance: number;
    tokens: TokenPosition[];
    totalValueSOL: number;     // SOL + estimated token value
    unrealizedPnL: number;     // Based on cost basis vs current
    timestamp: number;
}

export interface PositionHistory {
    agentId: string;
    snapshots: PortfolioSnapshot[];
    trades: TradeRecord[];
}

export interface TradeRecord {
    timestamp: number;
    action: "buy" | "sell" | "transfer_in" | "transfer_out" | "airdrop";
    mint: string;
    amount: number;
    solValue: number;       // SOL equivalent at time of trade
    txSignature?: string;
}

// In-memory + disk persistence
const positionsDB = new Map<string, PositionHistory>();

function loadPositions(): void {
    try {
        if (fs.existsSync(POSITIONS_FILE)) {
            const data = JSON.parse(fs.readFileSync(POSITIONS_FILE, "utf-8"));
            for (const [key, val] of Object.entries(data)) {
                positionsDB.set(key, val as PositionHistory);
            }
            console.log(`[PositionTracker] Loaded positions for ${positionsDB.size} agent(s)`);
        }
    } catch (err: any) {
        console.warn("[PositionTracker] Failed to load positions:", err.message);
    }
}

function savePositions(): void {
    try {
        const obj = Object.fromEntries(positionsDB);
        fs.writeFileSync(POSITIONS_FILE, JSON.stringify(obj, null, 2), "utf-8");
    } catch (err: any) {
        console.error("[PositionTracker] Failed to save positions:", err.message);
    }
}

// Load on module init
loadPositions();

export class PositionTracker {
    constructor(private connection: Connection) { }

    /**
     * Takes a full portfolio snapshot from on-chain data.
     * Queries SOL balance + all token accounts.
     */
    async snapshot(agentId: string, wallet: PublicKey): Promise<PortfolioSnapshot> {
        const solBalance = await this.connection.getBalance(wallet) / 1e9;

        const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(wallet, {
            programId: TOKEN_PROGRAM_ID,
        });

        const history = this.getOrCreateHistory(agentId);
        const tokens: TokenPosition[] = [];

        for (const account of tokenAccounts.value) {
            const info = account.account.data.parsed.info;
            const mint = info.mint as string;
            const balance = info.tokenAmount.uiAmount ?? 0;
            const decimals = info.tokenAmount.decimals ?? 0;

            // Find existing position for cost basis
            const existing = this.getPosition(agentId, mint);

            tokens.push({
                mint,
                account: account.pubkey.toBase58(),
                balance,
                decimals,
                costBasis: existing?.costBasis ?? 0,
                totalInvested: existing?.totalInvested ?? 0,
                lastUpdated: Date.now(),
            });
        }

        // Calculate portfolio value (SOL + token estimates)
        // For devnet, we estimate token values from cost basis
        const tokenValue = tokens.reduce((sum, t) => sum + (t.balance * t.costBasis), 0);
        const totalValueSOL = solBalance + tokenValue;
        const totalInvested = tokens.reduce((sum, t) => sum + t.totalInvested, 0);
        const unrealizedPnL = tokenValue - totalInvested;

        const snap: PortfolioSnapshot = {
            solBalance,
            tokens,
            totalValueSOL,
            unrealizedPnL,
            timestamp: Date.now(),
        };

        // Keep last 100 snapshots
        history.snapshots.push(snap);
        if (history.snapshots.length > 100) {
            history.snapshots = history.snapshots.slice(-100);
        }

        savePositions();
        return snap;
    }

    /**
     * Records a trade and updates cost basis.
     */
    recordTrade(agentId: string, trade: TradeRecord): void {
        const history = this.getOrCreateHistory(agentId);
        history.trades.push(trade);

        // Keep last 500 trades
        if (history.trades.length > 500) {
            history.trades = history.trades.slice(-500);
        }

        // Update cost basis for buys
        if (trade.action === "buy" || trade.action === "airdrop" || trade.action === "transfer_in") {
            const existing = this.getPosition(agentId, trade.mint);
            if (existing) {
                // Weighted average cost basis
                const totalTokens = existing.balance + trade.amount;
                if (totalTokens > 0) {
                    existing.costBasis = (existing.totalInvested + trade.solValue) / totalTokens;
                    existing.totalInvested += trade.solValue;
                }
            }
        }

        savePositions();
    }

    /**
     * Gets the current portfolio summary for DerMercist context.
     */
    getPortfolioSummary(agentId: string): {
        tokenCount: number;
        holdings: { mint: string; balance: number; pnl: number }[];
        totalPnL: number;
        tradeCount: number;
        recentTrades: TradeRecord[];
    } {
        const history = positionsDB.get(agentId);
        if (!history || history.snapshots.length === 0) {
            return { tokenCount: 0, holdings: [], totalPnL: 0, tradeCount: 0, recentTrades: [] };
        }

        const latest = history.snapshots[history.snapshots.length - 1];

        const holdings = latest.tokens.map(t => ({
            mint: t.mint,
            balance: t.balance,
            pnl: (t.balance * t.costBasis) - t.totalInvested,
        }));

        return {
            tokenCount: latest.tokens.length,
            holdings,
            totalPnL: latest.unrealizedPnL,
            tradeCount: history.trades.length,
            recentTrades: history.trades.slice(-10),
        };
    }

    /**
     * Gets full position history for an agent.
     */
    getHistory(agentId: string): PositionHistory | null {
        return positionsDB.get(agentId) ?? null;
    }

    /**
     * Gets a specific token position.
     */
    getPosition(agentId: string, mint: string): TokenPosition | undefined {
        const history = positionsDB.get(agentId);
        if (!history || history.snapshots.length === 0) return undefined;
        const latest = history.snapshots[history.snapshots.length - 1];
        return latest.tokens.find(t => t.mint === mint);
    }

    private getOrCreateHistory(agentId: string): PositionHistory {
        if (!positionsDB.has(agentId)) {
            positionsDB.set(agentId, { agentId, snapshots: [], trades: [] });
        }
        return positionsDB.get(agentId)!;
    }
}

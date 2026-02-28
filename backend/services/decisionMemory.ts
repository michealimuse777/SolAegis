import * as fs from "fs";
import * as path from "path";

const MEMORY_FILE = path.join(process.cwd(), ".decisions.json");

export interface DecisionRecord {
    timestamp: number;
    agentId: string;
    action: string;
    source: "llm" | "rules";
    params: Record<string, any>;
    result: "success" | "failure" | "rejected" | "hold";
    reason?: string;
    balanceAtTime: number;
    riskScore: number;        // 0-100
    confidence: number;       // LLM confidence 0-100
    executionTimeMs?: number;
    txSignature?: string;
}

export interface ActionStats {
    action: string;
    totalAttempts: number;
    successes: number;
    failures: number;
    rejections: number;
    successRate: number;       // 0-1
    avgRiskScore: number;
    lastAttempt: number;
    consecutiveFailures: number;
    cooldownUntil: number;     // timestamp, 0 = no cooldown
}

export interface AgentMemory {
    agentId: string;
    decisions: DecisionRecord[];
    actionStats: Map<string, ActionStats>;
    riskScoreHistory: number[];  // Last 50 risk scores
    totalDecisions: number;
    totalSuccesses: number;
    totalFailures: number;
}

// Serializable version for disk
interface AgentMemorySerialized {
    agentId: string;
    decisions: DecisionRecord[];
    actionStats: Record<string, ActionStats>;
    riskScoreHistory: number[];
    totalDecisions: number;
    totalSuccesses: number;
    totalFailures: number;
}

const memoryDB = new Map<string, AgentMemory>();

function loadMemory(): void {
    try {
        if (fs.existsSync(MEMORY_FILE)) {
            const data: Record<string, AgentMemorySerialized> = JSON.parse(
                fs.readFileSync(MEMORY_FILE, "utf-8")
            );
            for (const [key, val] of Object.entries(data)) {
                memoryDB.set(key, {
                    ...val,
                    actionStats: new Map(Object.entries(val.actionStats)),
                });
            }
            console.log(`[DecisionMemory] Loaded memory for ${memoryDB.size} agent(s)`);
        }
    } catch (err: any) {
        console.warn("[DecisionMemory] Failed to load:", err.message);
    }
}

function saveMemory(): void {
    try {
        const obj: Record<string, AgentMemorySerialized> = {};
        for (const [key, val] of memoryDB) {
            obj[key] = {
                ...val,
                actionStats: Object.fromEntries(val.actionStats),
            };
        }
        fs.writeFileSync(MEMORY_FILE, JSON.stringify(obj, null, 2), "utf-8");
    } catch (err: any) {
        console.error("[DecisionMemory] Failed to save:", err.message);
    }
}

loadMemory();

export class DecisionMemory {
    /**
     * Records a decision and updates analytics.
     */
    record(record: DecisionRecord): void {
        const memory = this.getOrCreate(record.agentId);

        // Add to decisions (keep last 200)
        memory.decisions.push(record);
        if (memory.decisions.length > 200) {
            memory.decisions = memory.decisions.slice(-200);
        }

        // Update risk score history (keep last 50)
        memory.riskScoreHistory.push(record.riskScore);
        if (memory.riskScoreHistory.length > 50) {
            memory.riskScoreHistory = memory.riskScoreHistory.slice(-50);
        }

        // Update totals
        memory.totalDecisions++;
        if (record.result === "success") memory.totalSuccesses++;
        if (record.result === "failure") memory.totalFailures++;

        // Update per-action stats
        this.updateActionStats(memory, record);

        saveMemory();
    }

    /**
     * Gets the adaptive cooldown multiplier for an action.
     * More consecutive failures = longer cooldown.
     */
    getCooldownMs(agentId: string, action: string): number {
        const memory = memoryDB.get(agentId);
        if (!memory) return 0;

        const stats = memory.actionStats.get(action);
        if (!stats) return 0;

        // Check if in active cooldown
        if (stats.cooldownUntil > Date.now()) {
            return stats.cooldownUntil - Date.now();
        }

        return 0;
    }

    /**
     * Checks if an action is currently in cooldown.
     */
    isInCooldown(agentId: string, action: string): boolean {
        return this.getCooldownMs(agentId, action) > 0;
    }

    /**
     * Gets adaptive rule weight adjustments based on history.
     * Returns a multiplier: 1.0 = normal, >1.0 = more restrictive, <1.0 = more lenient.
     */
    getAdaptiveWeight(agentId: string, action: string): number {
        const memory = memoryDB.get(agentId);
        if (!memory) return 1.0;

        const stats = memory.actionStats.get(action);
        if (!stats || stats.totalAttempts < 3) return 1.0;

        // Low success rate = more restrictive
        if (stats.successRate < 0.3) return 2.0;   // Double the restrictions
        if (stats.successRate < 0.5) return 1.5;
        if (stats.successRate > 0.8) return 0.8;    // Slightly more lenient

        return 1.0;
    }

    /**
     * Gets action stats for DerMercist context.
     */
    getActionStats(agentId: string): ActionStats[] {
        const memory = memoryDB.get(agentId);
        if (!memory) return [];
        return Array.from(memory.actionStats.values());
    }

    /**
     * Gets recent decisions for display.
     */
    getRecentDecisions(agentId: string, count: number = 20): DecisionRecord[] {
        const memory = memoryDB.get(agentId);
        if (!memory) return [];
        return memory.decisions.slice(-count);
    }

    /**
     * Gets aggregate analytics for an agent.
     */
    getAnalytics(agentId: string): {
        totalDecisions: number;
        successRate: number;
        avgRiskScore: number;
        riskTrend: "rising" | "falling" | "stable";
        mostSuccessfulAction: string | null;
        mostFailedAction: string | null;
        recentDecisions: DecisionRecord[];
    } {
        const memory = memoryDB.get(agentId);
        if (!memory) {
            return {
                totalDecisions: 0,
                successRate: 0,
                avgRiskScore: 0,
                riskTrend: "stable",
                mostSuccessfulAction: null,
                mostFailedAction: null,
                recentDecisions: [],
            };
        }

        const successRate = memory.totalDecisions > 0
            ? memory.totalSuccesses / memory.totalDecisions
            : 0;

        // Calculate average risk score
        const avgRiskScore = memory.riskScoreHistory.length > 0
            ? memory.riskScoreHistory.reduce((a, b) => a + b, 0) / memory.riskScoreHistory.length
            : 0;

        // Calculate risk trend from last 10 vs previous 10
        const riskTrend = this.calculateRiskTrend(memory.riskScoreHistory);

        // Find best and worst actions
        let mostSuccessfulAction: string | null = null;
        let mostFailedAction: string | null = null;
        let bestRate = 0;
        let worstRate = 1;

        for (const [action, stats] of memory.actionStats) {
            if (stats.totalAttempts >= 2) {
                if (stats.successRate > bestRate) {
                    bestRate = stats.successRate;
                    mostSuccessfulAction = action;
                }
                if (stats.successRate < worstRate) {
                    worstRate = stats.successRate;
                    mostFailedAction = action;
                }
            }
        }

        return {
            totalDecisions: memory.totalDecisions,
            successRate,
            avgRiskScore,
            riskTrend,
            mostSuccessfulAction,
            mostFailedAction,
            recentDecisions: memory.decisions.slice(-10),
        };
    }

    /**
     * Gets the full context string for LLM prompts.
     * Gives DerMercist awareness of past decisions.
     */
    getContextForLLM(agentId: string): string {
        const analytics = this.getAnalytics(agentId);
        const stats = this.getActionStats(agentId);

        let context = `Decision History: ${analytics.totalDecisions} total, `;
        context += `${(analytics.successRate * 100).toFixed(0)}% success rate, `;
        context += `risk trend: ${analytics.riskTrend}.\n`;

        if (stats.length > 0) {
            context += "Per-action stats: ";
            context += stats.map(s =>
                `${s.action}(${s.successes}/${s.totalAttempts} success, ${s.consecutiveFailures} consecutive fails)`
            ).join(", ");
            context += ".\n";
        }

        if (analytics.mostFailedAction) {
            context += `WARNING: ${analytics.mostFailedAction} has high failure rate — consider alternatives.\n`;
        }

        return context;
    }

    private updateActionStats(memory: AgentMemory, record: DecisionRecord): void {
        let stats = memory.actionStats.get(record.action);
        if (!stats) {
            stats = {
                action: record.action,
                totalAttempts: 0,
                successes: 0,
                failures: 0,
                rejections: 0,
                successRate: 0,
                avgRiskScore: 0,
                lastAttempt: 0,
                consecutiveFailures: 0,
                cooldownUntil: 0,
            };
            memory.actionStats.set(record.action, stats);
        }

        stats.totalAttempts++;
        stats.lastAttempt = record.timestamp;

        if (record.result === "success") {
            stats.successes++;
            stats.consecutiveFailures = 0;
            stats.cooldownUntil = 0;
        } else if (record.result === "failure") {
            stats.failures++;
            stats.consecutiveFailures++;
            // Adaptive cooldown: 30s * 2^consecutiveFailures (max 15 min)
            const cooldownMs = Math.min(30_000 * Math.pow(2, stats.consecutiveFailures), 900_000);
            stats.cooldownUntil = Date.now() + cooldownMs;
        } else if (record.result === "rejected") {
            stats.rejections++;
        }

        stats.successRate = stats.totalAttempts > 0 ? stats.successes / stats.totalAttempts : 0;

        // Running average risk score
        stats.avgRiskScore = (stats.avgRiskScore * (stats.totalAttempts - 1) + record.riskScore) / stats.totalAttempts;
    }

    private calculateRiskTrend(scores: number[]): "rising" | "falling" | "stable" {
        if (scores.length < 6) return "stable";

        const recent = scores.slice(-5);
        const previous = scores.slice(-10, -5);

        if (previous.length === 0) return "stable";

        const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
        const prevAvg = previous.reduce((a, b) => a + b, 0) / previous.length;

        const diff = recentAvg - prevAvg;
        if (diff > 5) return "rising";
        if (diff < -5) return "falling";
        return "stable";
    }

    private getOrCreate(agentId: string): AgentMemory {
        if (!memoryDB.has(agentId)) {
            memoryDB.set(agentId, {
                agentId,
                decisions: [],
                actionStats: new Map(),
                riskScoreHistory: [],
                totalDecisions: 0,
                totalSuccesses: 0,
                totalFailures: 0,
            });
        }
        return memoryDB.get(agentId)!;
    }
}

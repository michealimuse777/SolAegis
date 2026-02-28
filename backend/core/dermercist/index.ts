import { Agent } from "../agent.js";
import { DeFiSkill, DeFiAction } from "../../skills/defiSkill.js";
import { LLMInterface } from "./llmInterface.js";
import { planNextTask, PlannedTask } from "./agentPlanner.js";
import { PositionTracker } from "../../services/positionTracker.js";
import { DecisionMemory, DecisionRecord } from "../../services/decisionMemory.js";
import { CapitalAllocator } from "./capitalAllocator.js";
import { ExecutionLock } from "../../services/executionLock.js";
import { Connection } from "@solana/web3.js";

export interface DerMercistResult {
    agentId: string;
    planned: PlannedTask;
    executed: boolean;
    signature?: string;
    error?: string;
    portfolio?: {
        solBalance: number;
        tokenCount: number;
        totalPnL: number;
    };
    analytics?: {
        totalDecisions: number;
        successRate: number;
        riskTrend: string;
    };
}

/**
 * DerMercist — the autonomous decision-making brain.
 * 
 * Now with:
 * - Position tracking (portfolio awareness)
 * - Decision memory (learns from failures)
 * - Capital allocation (% limits, diversification)
 * - Execution locks (concurrency protection)
 */
export class DerMercist {
    private positionTracker: PositionTracker;
    private decisionMemory: DecisionMemory;
    private capitalAllocator: CapitalAllocator;

    constructor(
        private defiSkill: DeFiSkill,
        private llmInterface: LLMInterface,
        connection: Connection
    ) {
        this.positionTracker = new PositionTracker(connection);
        this.decisionMemory = new DecisionMemory();
        this.capitalAllocator = new CapitalAllocator();
    }

    /**
     * Run the decision loop for a single agent.
     */
    async run(agent: Agent): Promise<DerMercistResult> {
        const state = await agent.getState();
        const agentId = state.id;
        const startTime = Date.now();

        console.log(`\n[DerMercist] ─── Agent "${agentId}" ───`);
        console.log(`  Balance: ${state.balance.toFixed(4)} SOL`);
        console.log(`  Pending: ${state.pendingTx} tx`);
        console.log(`  Skills:  ${state.skills.join(", ")}`);

        // Acquire execution lock
        if (!ExecutionLock.acquire(agentId, "dermercist")) {
            console.log(`  → Blocked: agent is already executing`);
            return {
                agentId,
                planned: { action: "hold", params: {}, priority: 0, source: "rules", reason: "Agent locked — concurrent execution blocked" },
                executed: false,
            };
        }

        try {
            // 1. Take portfolio snapshot
            const keypair = agent.getKeypair();
            const portfolio = await this.positionTracker.snapshot(agentId, keypair.publicKey);
            console.log(`  Portfolio: ${portfolio.tokens.length} tokens, PnL: ${portfolio.unrealizedPnL.toFixed(4)} SOL`);

            // 2. Get decision history context for LLM
            const memoryContext = this.decisionMemory.getContextForLLM(agentId);

            // 3. Build enriched state for LLM (includes portfolio + history)
            const enrichedState = {
                ...state,
                portfolio: {
                    solBalance: portfolio.solBalance,
                    tokens: portfolio.tokens.map(t => ({
                        mint: t.mint,
                        balance: t.balance,
                        costBasis: t.costBasis,
                        pnl: (t.balance * t.costBasis) - t.totalInvested,
                    })),
                    totalValueSOL: portfolio.totalValueSOL,
                    unrealizedPnL: portfolio.unrealizedPnL,
                },
                decisionHistory: memoryContext,
            };

            // 4. Query LLM with enriched context
            const suggestion = await this.llmInterface.suggestAction(
                JSON.stringify(enrichedState, null, 2)
            );
            console.log(`  LLM suggests: ${suggestion.action} (${suggestion.reasoning ?? ""})`);

            // 5. Check decision memory cooldowns
            if (this.decisionMemory.isInCooldown(agentId, suggestion.action)) {
                const cooldownMs = this.decisionMemory.getCooldownMs(agentId, suggestion.action);
                console.log(`  → Action "${suggestion.action}" in cooldown (${Math.ceil(cooldownMs / 1000)}s remaining)`);
                suggestion.action = "hold";
                suggestion.reasoning = `Action in adaptive cooldown due to consecutive failures`;
            }

            // 6. Apply deterministic rules + prioritize
            const planned = planNextTask(state, suggestion);
            console.log(`  Planned:  ${planned.action} [priority=${planned.priority}] [source=${planned.source}]`);

            if (planned.reason) {
                console.log(`  Reason:   ${planned.reason}`);
            }

            // 7. Capital allocation check (for non-hold actions)
            if (planned.action !== "hold" && planned.params.amount) {
                const allocation = this.capitalAllocator.checkAllocation(
                    planned.action,
                    planned.params.amount,
                    portfolio.solBalance,
                    portfolio.tokens.map(t => ({
                        mint: t.mint,
                        balance: t.balance,
                        valueSOL: t.balance * t.costBasis,
                    })),
                    planned.params.targetMint || planned.params.mint
                );

                if (!allocation.allowed) {
                    console.log(`  → Capital allocation blocked: ${allocation.reason}`);
                    this.recordDecision(agentId, planned, "rejected", startTime, allocation.reason);
                    return {
                        agentId,
                        planned: { ...planned, action: "hold", reason: allocation.reason },
                        executed: false,
                        portfolio: { solBalance: portfolio.solBalance, tokenCount: portfolio.tokens.length, totalPnL: portfolio.unrealizedPnL },
                    };
                }

                if (allocation.adjustedParams) {
                    Object.assign(planned.params, allocation.adjustedParams);
                    console.log(`  → Amount adjusted by capital allocator: ${allocation.reason}`);
                }
            }

            // 8. Execute if not "hold"
            if (planned.action === "hold") {
                console.log(`  → Holding (no execution)`);
                this.recordDecision(agentId, planned, "hold", startTime);
                const analytics = this.decisionMemory.getAnalytics(agentId);
                return {
                    agentId,
                    planned,
                    executed: false,
                    portfolio: { solBalance: portfolio.solBalance, tokenCount: portfolio.tokens.length, totalPnL: portfolio.unrealizedPnL },
                    analytics: { totalDecisions: analytics.totalDecisions, successRate: analytics.successRate, riskTrend: analytics.riskTrend },
                };
            }

            try {
                const result = await this.defiSkill.execute(
                    agentId,
                    planned.action as DeFiAction,
                    planned.params
                );

                const analytics = this.decisionMemory.getAnalytics(agentId);

                if (result.success) {
                    console.log(`  → Executed ✓ sig=${result.signature}`);
                    this.recordDecision(agentId, planned, "success", startTime, undefined, result.signature);
                    return {
                        agentId,
                        planned,
                        executed: true,
                        signature: result.signature,
                        portfolio: { solBalance: portfolio.solBalance, tokenCount: portfolio.tokens.length, totalPnL: portfolio.unrealizedPnL },
                        analytics: { totalDecisions: analytics.totalDecisions, successRate: analytics.successRate, riskTrend: analytics.riskTrend },
                    };
                } else {
                    console.log(`  → Failed: ${result.error}`);
                    this.recordDecision(agentId, planned, "failure", startTime, result.error);
                    return {
                        agentId,
                        planned,
                        executed: false,
                        error: result.error,
                        portfolio: { solBalance: portfolio.solBalance, tokenCount: portfolio.tokens.length, totalPnL: portfolio.unrealizedPnL },
                        analytics: { totalDecisions: analytics.totalDecisions, successRate: analytics.successRate, riskTrend: analytics.riskTrend },
                    };
                }
            } catch (err: any) {
                console.log(`  → Error: ${err.message}`);
                this.recordDecision(agentId, planned, "failure", startTime, err.message);
                return {
                    agentId,
                    planned,
                    executed: false,
                    error: err.message,
                };
            }
        } finally {
            ExecutionLock.release(agentId);
        }
    }

    /**
     * Run decision loop for multiple agents.
     * Uses execution locks for safety even if run concurrently.
     */
    async runAll(agents: Agent[]): Promise<DerMercistResult[]> {
        const results: DerMercistResult[] = [];
        for (const agent of agents) {
            const result = await this.run(agent);
            results.push(result);
        }
        return results;
    }

    /**
     * Get analytics for an agent.
     */
    getAnalytics(agentId: string) {
        return this.decisionMemory.getAnalytics(agentId);
    }

    /**
     * Get portfolio summary for an agent.
     */
    getPortfolioSummary(agentId: string) {
        return this.positionTracker.getPortfolioSummary(agentId);
    }

    /**
     * Get recent decisions for an agent.
     */
    getDecisionHistory(agentId: string, count: number = 20) {
        return this.decisionMemory.getRecentDecisions(agentId, count);
    }

    /**
     * Get capital allocation rules.
     */
    getAllocationRules() {
        return this.capitalAllocator.getRules();
    }

    /**
     * Get position tracker instance.
     */
    getPositionTracker() {
        return this.positionTracker;
    }

    private recordDecision(
        agentId: string,
        planned: PlannedTask,
        result: "success" | "failure" | "rejected" | "hold",
        startTime: number,
        reason?: string,
        txSignature?: string
    ): void {
        this.decisionMemory.record({
            timestamp: Date.now(),
            agentId,
            action: planned.action,
            source: planned.source as "llm" | "rules",
            params: planned.params,
            result,
            reason: reason || planned.reason,
            balanceAtTime: 0,  // Will be filled from state
            riskScore: planned.priority,
            confidence: planned.params?.confidence ?? 0,
            executionTimeMs: Date.now() - startTime,
            txSignature,
        });
    }
}

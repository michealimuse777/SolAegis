import { loadAgentConfig, AgentConfig } from "../core/agentConfig.js";
import { DecisionMemory } from "./decisionMemory.js";

// ─────────── Types ───────────

export interface PolicyCheckResult {
    allowed: boolean;
    reason?: string;
}

// ─────────── Policy Engine ───────────

/**
 * Enforces agent config on every action.
 * Sits between intent and execution — nothing bypasses this.
 *
 * Flow: Chat/Button → PolicyEngine.check() → Allow/Deny → Execute
 */
export class PolicyEngine {

    /**
     * Check whether an action is allowed for this agent.
     */
    async check(
        agentId: string,
        action: string,
        params: Record<string, any> = {},
    ): Promise<PolicyCheckResult> {
        const config = loadAgentConfig(agentId);
        if (!config) {
            return { allowed: false, reason: "No config found for agent. Create it first." };
        }

        // 1. Action allowlist (airdrop + scam_check are always safe — read-only)
        const ALWAYS_ALLOWED = ["airdrop", "scam_check"];
        if (!ALWAYS_ALLOWED.includes(action) && !config.allowedActions.includes(action)) {
            return {
                allowed: false,
                reason: `Action "${action}" is not in your allowed actions [${config.allowedActions.join(", ")}]. Your role is "${config.role}".`,
            };
        }

        // 2. Spending limit
        const amount = parseFloat(params.amount || params.amountSol || "0");
        if (amount > 0 && amount > config.maxSolPerTx) {
            return {
                allowed: false,
                reason: `Amount ${amount} SOL exceeds your per-transaction limit of ${config.maxSolPerTx} SOL.`,
            };
        }

        // 3. Daily transaction limit
        const todayCount = await this.getTodayTxCount(agentId);
        if (config.dailyTxLimit > 0 && todayCount >= config.dailyTxLimit) {
            return {
                allowed: false,
                reason: `Daily transaction limit reached (${todayCount}/${config.dailyTxLimit}). Try again tomorrow.`,
            };
        }

        // 4. Monitor agents cannot execute transactions
        if (config.role === "monitor" && action !== "scan_airdrops") {
            return {
                allowed: false,
                reason: `Monitor agents can only observe. They cannot execute "${action}".`,
            };
        }

        return { allowed: true };
    }

    /**
     * Count how many transactions the agent has executed today.
     */
    private async getTodayTxCount(agentId: string): Promise<number> {
        try {
            const dm = new DecisionMemory();
            const analytics = dm.getAnalytics(agentId);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const todayStart = today.getTime();

            return analytics.recentDecisions.filter(
                d => d.timestamp >= todayStart && d.result === "success"
            ).length;
        } catch {
            return 0;
        }
    }

    /**
     * Format a denial into a chat-friendly explanation.
     */
    formatDenial(result: PolicyCheckResult): string {
        return `⛔ Policy Denied: ${result.reason}`;
    }

    /**
     * Summarize the agent's current policy for chat context.
     */
    summarizePolicy(config: AgentConfig): string {
        return [
            `Role: ${config.role}`,
            `Max SOL/tx: ${config.maxSolPerTx}`,
            `Daily limit: ${config.dailyTxLimit} txs`,
            `Allowed actions: ${config.allowedActions.join(", ")}`,
            `Risk profile: ${config.riskProfile}`,
        ].join("\n");
    }
}

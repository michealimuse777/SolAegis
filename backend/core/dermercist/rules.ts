import { AgentState } from "../agent.js";

export interface RuleCheckResult {
    allowed: boolean;
    reason?: string;
}

export interface TaskCandidate {
    action: string;
    amount?: number;
    targetMint?: string;
    [key: string]: any;
}

/**
 * Deterministic safety rules applied BEFORE any LLM-suggested action.
 * These rules cannot be overridden by the AI layer.
 */
export function deterministicRules(
    agentState: AgentState,
    task: TaskCandidate
): RuleCheckResult {
    // Rule 1: Minimum SOL balance for fees
    if (agentState.balance < 0.01) {
        // Only allow recovery actions when balance is critically low
        if (task.action !== "recover" && task.action !== "hold") {
            return {
                allowed: false,
                reason: `Insufficient SOL balance (${agentState.balance.toFixed(4)} SOL). Only recovery/hold allowed.`,
            };
        }
    }

    // Rule 2: Block actions while transactions are pending
    if (agentState.pendingTx > 0 && task.action !== "hold") {
        return {
            allowed: false,
            reason: `${agentState.pendingTx} pending transaction(s) — wait for completion`,
        };
    }

    // Rule 3: Block swaps that would drain the wallet
    if (task.action === "swap" && task.amount) {
        const maxSwap = agentState.balance * 0.9; // Never swap more than 90%
        if (task.amount > maxSwap) {
            return {
                allowed: false,
                reason: `Swap amount (${task.amount}) exceeds 90% of balance — too risky`,
            };
        }
    }

    // Rule 4: Prevent rapid-fire actions (cooldown based on last action)
    if (
        agentState.lastResult &&
        !agentState.lastResult.success &&
        task.action === agentState.lastAction
    ) {
        return {
            allowed: false,
            reason: `Last "${task.action}" failed — holding to prevent repeated failures`,
        };
    }

    // Rule 5: Liquidity provision requires minimum balance
    if (task.action === "liquidity" && agentState.balance < 0.1) {
        return {
            allowed: false,
            reason: `Balance too low for liquidity provision (need > 0.1 SOL)`,
        };
    }

    return { allowed: true };
}

/**
 * Priority scoring for actions based on agent state.
 * Higher score = more urgent.
 */
export function prioritizeAction(
    agentState: AgentState,
    action: string
): number {
    let score = 50; // base

    // Recovery is highest priority when balance is low
    if (action === "recover" && agentState.balance < 0.05) {
        score += 40;
    }

    // Holding costs nothing, lowest priority
    if (action === "hold") {
        score -= 30;
    }

    // Swap/liquidity penalized when balance is moderate
    if (
        (action === "swap" || action === "liquidity") &&
        agentState.balance < 0.5
    ) {
        score -= 20;
    }

    return Math.max(0, Math.min(100, score));
}

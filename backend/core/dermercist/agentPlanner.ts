import { AgentState } from "../agent.js";
import { deterministicRules, prioritizeAction, TaskCandidate } from "./rules.js";

export interface PlannedTask {
    action: string;
    params: Record<string, any>;
    priority: number;
    reason?: string;
    source: "llm" | "rules" | "fallback";
}

/**
 * Combines LLM suggestions with deterministic rules to produce safe, prioritized tasks.
 */
export function planNextTask(
    agentState: AgentState,
    llmSuggestion: TaskCandidate
): PlannedTask {
    // Apply deterministic rules first
    const check = deterministicRules(agentState, llmSuggestion);

    if (!check.allowed) {
        // Fallback to hold action
        return {
            action: "hold",
            params: {},
            priority: prioritizeAction(agentState, "hold"),
            reason: check.reason,
            source: "rules",
        };
    }

    // LLM suggestion passed rules — calculate priority
    const priority = prioritizeAction(agentState, llmSuggestion.action);

    return {
        action: llmSuggestion.action,
        params: llmSuggestion,
        priority,
        source: "llm",
    };
}

/**
 * Plans multiple tasks and returns them sorted by priority (highest first).
 */
export function planMultipleTasks(
    agentState: AgentState,
    suggestions: TaskCandidate[]
): PlannedTask[] {
    const plans = suggestions.map((s) => planNextTask(agentState, s));
    return plans.sort((a, b) => b.priority - a.priority);
}

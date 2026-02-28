import { Agent } from "../agent.js";
import { DeFiSkill, DeFiAction } from "../../skills/defiSkill.js";
import { LLMInterface } from "./llmInterface.js";
import { planNextTask, PlannedTask } from "./agentPlanner.js";

export interface DerMercistResult {
    agentId: string;
    planned: PlannedTask;
    executed: boolean;
    signature?: string;
    error?: string;
}

/**
 * DerMercist — the autonomous decision-making brain.
 * 
 * Flow:
 * 1. Get agent state (balances, pending tx, last action)
 * 2. Query LLM for suggested action
 * 3. Apply deterministic safety rules
 * 4. Execute via DeFi skill (if approved)
 * 5. Return result
 */
export class DerMercist {
    constructor(
        private defiSkill: DeFiSkill,
        private llmInterface: LLMInterface
    ) { }

    /**
     * Run the decision loop for a single agent.
     */
    async run(agent: Agent): Promise<DerMercistResult> {
        const state = await agent.getState();
        const agentId = state.id;

        console.log(`\n[DerMercist] ─── Agent "${agentId}" ───`);
        console.log(`  Balance: ${state.balance.toFixed(4)} SOL`);
        console.log(`  Pending: ${state.pendingTx} tx`);
        console.log(`  Skills:  ${state.skills.join(", ")}`);

        // 1. Query LLM for suggestion
        const suggestion = await this.llmInterface.suggestAction(
            JSON.stringify(state, null, 2)
        );
        console.log(`  LLM suggests: ${suggestion.action} (${suggestion.reasoning ?? ""})`);

        // 2. Apply deterministic rules + prioritize
        const planned = planNextTask(state, suggestion);
        console.log(`  Planned:  ${planned.action} [priority=${planned.priority}] [source=${planned.source}]`);

        if (planned.reason) {
            console.log(`  Reason:   ${planned.reason}`);
        }

        // 3. Execute if not "hold"
        if (planned.action === "hold") {
            console.log(`  → Holding (no execution)`);
            return { agentId, planned, executed: false };
        }

        try {
            const result = await this.defiSkill.execute(
                agentId,
                planned.action as DeFiAction,
                planned.params
            );

            if (result.success) {
                console.log(`  → Executed ✓ sig=${result.signature}`);
                return {
                    agentId,
                    planned,
                    executed: true,
                    signature: result.signature,
                };
            } else {
                console.log(`  → Failed: ${result.error}`);
                return {
                    agentId,
                    planned,
                    executed: false,
                    error: result.error,
                };
            }
        } catch (err: any) {
            console.log(`  → Error: ${err.message}`);
            return {
                agentId,
                planned,
                executed: false,
                error: err.message,
            };
        }
    }

    /**
     * Run decision loop for multiple agents sequentially.
     * Prevents conflicts (e.g., two agents closing the same account).
     */
    async runAll(agents: Agent[]): Promise<DerMercistResult[]> {
        const results: DerMercistResult[] = [];
        for (const agent of agents) {
            const result = await this.run(agent);
            results.push(result);
        }
        return results;
    }
}

import { LLMManager } from "../../llm/llmManager.js";
import { riskAssessmentPrompt, tradingPrompt } from "../../llm/promptTemplates.js";
import { TaskCandidate } from "./rules.js";

/**
 * Interface between the DerMercist decision engine and the LLM layer.
 * Wraps LLM calls with structured parsing and fallback handling.
 */
export class LLMInterface {
    constructor(private llmManager: LLMManager) { }

    /**
     * Ask the LLM to suggest the next action based on agent state.
     */
    async suggestAction(agentStateJson: string): Promise<TaskCandidate> {
        const prompt = `You are an autonomous DeFi agent on Solana devnet.

Current state:
${agentStateJson}

Based on this state, what should the agent do next?
Available actions: swap, transfer, liquidity, recover, scan_airdrops, hold

Output ONLY valid JSON:
{
  "action": "<action>",
  "amount": <number or null>,
  "targetMint": "<address or null>",
  "confidence": <0-100>,
  "reasoning": "<brief>"
}`;

        try {
            const response = await this.llmManager.query(prompt);
            return this.parseResponse(response.output);
        } catch {
            return { action: "hold", reasoning: "LLM unavailable" };
        }
    }

    /**
     * Ask the LLM for a risk assessment.
     */
    async assessRisk(agentStateJson: string): Promise<{
        riskLevel: string;
        suggestedAction: string;
        reasoning: string;
    }> {
        const prompt = riskAssessmentPrompt(agentStateJson);

        try {
            const response = await this.llmManager.query(prompt);
            return JSON.parse(this.extractJson(response.output));
        } catch {
            return {
                riskLevel: "unknown",
                suggestedAction: "hold",
                reasoning: "LLM unavailable — defaulting to hold",
            };
        }
    }

    /**
     * Ask the LLM for a trading recommendation.
     */
    async getTradingAdvice(
        asset: string,
        strategy: string
    ): Promise<TaskCandidate> {
        const prompt = tradingPrompt(asset, strategy);

        try {
            const response = await this.llmManager.query(prompt);
            return this.parseResponse(response.output);
        } catch {
            return { action: "hold", reasoning: "LLM unavailable" };
        }
    }

    /**
     * Parse LLM response into a TaskCandidate.
     */
    private parseResponse(output: string): TaskCandidate {
        try {
            const json = this.extractJson(output);
            return JSON.parse(json);
        } catch {
            return { action: "hold", reasoning: "Failed to parse LLM output" };
        }
    }

    /**
     * Extract JSON from LLM output (handles markdown code blocks).
     */
    private extractJson(text: string): string {
        // Try to find JSON in code block
        const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (codeBlockMatch) return codeBlockMatch[1].trim();

        // Try to find raw JSON
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) return jsonMatch[0];

        return text;
    }
}

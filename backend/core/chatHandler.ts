import { Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { LLMManager } from "../llm/llmManager.js";
import { PolicyEngine } from "../services/policyEngine.js";
import {
    loadAgentConfig,
    loadSkills,
    updateAgentConfig,
    AgentConfig,
    RiskProfile,
} from "./agentConfig.js";

// ─────────── Types ───────────

export interface ChatIntent {
    type: "execute_action" | "update_config" | "reload_skills" | "query_status" | "explain" | "unknown";
    action?: string;
    params?: Record<string, any>;
    configUpdates?: Partial<Pick<AgentConfig, "role" | "riskProfile" | "dailyTxLimit" | "allowedActions">>;
}

export interface ChatResponse {
    reply: string;
    intent?: ChatIntent;
    intents?: ChatIntent[];
    policyResult?: { allowed: boolean; reason?: string };
    executionResult?: any;
}

// ─────────── Chat Handler ───────────

/**
 * 4-Layer Chat Architecture:
 *   1. Chat UI → user types message
 *   2. LLM Intent Parser → extracts structured { type, action, params }
 *   3. Policy Guard → checks against config.json
 *   4. Executor → runs action or updates config
 *
 * Security: Chat NEVER bypasses policy engine.
 */
export class ChatHandler {
    private policy = new PolicyEngine();
    private conversationHistory: Map<string, { role: string; content: string }[]> = new Map();

    constructor(
        private llmManager: LLMManager,
        private connection: Connection,
    ) { }

    /**
     * Process a user message for a specific agent.
     * Supports multiple intents in a single message.
     */
    async handleMessage(agentId: string, message: string): Promise<ChatResponse> {
        const config = loadAgentConfig(agentId);
        if (!config) {
            return { reply: "⚠️ This agent has no config. Please recreate it with a role." };
        }

        const skills = loadSkills(agentId);

        // Track conversation
        if (!this.conversationHistory.has(agentId)) {
            this.conversationHistory.set(agentId, []);
        }
        const history = this.conversationHistory.get(agentId)!;
        history.push({ role: "user", content: message });

        // Keep last 10 messages for context
        if (history.length > 20) {
            history.splice(0, history.length - 20);
        }

        // Step 1: Parse intent(s) via LLM
        const intents = await this.parseIntents(agentId, message, config, skills, history);

        // Step 2: Process each intent sequentially, collect responses
        const replies: string[] = [];
        let lastResponse: ChatResponse = { reply: "" };

        for (const intent of intents) {
            let response: ChatResponse;

            switch (intent.type) {
                case "execute_action":
                    response = await this.handleExecution(agentId, intent, config);
                    break;
                case "update_config":
                    response = await this.handleConfigUpdate(agentId, intent, config);
                    break;
                case "reload_skills":
                    response = this.handleSkillReload(agentId);
                    break;
                case "query_status":
                    response = await this.handleQuery(agentId, config);
                    break;
                case "explain":
                    response = this.handleExplain(agentId, config, skills);
                    break;
                default:
                    response = await this.handleConversation(agentId, message, config, skills, history);
                    break;
            }

            replies.push(response.reply);
            lastResponse = response;
        }

        const combined: ChatResponse = {
            reply: replies.join("\n\n---\n\n"),
            intent: intents[0],
            intents,
            policyResult: lastResponse.policyResult,
            executionResult: lastResponse.executionResult,
        };

        history.push({ role: "assistant", content: combined.reply });
        return combined;
    }

    /**
     * Parse user message into one or more structured intents using LLM.
     * Supports synonyms like "recover lost SOL", "scan for risks", "check safety".
     */
    private async parseIntents(
        agentId: string,
        message: string,
        config: AgentConfig,
        skills: string,
        history: { role: string; content: string }[],
    ): Promise<ChatIntent[]> {
        const prompt = `You are an intent parser for a Solana wallet agent named "${agentId}".
The agent has these capabilities: ${config.allowedActions.join(", ")}
Role: ${config.role} | Max SOL/tx: ${config.maxSolPerTx} | Daily limit: ${config.dailyTxLimit}

Parse the user's message into ONE OR MORE structured JSON intents. 
If the user gives MULTIPLE instructions in one message, return an ARRAY of intents.
If the user gives a SINGLE instruction, still return an ARRAY with one item.
Respond with ONLY a valid JSON array, no other text.

ACTION MAPPING (use these mappings for synonyms):
- "recover", "recover SOL", "recover lost SOL", "reclaim rent", "close empty accounts", "clean up wallet" → action: "recover"
- "scan", "scan airdrops", "check airdrops" → action: "scan_airdrops"
- "scan for risk", "check for scams", "check safety", "check token", "is this safe", "analyze token", "scam check", "rug check" → action: "scam_check"
- "transfer", "send", "send SOL", "pay" → action: "transfer"
- "swap", "trade", "exchange", "buy", "sell" → action: "swap"
- "airdrop", "get SOL", "airdrop me", "fund me", "fund wallet", "give me SOL" → action: "airdrop"

Intent types:
- "execute_action": User wants to perform an action. The action field maps to: transfer, swap, recover, scan_airdrops, scam_check, airdrop
- "update_config": User wants to change agent settings (risk profile, daily limit, role)
- "reload_skills": User wants agent to reload its SKILLS.md
- "query_status": User asks about balance, status, portfolio, or history
- "explain": User asks what the agent can do, its config, or capabilities
- "unknown": General conversation, questions, or unclear intent

Format (always return an array):
[
  { "type": "execute_action", "action": "recover", "params": {} },
  { "type": "execute_action", "action": "scam_check", "params": {} }
]

Examples:
"Send 0.1 SOL to ABC123" → [{"type":"execute_action","action":"transfer","params":{"to":"ABC123","amount":"0.1"}}]
"Recover lost SOL" → [{"type":"execute_action","action":"recover","params":{}}]
"Recover rent" → [{"type":"execute_action","action":"recover","params":{}}]
"Scan for risk" → [{"type":"execute_action","action":"scam_check","params":{}}]
"Check my tokens for scams" → [{"type":"execute_action","action":"scam_check","params":{}}]
"Is this token safe? ABC123" → [{"type":"execute_action","action":"scam_check","params":{"mint":"ABC123"}}]
"Scan for airdrops" → [{"type":"execute_action","action":"scan_airdrops","params":{}}]
"Airdrop me SOL and then scan my wallet" → [{"type":"execute_action","action":"airdrop","params":{}},{"type":"execute_action","action":"scan_airdrops","params":{}}]
"Send 0.5 SOL to XYZ and recover rent" → [{"type":"execute_action","action":"transfer","params":{"to":"XYZ","amount":"0.5"}},{"type":"execute_action","action":"recover","params":{}}]
"Switch to low risk and reload skills" → [{"type":"update_config","configUpdates":{"riskProfile":"low"}},{"type":"reload_skills"}]
"What's my balance?" → [{"type":"query_status"}]
"What can you do?" → [{"type":"explain"}]
"Hello" → [{"type":"unknown"}]
"Clean up my wallet" → [{"type":"execute_action","action":"recover","params":{}}]
"Airdrop me SOL, scan for scams, and recover rent" → [{"type":"execute_action","action":"airdrop","params":{}},{"type":"execute_action","action":"scam_check","params":{}},{"type":"execute_action","action":"recover","params":{}}]

User message: "${message}"`;

        try {
            const raw = await this.llmManager.complete(prompt, 600);
            // Extract JSON array from response
            const arrayMatch = raw.match(/\[[\s\S]*\]/);
            if (arrayMatch) {
                const parsed = JSON.parse(arrayMatch[0]);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    return parsed as ChatIntent[];
                }
            }
            // Fallback: try single object
            const objMatch = raw.match(/\{[\s\S]*\}/);
            if (objMatch) {
                return [JSON.parse(objMatch[0]) as ChatIntent];
            }
        } catch (err) {
            console.error("[ChatHandler] Intent parse error:", err);
        }

        return [{ type: "unknown" }];
    }

    /**
     * Handle action execution with policy check.
     */
    private async handleExecution(
        agentId: string,
        intent: ChatIntent,
        config: AgentConfig,
    ): Promise<ChatResponse> {
        const action = intent.action || "unknown";
        const params = intent.params || {};

        // Policy check — NEVER bypassed
        const policyResult = await this.policy.check(agentId, action, params);

        if (!policyResult.allowed) {
            return {
                reply: `⛔ **Policy Denied**\n\n${policyResult.reason}\n\nYour limits: max ${config.maxSolPerTx} SOL/tx, ${config.dailyTxLimit} txs/day, allowed: [${config.allowedActions.join(", ")}].`,
                intent,
                policyResult,
            };
        }

        // Policy passed — return intent for backend to execute
        return {
            reply: `✅ **Policy Approved** — executing \`${action}\` with params: ${JSON.stringify(params)}`,
            intent,
            policyResult,
        };
    }

    /**
     * Handle config updates with validation.
     */
    private async handleConfigUpdate(
        agentId: string,
        intent: ChatIntent,
        currentConfig: AgentConfig,
    ): Promise<ChatResponse> {
        const updates = intent.configUpdates;
        if (!updates || Object.keys(updates).length === 0) {
            return { reply: "I couldn't determine what config changes you want. Try something like:\n- \"Switch to low risk mode\"\n- \"Set daily limit to 5\"\n- \"Only allow transfers\"" };
        }

        // Validate risk profile
        if (updates.riskProfile && !["low", "medium", "high"].includes(updates.riskProfile)) {
            return { reply: `Invalid risk profile "${updates.riskProfile}". Choose: low, medium, or high.` };
        }

        try {
            const updated = updateAgentConfig(agentId, updates);
            const changes = Object.entries(updates)
                .map(([k, v]) => `- **${k}**: ${JSON.stringify(v)}`)
                .join("\n");

            return {
                reply: `✅ **Configuration Updated**\n\n${changes}\n\nNew config summary:\n- Role: ${updated.role}\n- Risk: ${updated.riskProfile}\n- Max SOL/tx: ${updated.maxSolPerTx}\n- Daily limit: ${updated.dailyTxLimit}\n- Actions: [${updated.allowedActions.join(", ")}]`,
                intent,
            };
        } catch (err: any) {
            return { reply: `❌ Config update failed: ${err.message}` };
        }
    }

    /**
     * Reload SKILLS.md and confirm.
     */
    private handleSkillReload(agentId: string): ChatResponse {
        const skills = loadSkills(agentId);
        const lines = skills.split("\n").filter(l => l.trim()).length;
        return {
            reply: `🔄 **Skills Reloaded**\n\nRead ${lines} lines from SKILLS.md. My current capabilities are updated.\n\nKey sections found:\n${skills.match(/^# .+$/gm)?.map(h => `- ${h}`)?.join("\n") || "- No sections found"}`,
            intent: { type: "reload_skills" },
        };
    }

    /**
     * Handle status queries.
     */
    private async handleQuery(agentId: string, config: AgentConfig): Promise<ChatResponse> {
        // Return config + balance info for backend to enrich
        return {
            reply: `📊 **Agent Status: ${agentId}**\n\n- Role: ${config.role}\n- Risk Profile: ${config.riskProfile}\n- Max SOL/tx: ${config.maxSolPerTx}\n- Daily Limit: ${config.dailyTxLimit}\n- Allowed Actions: [${config.allowedActions.join(", ")}]\n- Created: ${new Date(config.createdAt).toLocaleDateString()}`,
            intent: { type: "query_status" },
        };
    }

    /**
     * Explain capabilities.
     */
    private handleExplain(agentId: string, config: AgentConfig, skills: string): ChatResponse {
        return {
            reply: `🤖 **I am ${agentId}** — a ${config.role} agent on Solana devnet.\n\n**What I can do:**\n${config.allowedActions.map(a => `- \`${a}\``).join("\n")}\n\n**My limits:**\n- Max ${config.maxSolPerTx} SOL per transaction\n- ${config.dailyTxLimit} transactions per day\n- Risk profile: ${config.riskProfile}\n\n**My strategy:**\n${skills.split("\n").slice(0, 10).join("\n")}...\n\nAsk me to do something, or say "reload your skills" to update my behavior.`,
            intent: { type: "explain" },
        };
    }

    /**
     * General conversation — use LLM with agent context.
     */
    private async handleConversation(
        agentId: string,
        message: string,
        config: AgentConfig,
        skills: string,
        history: { role: string; content: string }[],
    ): Promise<ChatResponse> {
        const systemPrompt = `You are "${agentId}", a ${config.role} agent on Solana devnet.
Your skills and strategy are defined in your SKILLS.md:

${skills}

Your config:
- Max SOL/tx: ${config.maxSolPerTx}
- Daily limit: ${config.dailyTxLimit}
- Allowed actions: ${config.allowedActions.join(", ")}
- Risk profile: ${config.riskProfile}

Respond helpfully and in character. Be concise. If the user wants you to do something, explain what action you'd take and ask them to confirm. You cannot directly execute — only through the policy system.

Recent conversation:
${history.slice(-6).map(m => `${m.role}: ${m.content}`).join("\n")}`;

        try {
            const reply = await this.llmManager.complete(
                systemPrompt + `\n\nUser: ${message}\nAssistant:`,
                300,
            );
            return { reply: reply.trim() };
        } catch (err: any) {
            return { reply: `I'm having trouble thinking right now. (${err.message})` };
        }
    }
}

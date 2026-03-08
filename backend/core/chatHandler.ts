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
import { loadMemory, setPreference, addNote, memoryToPrompt } from "./memory.js";
import { getMarketData, marketToPrompt } from "../services/marketData.js";

// ─────────── Types ───────────

export interface ChatIntent {
    type: "execute_action" | "update_config" | "reload_skills" | "query_status" | "query_balance" | "explain" | "schedule" | "unschedule" | "delay" | "remember" | "market_query" | "capability_check" | "unknown";
    action?: string;
    params?: Record<string, any>;
    configUpdates?: Partial<Pick<AgentConfig, "role" | "riskProfile" | "dailyTxLimit" | "allowedActions">>;
    interval?: string;  // e.g. "6h", "30m", "daily" — for schedule intent
    delay?: string;     // e.g. "6h", "30m", "2h" — for delay (one-shot) intent
}

// ─────────── Safe Interval → Cron ───────────
// LLM NEVER generates cron directly. Only these safe intervals are accepted.

const INTERVAL_MAP: Record<string, string> = {
    "1m": "* * * * *",
    "5m": "*/5 * * * *",
    "10m": "*/10 * * * *",
    "15m": "*/15 * * * *",
    "30m": "*/30 * * * *",
    "1h": "0 * * * *",
    "2h": "0 */2 * * *",
    "3h": "0 */3 * * *",
    "4h": "0 */4 * * *",
    "6h": "0 */6 * * *",
    "8h": "0 */8 * * *",
    "12h": "0 */12 * * *",
    "24h": "0 0 * * *",
    "daily": "0 0 * * *",
    "hourly": "0 * * * *",
    "weekly": "0 0 * * 0",
    "minute": "* * * * *",
    "hour": "0 * * * *",
    "every minute": "* * * * *",
    "every hour": "0 * * * *",
    "every day": "0 0 * * *",
    "every week": "0 0 * * 0",
    "every 2 hours": "0 */2 * * *",
    "every 3 hours": "0 */3 * * *",
    "every 4 hours": "0 */4 * * *",
    "every 5 minutes": "*/5 * * * *",
    "every 10 minutes": "*/10 * * * *",
    "every 15 minutes": "*/15 * * * *",
    "every 30 minutes": "*/30 * * * *",
    "every 6 hours": "0 */6 * * *",
    "every 8 hours": "0 */8 * * *",
    "every 12 hours": "0 */12 * * *",
};

export function intervalToCron(interval: string): string | null {
    const key = interval.toLowerCase().trim();

    // Check exact map first
    if (INTERVAL_MAP[key]) return INTERVAL_MAP[key];

    // Dynamic parsing: "5 hours", "3 hours", "45 minutes", "2 days"
    const match = key.match(/^(?:every\s+)?(\d+)\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)$/);
    if (match) {
        const n = parseInt(match[1]);
        const unit = match[2].charAt(0); // m, h, or d

        if (unit === "m" && n >= 1 && n <= 59) {
            return `*/${n} * * * *`;
        }
        if (unit === "h" && n >= 1 && n <= 24) {
            if (n === 1) return "0 * * * *";
            return `0 */${n} * * *`;
        }
        if (unit === "d" && n >= 1 && n <= 7) {
            return `0 0 */${n} * *`;
        }
    }

    return null;
}

// ─────────── Safe Delay → Milliseconds ───────────
// LLM provides human-readable delay, we convert safely.

const DELAY_MAP: Record<string, number> = {
    "1m": 60_000,
    "5m": 300_000,
    "10m": 600_000,
    "15m": 900_000,
    "30m": 1_800_000,
    "1h": 3_600_000,
    "2h": 7_200_000,
    "3h": 10_800_000,
    "4h": 14_400_000,
    "6h": 21_600_000,
    "8h": 28_800_000,
    "12h": 43_200_000,
    "24h": 86_400_000,
    "in 1 minute": 60_000,
    "in 5 minutes": 300_000,
    "in 10 minutes": 600_000,
    "in 30 minutes": 1_800_000,
    "in 1 hour": 3_600_000,
    "in 2 hours": 7_200_000,
    "in 3 hours": 10_800_000,
    "in 6 hours": 21_600_000,
    "in 12 hours": 43_200_000,
    "in 24 hours": 86_400_000,
};

export function delayToMs(delay: string): number | null {
    const key = delay.toLowerCase().trim();

    // Check exact map first
    if (DELAY_MAP[key] != null) return DELAY_MAP[key];

    // Dynamic parsing: "6 hours", "in 45 minutes", "after 2h", "30 min"
    const match = key.match(/^(?:in\s+|after\s+)?(\d+)\s*(m|min|mins|minutes?|h|hr|hrs|hours?)$/);
    if (match) {
        const n = parseInt(match[1]);
        const unit = match[2].charAt(0); // m or h

        if (unit === "m" && n >= 1 && n <= 1440) {
            return n * 60_000;
        }
        if (unit === "h" && n >= 1 && n <= 24) {
            return n * 3_600_000;
        }
    }

    return null;
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
                case "query_balance":
                    response = { reply: "Checking your wallet balance...", intent };
                    break;
                case "query_status":
                    response = await this.handleQuery(agentId, config);
                    break;
                case "explain":
                    response = this.handleExplain(agentId, config, skills);
                    break;
                case "schedule":
                    response = this.handleSchedule(agentId, intent, config);
                    break;
                case "unschedule":
                    response = this.handleUnschedule(agentId, intent);
                    break;
                case "delay":
                    response = this.handleDelay(agentId, intent, config);
                    break;
                case "remember":
                    response = this.handleRemember(agentId, intent);
                    break;
                case "market_query":
                    response = await this.handleMarketQuery(agentId, config);
                    break;
                case "capability_check":
                    response = this.handleCapabilityCheck(agentId, intent, config);
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
     * Parse a single command string into one intent.
     * Used by parseIntents for both single and multi-command messages.
     */
    private parseSingleCommand(msg: string): ChatIntent | null {
        // Stop / Cancel / Unschedule
        const stopMatch = msg.match(/^(?:stop|cancel|unschedule|remove|disable)\s+(.+)/i);
        if (stopMatch) {
            const target = stopMatch[1].toLowerCase();
            let action = "all";
            if (target.match(/scam|safety|rug/)) action = "scam_check";
            if (target.match(/airdrop/)) action = "scan_airdrops";
            if (target.match(/recover|rent|clean/)) action = "recover";
            if (target.match(/transfer|send/)) action = "transfer";
            if (target.match(/swap|trade/)) action = "swap";
            return { type: "unschedule", action };
        }

        // Schedule: "X every Y"
        const schedMatch = msg.match(/(.+?)\s+every\s+(.+)/i);
        if (schedMatch) {
            const ap = schedMatch[1].toLowerCase();
            let action = "scam_check";
            if (ap.match(/airdrop/)) action = "scan_airdrops";
            if (ap.match(/recover|rent/)) action = "recover";
            if (ap.match(/transfer|send/)) action = "transfer";
            if (ap.match(/swap/)) action = "swap";
            if (ap.match(/scan/) && !ap.match(/airdrop/)) action = "scam_check";
            return { type: "schedule", action, interval: schedMatch[2].trim() };
        }

        // ─── DELAY DETECTION ───
        // Must come BEFORE swap/transfer so "transfer 0.1 SOL to XYZ in 6 hours" is delay, not execute.
        // Matches: "... in 6 hours", "... in 30 minutes", "... in 2h", "... after 1 hour"
        const delayTimeMatch = msg.match(/\b(?:in|after)\s+(\d+\s*(?:m|min|mins|minutes?|h|hr|hrs|hours?))\s*$/i);
        if (delayTimeMatch) {
            const delayStr = delayTimeMatch[1].trim();
            const ms = delayToMs(delayStr);
            if (ms) {
                // Strip the time part to identify the action from the rest
                const actionPart = msg.slice(0, msg.lastIndexOf(delayTimeMatch[0])).trim();

                // Swap with delay: "swap 1 SOL for USDC in 6 hours"
                const swapDelay = actionPart.match(/(?:swap|trade|exchange)\s+([\d.]+)\s+(\w+)\s+(?:to|for|into)\s+(\w+)/i);
                if (swapDelay) {
                    return { type: "delay", action: "swap", delay: delayStr, params: { amount: swapDelay[1], from: swapDelay[2].toUpperCase(), to: swapDelay[3] } };
                }

                // Transfer with delay: "send 0.1 SOL to ABC123 in 6 hours" or "send 0.1 SOL to TraderBot in 6 hours"
                const transferDelay = actionPart.match(/(?:send|transfer|pay)\s+([\d.]+)\s+(\w+)\s+to\s+([A-Za-z0-9_]+)/i);
                if (transferDelay) {
                    return { type: "delay", action: "transfer", delay: delayStr, params: { amount: transferDelay[1], token: transferDelay[2].toUpperCase(), to: transferDelay[3] } };
                }

                // Generic action with delay: "airdrop in 30 minutes", "recover in 2 hours"
                let action = "unknown";
                if (actionPart.match(/\b(airdrop|fund me|give me sol)\b/i)) action = "airdrop";
                else if (actionPart.match(/\b(recover|reclaim|close empty|clean up)\b/i)) action = "recover";
                else if (actionPart.match(/\b(scam|rug|safety|check token|scan.*scam)\b/i)) action = "scam_check";
                else if (actionPart.match(/\b(scan airdrop|check airdrop)\b/i)) action = "scan_airdrops";
                else if (actionPart.match(/\b(swap|trade|exchange)\b/i)) action = "swap";
                else if (actionPart.match(/\b(send|transfer|pay)\b/i)) action = "transfer";

                if (action !== "unknown") {
                    return { type: "delay", action, delay: delayStr, params: {} };
                }
            }
        }

        // Swap (immediate — no time qualifier detected above)
        const swapMatch = msg.match(/(?:swap|trade|exchange)\s+([\d.]+)\s+(\w+)\s+(?:to|for|into)\s+(\w+)/i);
        if (swapMatch) {
            return { type: "execute_action", action: "swap", params: { amount: swapMatch[1], from: swapMatch[2].toUpperCase(), to: swapMatch[3] } };
        }

        // Transfer (immediate — no time qualifier detected above)
        // Accepts both wallet addresses (20+ chars) and agent names (e.g. "TraderBot")
        const transferMatch = msg.match(/(?:send|transfer|pay)\s+([\d.]+)\s+(\w+)\s+to\s+([A-Za-z0-9_]+)/i);
        if (transferMatch) {
            return { type: "execute_action", action: "transfer", params: { amount: transferMatch[1], token: transferMatch[2].toUpperCase(), to: transferMatch[3] } };
        }

        // Balance
        if (msg.match(/\b(balance|how much|portfolio)\b/)) return { type: "query_balance" };

        // Status
        if (msg.match(/\b(status|info)\b/) && !msg.match(/balance/)) return { type: "query_status" };

        // Scan airdrops — MUST come before generic "airdrop" to avoid false match
        if (msg.match(/\b(scan airdrop|check airdrop|scan for airdrop)/)) return { type: "execute_action", action: "scan_airdrops", params: {} };

        // Airdrop (faucet) — only if NOT preceded by "scan" or "check"
        if (msg.match(/\b(airdrop|fund me|give me sol|get sol)\b/) && !msg.match(/\b(scan|check)\s+(for\s+)?airdrop/)) return { type: "execute_action", action: "airdrop", params: {} };

        // Scam check
        if (msg.match(/\b(scam|rug|safety|check token)/)) return { type: "execute_action", action: "scam_check", params: {} };

        // Recover
        if (msg.match(/\b(recover|reclaim|close empty|clean up)/)) return { type: "execute_action", action: "recover", params: {} };

        // Price / Market
        if (msg.match(/\b(price|market|how.?s the market|sol price|price of sol|market update|market data)\b/i)) return { type: "market_query" };

        // Explain / help
        if (msg.match(/\b(what can you|capabilities|help me|what do you)\b/)) return { type: "explain" };

        return null;
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
        // ═══════════════════════════════════════════
        // DETERMINISTIC PRE-PARSER (works without LLM)
        // ═══════════════════════════════════════════
        const msg = message.toLowerCase().trim();

        // ──── MULTI-COMMAND SPLITTER ────
        // "scan scams and check balance", "check balance, then scan airdrops"
        if (msg.match(/\b(and|,\s*|then\s+|also\s+)/)) {
            const parts = msg.split(/\s*(?:\band\b|,|\bthen\b|\balso\b)\s*/i).filter(p => p.trim());
            if (parts.length > 1) {
                const allIntents: ChatIntent[] = [];
                for (const part of parts) {
                    const intent = this.parseSingleCommand(part.trim());
                    if (intent) allIntents.push(intent);
                }
                if (allIntents.length > 0) return allIntents;
            }
        }

        // Single command
        const single = this.parseSingleCommand(msg);
        if (single) return [single];

        // ═══════════════════════════════════════════
        // LLM PARSER (for ambiguous messages only)
        // ═══════════════════════════════════════════
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

- "schedule", "schedule task", "run every", "every X hours", "repeat", "automate" → type: "schedule" (with action + interval fields)
- "stop schedule", "cancel schedule", "unschedule", "stop repeating", "remove schedule" → type: "unschedule" (with action field)
- "in X hours", "in X minutes", "after X hours", "later", "delayed" → type: "delay" (with action + delay + params fields. This is ONE-TIME execution, not repeating)

- "remember", "I prefer", "note that", "keep in mind", "my preference", "what do you remember" → type: "remember" (with params.preference or params.note)
- "what's the price", "SOL price", "market", "how's the market", "price of solana", "market update" → type: "market_query"

Intent types:
- "execute_action": User wants to perform an action NOW
- "schedule": User wants to SCHEDULE an action to REPEAT automatically. Must include action and interval fields.
  Valid intervals: "5m", "10m", "15m", "30m", "1h", "2h", "3h", "4h", "6h", "8h", "12h", "24h", "daily", "hourly"
- "delay": User wants to execute an action ONCE after a delay. Must include action, delay, and params fields.
  Valid delays: "1m", "5m", "10m", "30m", "1h", "2h", "3h", "6h", "12h", "24h"
- "unschedule": User wants to STOP/CANCEL a scheduled action. Must include action field.
- "update_config": User wants to change agent settings (risk profile, daily limit, role)
- "reload_skills": User wants agent to reload its SKILLS.md
- "query_status": User EXPLICITLY asks for agent status, settings, or portfolio overview ("show status", "what are my settings")
- "remember": User wants agent to remember a preference or note. Store in params.preference (key:value) or params.note (string)
- "market_query": User asks about SOL price, market conditions, or trends
- "capability_check": User asks about something the agent CANNOT do or an UNKNOWN feature ("can you bridge to Ethereum?", "do you support staking?", "can you do NFTs?"). NEVER use this for supported actions like transfer, swap, scan, recover.
- "explain": User asks for a FULL LIST of capabilities ("what can you do?", "list your capabilities")
- "unknown": General conversation, questions, greetings, help requests, or unclear intent. Use this for casual questions like "can you help me transfer SOL?" — respond conversationally, NOT with a capability dump.

CRITICAL RULES:
- If the user says "can you help me [supported action]" or "help me [supported action]", classify as "unknown" so the agent responds conversationally with guidance. Do NOT use capability_check for supported actions.
- If user says "transfer SOL in X hours" or "swap in X hours", this is a DELAY, not an immediate execute_action. Always use type: "delay".
- query_status should ONLY trigger for explicit status requests. For questions like "show my balance" use query_balance instead.

Format (always return an array):
[
  { "type": "schedule", "action": "scam_check", "interval": "6h" }
]

Examples:
"Send 0.1 SOL to ABC123" → [{"type":"execute_action","action":"transfer","params":{"to":"ABC123","amount":"0.1"}}]
"Recover lost SOL" → [{"type":"execute_action","action":"recover","params":{}}]
"Scan for risk" → [{"type":"execute_action","action":"scam_check","params":{}}]
"Is this token safe? ABC123" → [{"type":"execute_action","action":"scam_check","params":{"mint":"ABC123"}}]
"Scan for airdrops" → [{"type":"execute_action","action":"scan_airdrops","params":{}}]
"Airdrop me SOL and recover rent" → [{"type":"execute_action","action":"airdrop","params":{}},{"type":"execute_action","action":"recover","params":{}}]
"Switch to low risk and reload skills" → [{"type":"update_config","configUpdates":{"riskProfile":"low"}},{"type":"reload_skills"}]
"Scan for scam tokens every 6 hours" → [{"type":"schedule","action":"scam_check","interval":"6h"}]
"Check for airdrops every hour" → [{"type":"schedule","action":"scan_airdrops","interval":"1h"}]
"Recover rent daily" → [{"type":"schedule","action":"recover","interval":"daily"}]
"Run scam check every 30 minutes" → [{"type":"schedule","action":"scam_check","interval":"30m"}]
"Transfer 0.01 SOL to XYZ every 12 hours" → [{"type":"schedule","action":"transfer","interval":"12h","params":{"to":"XYZ","amount":"0.01"}}]
"Transfer 0.1 SOL to ABC in 6 hours" → [{"type":"delay","action":"transfer","delay":"6h","params":{"to":"ABC","amount":"0.1"}}]
"Send 0.5 SOL to XYZ in 2 hours" → [{"type":"delay","action":"transfer","delay":"2h","params":{"to":"XYZ","amount":"0.5"}}]
"Airdrop me SOL in 30 minutes" → [{"type":"delay","action":"airdrop","delay":"30m","params":{}}]
"Scan for scams in 1 hour" → [{"type":"delay","action":"scam_check","delay":"1h","params":{}}]
"Recover rent in 3 hours" → [{"type":"delay","action":"recover","delay":"3h","params":{}}]
"Stop scanning for scams" → [{"type":"unschedule","action":"scam_check"}]
"Cancel the scheduled recover" → [{"type":"unschedule","action":"recover"}]
"Stop all scheduled tasks" → [{"type":"unschedule","action":"all"}]
"What can you do?" → [{"type":"explain"}]
"What's my balance?" → [{"type":"query_status"}]
"I prefer conservative strategies" → [{"type":"remember","params":{"preference":{"strategy":"conservative"}}}]
"Remember that I don't like risky trades" → [{"type":"remember","params":{"note":"User doesn't like risky trades"}}]
"What do you remember about me?" → [{"type":"remember","params":{"recall":true}}]
"What's the SOL price?" → [{"type":"market_query"}]
"How's the market?" → [{"type":"market_query"}]
"Can you bridge SOL to Ethereum?" → [{"type":"capability_check","params":{"capability":"bridge"}}]
"Can you trade ETH?" → [{"type":"capability_check","params":{"capability":"trade ETH"}}]
"Do you support staking?" → [{"type":"capability_check","params":{"capability":"staking"}}]
"Can you do NFTs?" → [{"type":"capability_check","params":{"capability":"NFT operations"}}]
"Can you lend SOL?" → [{"type":"capability_check","params":{"capability":"lending"}}]
"Hello" → [{"type":"unknown"}]

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
        const raw = intent.configUpdates;
        if (!raw || Object.keys(raw).length === 0) {
            return { reply: "I couldn't determine what config changes you want. Try something like:\n- \"Switch to low risk mode\"\n- \"Set daily limit to 5\"\n- \"Only allow transfers\"" };
        }

        // Normalize LLM key names → internal config keys
        const keyMap: Record<string, string> = {
            dailylimit: "dailyTxLimit",
            daily_limit: "dailyTxLimit",
            dailytxlimit: "dailyTxLimit",
            dailycap: "dailyTxLimit",
            daily_cap: "dailyTxLimit",
            maxsol: "maxSolPerTx",
            max_sol: "maxSolPerTx",
            maxsolpertx: "maxSolPerTx",
            max_sol_per_tx: "maxSolPerTx",
            risk: "riskProfile",
            riskprofile: "riskProfile",
            risk_profile: "riskProfile",
            riskmode: "riskProfile",
            role: "role",
            allowedactions: "allowedActions",
            allowed_actions: "allowedActions",
            actions: "allowedActions",
        };

        const updates: any = {};
        for (const [k, v] of Object.entries(raw)) {
            const normalized = keyMap[k.toLowerCase()] || k;
            updates[normalized] = v;
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
        const actionDescriptions: Record<string, string> = {
            transfer: "Send SOL to any wallet address",
            recover: "Scan & close empty token accounts to reclaim rent",
            scam_check: "Analyze tokens for scam indicators (freeze auth, supply concentration, metadata)",
            scan_airdrops: "Scan wallet for airdropped tokens",
            airdrop: "Request devnet SOL (1 SOL per request)",
        };

        const actionList = config.allowedActions
            .map(a => `  - ${a}: ${actionDescriptions[a] || "Custom action"}`)
            .join("\n");

        return {
            reply: `🤖 I'm ${agentId}, a ${config.role} agent on Solana devnet.\n\nHere's what I can do:\n${actionList}\n\nMy limits:\n  - Max ${config.maxSolPerTx} SOL per transaction\n  - ${config.dailyTxLimit} transactions per day\n  - Risk profile: ${config.riskProfile}\n\nI can also schedule tasks, check market prices, and remember your preferences. Just ask!`,
            intent: { type: "explain" },
        };
    }

    /**
     * Capability guard — mature rejection for unsupported capabilities.
     */
    private handleCapabilityCheck(agentId: string, intent: ChatIntent, config: AgentConfig): ChatResponse {
        const capability = intent.params?.capability || "unknown";
        const capLower = capability.toLowerCase();

        // Map of known platform capabilities and whether this agent supports them
        const KNOWN_CAPABILITIES: Record<string, { supported: boolean; action?: string }> = {
            transfer: { supported: true, action: "transfer" },
            send: { supported: true, action: "transfer" },
            recover: { supported: true, action: "recover" },
            "scam check": { supported: true, action: "scam_check" },
            "scan airdrops": { supported: true, action: "scan_airdrops" },
            airdrop: { supported: true, action: "airdrop" },
            schedule: { supported: true },
            memory: { supported: true },
            "market data": { supported: true },
        };

        // Check if it's a known supported capability
        for (const [key, val] of Object.entries(KNOWN_CAPABILITIES)) {
            if (capLower.includes(key)) {
                if (val.action && !config.allowedActions.includes(val.action)) {
                    return {
                        reply: `I have the "${val.action}" capability built in, but it's not currently enabled for me. You can enable it in my configuration settings.`,
                    };
                }
                return {
                    reply: `Yes! I can ${key}. Just tell me what you need and I'll handle it.`,
                };
            }
        }

        // Unsupported capability — clean, mature rejection
        const unsupportedCapabilities = [
            "bridge", "bridging", "cross-chain",
            "eth", "ethereum", "bitcoin", "btc", "polygon", "avalanche", "arbitrum",
            "staking", "stake", "unstake", "delegate",
            "nft", "nfts", "mint nft", "create nft",
            "lending", "lend", "borrow", "borrowing",
            "yield farming", "farming", "yield",
            "margin", "leverage", "futures", "perpetual",
            "options", "derivatives",
        ];

        const isKnownUnsupported = unsupportedCapabilities.some(u => capLower.includes(u));

        if (isKnownUnsupported) {
            return {
                reply: `I'm not configured to perform ${capability}. My current capabilities are focused on Solana devnet operations: ${config.allowedActions.join(", ")}.\n\nThis isn't a limitation of the platform — it just hasn't been enabled for me. You can add new capabilities through my configuration, or I can operate in a read-only research mode if that helps.`,
            };
        }

        // Completely unknown
        return {
            reply: `I don't recognize "${capability}" as something I can do. Here's what I'm capable of: ${config.allowedActions.join(", ")}, scheduling, market data, and memory.\n\nIf you need something outside my current scope, let me know and I can suggest alternatives.`,
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
${memoryToPrompt(agentId)}
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

    /**
     * Handle scheduling — converts natural language intervals to cron safely.
     * LLM NEVER generates cron. Only validated intervals are accepted.
     */
    private handleSchedule(
        agentId: string,
        intent: ChatIntent,
        config: AgentConfig,
    ): ChatResponse {
        const action = intent.action;
        const interval = intent.interval;

        if (!action) {
            return { reply: "⚠️ I need to know WHAT to schedule. Try: \"Scan for scams every 6 hours\"" };
        }

        if (!interval) {
            return { reply: `⚠️ I need to know HOW OFTEN to run \`${action}\`. Try: \"every 6h\", \"daily\", \"every 30m\"` };
        }

        // Safe interval → cron conversion (NEVER trust LLM-generated cron)
        const cron = intervalToCron(interval);
        if (!cron) {
            const validIntervals = Object.keys(INTERVAL_MAP).slice(0, 12).join(", ");
            return { reply: `⚠️ Invalid interval \"${interval}\". Supported: ${validIntervals}` };
        }

        // Policy check — is this action allowed?
        if (!config.allowedActions.includes(action) && action !== "airdrop" && action !== "scam_check") {
            return {
                reply: `⛔ Cannot schedule \`${action}\` — not in your allowed actions [${config.allowedActions.join(", ")}].`,
                intent,
            };
        }

        // Return intent for backend to execute via BullMQ
        return {
            reply: `⏰ **Schedule Approved**\n\nAction: \`${action}\`\nInterval: **${interval}** (cron: \`${cron}\`)\n\nCreating scheduled job...`,
            intent: { ...intent, params: { ...intent.params, cron } },
        };
    }

    /**
     * Handle unscheduling — removes scheduled jobs.
     */
    private handleUnschedule(agentId: string, intent: ChatIntent): ChatResponse {
        const action = intent.action;

        if (!action) {
            return { reply: "⚠️ I need to know WHAT to unschedule. Try: \"Stop scanning for scams\" or \"Stop all scheduled tasks\"" };
        }

        return {
            reply: `🛑 **Unschedule Requested**\n\nRemoving scheduled \`${action}\` job(s)...`,
            intent,
        };
    }

    /**
     * Handle delayed one-shot execution.
     * e.g. "Transfer 0.1 SOL to XYZ in 6 hours"
     */
    private handleDelay(
        agentId: string,
        intent: ChatIntent,
        config: AgentConfig,
    ): ChatResponse {
        const action = intent.action;
        const delay = intent.delay;

        if (!action) {
            return { reply: "⚠️ I need to know WHAT to do. Try: \"Transfer 0.1 SOL to XYZ in 6 hours\"" };
        }

        if (!delay) {
            return { reply: `⚠️ I need to know WHEN to run \`${action}\`. Try: \"in 1h\", \"in 6 hours\", \"in 30m\"` };
        }

        const ms = delayToMs(delay);
        if (!ms) {
            const validDelays = Object.keys(DELAY_MAP).slice(0, 13).join(", ");
            return { reply: `⚠️ Invalid delay "${delay}". Supported: ${validDelays}` };
        }

        // Policy check
        if (!config.allowedActions.includes(action) && action !== "airdrop" && action !== "scam_check") {
            return {
                reply: `⛔ Cannot delay-execute \`${action}\` — not in your allowed actions [${config.allowedActions.join(", ")}].`,
                intent,
            };
        }

        const humanTime = ms >= 3_600_000 ? `${ms / 3_600_000}h` : `${ms / 60_000}m`;
        return {
            reply: `⏳ **Delayed Execution Approved**\n\nAction: \`${action}\`\nWill execute in: **${humanTime}**\nParams: ${JSON.stringify(intent.params || {})}\n\nCreating delayed job...`,
            intent: { ...intent, params: { ...intent.params, delayMs: ms } },
        };
    }

    /**
     * Handle memory operations — store preferences, notes, recall.
     */
    private handleRemember(agentId: string, intent: ChatIntent): ChatResponse {
        const params = intent.params || {};

        // Recall — show what's remembered
        if (params.recall) {
            const mem = loadMemory(agentId);
            const prefEntries = Object.entries(mem.preferences);
            const parts: string[] = [];

            if (prefEntries.length > 0) {
                parts.push("Your preferences:\n" + prefEntries.map(([k, v]) => `  - ${k}: ${v}`).join("\n"));
            }
            if (mem.notes.length > 0) {
                parts.push("Your notes:\n" + mem.notes.map(n => `  - ${n}`).join("\n"));
            }
            if (mem.successfulActions.length > 0) {
                parts.push(`I've completed ${mem.successfulActions.length} actions successfully.`);
            }
            if (mem.lastFailures.length > 0) {
                parts.push(`${mem.lastFailures.length} recent failures logged.`);
            }

            if (parts.length === 0) {
                return { reply: "I don't have any stored memories yet. Tell me your preferences or give me notes to remember!" };
            }
            return { reply: "🧠 Here's what I remember:\n\n" + parts.join("\n\n") };
        }

        // Store preference
        if (params.preference && typeof params.preference === "object") {
            const entries = Object.entries(params.preference);
            for (const [key, value] of entries) {
                setPreference(agentId, key, String(value));
            }
            return {
                reply: `🧠 Got it! I'll remember: ${entries.map(([k, v]) => `${k} = ${v}`).join(", ")}. This will influence my decisions going forward.`,
            };
        }

        // Store note
        if (params.note) {
            addNote(agentId, String(params.note));
            return {
                reply: `📝 Noted! I've saved: "${params.note}". I'll keep this in mind.`,
            };
        }

        return { reply: "I'm not sure what to remember. Try: \"I prefer conservative strategies\" or \"Note that I only trade during weekdays\"." };
    }

    /**
     * Handle market data queries — fetch SOL price and let LLM interpret.
     */
    private async handleMarketQuery(agentId: string, config: AgentConfig): Promise<ChatResponse> {
        try {
            const snapshot = await getMarketData();

            if (snapshot.sol_price === 0) {
                return { reply: "I couldn't fetch market data right now. CoinGecko might be rate-limiting us. Try again in a minute." };
            }

            const trendEmoji = snapshot.trend === "up" ? "📈" : snapshot.trend === "down" ? "📉" : "➡️";
            const changeStr = snapshot.change_24h > 0 ? `+${snapshot.change_24h}%` : `${snapshot.change_24h}%`;
            const volStr = snapshot.volume_24h > 1_000_000_000
                ? `$${(snapshot.volume_24h / 1_000_000_000).toFixed(1)}B`
                : `$${(snapshot.volume_24h / 1_000_000).toFixed(0)}M`;

            // Feed to LLM for interpretation with agent's risk profile
            const prompt = `You are "${agentId}", a ${config.role} agent with ${config.riskProfile} risk profile.
Given this market data, provide a brief, helpful analysis in 2-3 sentences:

SOL Price: $${snapshot.sol_price}
24h Change: ${changeStr}
Trend: ${snapshot.trend}
24h Volume: ${volStr}
Market Cap: $${(snapshot.market_cap / 1_000_000_000).toFixed(1)}B

Be concise and specific. Relate it to the agent's role and risk profile.`;

            try {
                const analysis = await this.llmManager.complete(prompt, 200);
                return {
                    reply: `${trendEmoji} SOL is at $${snapshot.sol_price} (${changeStr} in 24h)\nVolume: ${volStr}\n\n${analysis.trim()}`,
                };
            } catch {
                // LLM failed — return raw data
                return {
                    reply: `${trendEmoji} SOL is at $${snapshot.sol_price} (${changeStr} in 24h)\nVolume: ${volStr} | Market Cap: $${(snapshot.market_cap / 1_000_000_000).toFixed(1)}B`,
                };
            }
        } catch (err: any) {
            return { reply: `Couldn't fetch market data: ${err.message}` };
        }
    }
}

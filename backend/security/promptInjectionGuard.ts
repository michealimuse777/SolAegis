/**
 * Prompt Injection Guard
 * 
 * Detects and blocks:
 * 1. Instruction override attempts ("ignore previous instructions", "you are now...")
 * 2. System prompt extraction ("what is your system prompt", "repeat your instructions")
 * 3. Tool/function call injection ("call function", "execute tool")
 * 4. Role manipulation ("pretend you are", "act as root")
 */

// ─────────── Detection Patterns ───────────

const INSTRUCTION_OVERRIDE_PATTERNS = [
    /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions|prompts|rules|directives)/i,
    /disregard\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts|rules)/i,
    /forget\s+(all\s+)?(previous|prior|your)\s+(instructions|prompts|rules|training)/i,
    /override\s+(your|the|all)\s+(instructions|rules|settings|config)/i,
    /new\s+instructions?\s*[:=]/i,
    /you\s+are\s+now\s+(a|an|the)\s+/i,
    /from\s+now\s+on,?\s+(you|your|ignore)/i,
    /system\s*:\s*(you|ignore|forget|override)/i,
    /\[SYSTEM\]/i,
    /\[INST\]/i,
    /<<\s*SYS\s*>>/i,
];

const SYSTEM_PROMPT_EXTRACTION_PATTERNS = [
    /what\s+(is|are)\s+(your|the)\s+(system\s+)?prompt/i,
    /show\s+(me\s+)?(your|the)\s+(system\s+)?prompt/i,
    /repeat\s+(your|the)\s+(instructions|prompt|rules|system\s+prompt)/i,
    /print\s+(your|the)\s+(instructions|prompt|rules|system\s+prompt)/i,
    /reveal\s+(your|the)\s+(instructions|prompt|rules|system\s+prompt)/i,
    /output\s+(your|the)\s+(instructions|prompt|rules|system\s+prompt)/i,
    /tell\s+me\s+(your|the)\s+(instructions|prompt|rules|system\s+prompt)/i,
    /dump\s+(your|the)\s+(instructions|prompt|rules|system\s+prompt|config)/i,
    /what\s+were\s+you\s+told/i,
    /what\s+are\s+your\s+(rules|directives|constraints)/i,
];

const TOOL_CALL_INJECTION_PATTERNS = [
    /\{\s*"?(function_call|tool_call|action)"?\s*:/i,
    /call\s+(function|tool)\s*[:=]/i,
    /execute\s+(function|tool|command)\s*[:=]/i,
    /<\s*function_call\s*>/i,
    /<\s*tool_use\s*>/i,
];

const ROLE_MANIPULATION_PATTERNS = [
    /pretend\s+(you\s+are|to\s+be)\s+(a|an|the)?\s*(admin|root|developer|god|unrestricted)/i,
    /act\s+as\s+(a|an|the)?\s*(admin|root|developer|unrestricted|jailbroken)/i,
    /you\s+have\s+been\s+(jailbroken|unlocked|freed)/i,
    /DAN\s+mode/i,
    /developer\s+mode\s+(enabled|on|active)/i,
];

// ─────────── Types ───────────

export interface InjectionCheckResult {
    safe: boolean;
    threat?: "instruction_override" | "prompt_extraction" | "tool_injection" | "role_manipulation";
    pattern?: string;
    sanitized?: string;
}

// ─────────── Main Check ───────────

/**
 * Check user input for prompt injection attempts.
 * Returns safe=true if clean, or threat details if injection detected.
 */
export function checkPromptInjection(input: string): InjectionCheckResult {
    // Check instruction overrides
    for (const pattern of INSTRUCTION_OVERRIDE_PATTERNS) {
        if (pattern.test(input)) {
            return {
                safe: false,
                threat: "instruction_override",
                pattern: pattern.source,
            };
        }
    }

    // Check system prompt extraction
    for (const pattern of SYSTEM_PROMPT_EXTRACTION_PATTERNS) {
        if (pattern.test(input)) {
            return {
                safe: false,
                threat: "prompt_extraction",
                pattern: pattern.source,
            };
        }
    }

    // Check tool call injection
    for (const pattern of TOOL_CALL_INJECTION_PATTERNS) {
        if (pattern.test(input)) {
            return {
                safe: false,
                threat: "tool_injection",
                pattern: pattern.source,
            };
        }
    }

    // Check role manipulation
    for (const pattern of ROLE_MANIPULATION_PATTERNS) {
        if (pattern.test(input)) {
            return {
                safe: false,
                threat: "role_manipulation",
                pattern: pattern.source,
            };
        }
    }

    return { safe: true };
}

/**
 * Threat-level descriptions for logging/responses.
 */
export function getThreatDescription(threat: string): string {
    switch (threat) {
        case "instruction_override":
            return "Attempted to override agent instructions. This action has been blocked and logged.";
        case "prompt_extraction":
            return "Attempted to extract system prompt. This action has been blocked and logged.";
        case "tool_injection":
            return "Attempted tool/function call injection. This action has been blocked and logged.";
        case "role_manipulation":
            return "Attempted role manipulation. This action has been blocked and logged.";
        default:
            return "Suspicious input detected. This action has been blocked and logged.";
    }
}

/**
 * Config Schema Validation using Zod.
 * Validates agent configuration before saving.
 */
import { z } from "zod";

// ─────────── Schema ───────────

export const AgentConfigSchema = z.object({
    role: z.enum(["trader", "monitor", "collector", "guardian", "custom"]).default("custom"),
    maxSolPerTx: z.number().min(0.001).max(5).default(0.5),
    dailyTxLimit: z.number().int().min(1).max(50).default(10),
    allowedActions: z.array(
        z.enum(["transfer", "recover", "scan_airdrops", "scam_check", "airdrop"])
    ).min(1, "At least one action must be allowed"),
    riskProfile: z.enum(["low", "medium", "high"]).default("low"),
});

export const AgentCreateSchema = z.object({
    id: z.string()
        .min(1, "Agent ID required")
        .max(32, "Agent ID too long (max 32 chars)")
        .regex(/^[a-zA-Z0-9_\- ]+$/, "Agent ID can only contain letters, numbers, spaces, hyphens, and underscores"),
    role: AgentConfigSchema.shape.role.optional(),
    maxSolPerTx: AgentConfigSchema.shape.maxSolPerTx.optional(),
    dailyTxLimit: AgentConfigSchema.shape.dailyTxLimit.optional(),
    allowedActions: AgentConfigSchema.shape.allowedActions.optional(),
});

export const ConfigUpdateSchema = z.object({
    riskProfile: z.enum(["low", "medium", "high"]).optional(),
    dailyTxLimit: z.number().int().min(1).max(50).optional(),
    maxSolPerTx: z.number().min(0.001).max(5).optional(),
    allowedActions: z.array(
        z.enum(["transfer", "recover", "scan_airdrops", "scam_check", "airdrop"])
    ).min(1).optional(),
}).refine(obj => Object.keys(obj).length > 0, {
    message: "At least one field must be provided for update",
});

// ─────────── Validation Helpers ───────────

export interface ValidationResult {
    valid: boolean;
    data?: any;
    errors?: string[];
}

/**
 * Validate agent creation payload.
 */
export function validateAgentCreate(body: unknown): ValidationResult {
    const result = AgentCreateSchema.safeParse(body);
    if (result.success) {
        return { valid: true, data: result.data };
    }
    return {
        valid: false,
        errors: result.error.issues.map((e: any) => `${e.path.join(".")}: ${e.message}`),
    };
}

/**
 * Validate config update payload.
 */
export function validateConfigUpdate(body: unknown): ValidationResult {
    const result = ConfigUpdateSchema.safeParse(body);
    if (result.success) {
        return { valid: true, data: result.data };
    }
    return {
        valid: false,
        errors: result.error.issues.map((e: any) => `${e.path.join(".")}: ${e.message}`),
    };
}

/**
 * Validate a full agent config.
 */
export function validateAgentConfig(config: unknown): ValidationResult {
    const result = AgentConfigSchema.safeParse(config);
    if (result.success) {
        return { valid: true, data: result.data };
    }
    return {
        valid: false,
        errors: result.error.issues.map((e: any) => `${e.path.join(".")}: ${e.message}`),
    };
}

import * as fs from "fs";
import * as path from "path";

// ─────────── Types ───────────

export type AgentRole = "trader" | "monitor" | "recovery" | "custom";
export type RiskProfile = "low" | "medium" | "high";

export interface AgentConfig {
    role: AgentRole;
    maxSolPerTx: number;        // max SOL per single transaction
    dailyTxLimit: number;       // max transactions per day
    allowedActions: string[];   // e.g. ["transfer", "recover", "scan_airdrops", "scam_check"]
    allowedPrograms: string[];  // program IDs the agent may interact with
    riskProfile: RiskProfile;
    createdAt: number;
}

// ─────────── Role Templates ───────────

const ROLE_TEMPLATES: Record<AgentRole, Omit<AgentConfig, "createdAt">> = {
    trader: {
        role: "trader",
        maxSolPerTx: 0.5,
        dailyTxLimit: 10,
        allowedActions: ["transfer", "scan_airdrops", "scam_check", "recover"],
        allowedPrograms: ["*"],
        riskProfile: "medium",
    },
    monitor: {
        role: "monitor",
        maxSolPerTx: 0,
        dailyTxLimit: 0,
        allowedActions: ["scan_airdrops", "scam_check"],
        allowedPrograms: [],
        riskProfile: "low",
    },
    recovery: {
        role: "recovery",
        maxSolPerTx: 0.1,
        dailyTxLimit: 20,
        allowedActions: ["recover", "transfer", "scam_check"],
        allowedPrograms: ["*"],
        riskProfile: "low",
    },
    custom: {
        role: "custom",
        maxSolPerTx: 1.0,
        dailyTxLimit: 5,
        allowedActions: ["transfer", "recover", "scan_airdrops", "scam_check"],
        allowedPrograms: ["*"],
        riskProfile: "medium",
    },
};

// ─────────── SKILLS.md Templates ───────────

const SKILLS_TEMPLATES: Record<AgentRole, string> = {
    trader: `# ROLE
You are a trading agent on Solana devnet.

# OBJECTIVES
- Preserve capital above all
- Monitor token safety before any trade
- Scan for scams proactively

# ALLOWED_ACTIONS
- transfer
- scan_airdrops
- scam_check
- recover

# STRATEGY_RULES
- Never spend more than 30% of available balance in a single trade
- Always run scam check before interacting with unknown tokens
- Log every decision with reasoning
`,

    monitor: `# ROLE
You are a passive monitoring agent on Solana devnet.

# OBJECTIVES
- Watch for new airdrops and token distributions
- Check tokens for scam indicators
- Report findings but NEVER execute transactions

# ALLOWED_ACTIONS
- scan_airdrops
- scam_check

# STRATEGY_RULES
- Never initiate any transaction
- Report all findings to the user
- Flag tokens with freeze or mint authority
`,

    recovery: `# ROLE
You are a rent recovery agent on Solana devnet.

# OBJECTIVES
- Find and close empty or dust token accounts
- Recover SOL from rent-exempt accounts
- Run scam checks before touching any accounts

# ALLOWED_ACTIONS
- recover
- transfer
- scam_check

# STRATEGY_RULES
- Only close accounts with zero or negligible balance
- Never close accounts holding valuable tokens
- Batch closures when possible for efficiency
`,

    custom: `# ROLE
You are a general-purpose agent on Solana devnet.

# OBJECTIVES
- Follow user instructions within configured limits
- Operate safely within your spending bounds
- Check tokens for scams when requested

# ALLOWED_ACTIONS
- transfer
- recover
- scan_airdrops
- scam_check

# STRATEGY_RULES
- Always respect configured limits
- Ask for confirmation on large transactions
- Log all actions with reasoning
`,
};

// ─────────── Data Directory ───────────

const DATA_ROOT = path.resolve(process.cwd(), "data", "agents");

function agentDir(agentId: string): string {
    return path.join(DATA_ROOT, agentId);
}

function configPath(agentId: string): string {
    return path.join(agentDir(agentId), "config.json");
}

function skillsPath(agentId: string): string {
    return path.join(agentDir(agentId), "SKILLS.md");
}

// ─────────── CRUD Operations ───────────

/**
 * Creates config.json and SKILLS.md for a new agent.
 * If partial overrides are provided, they are merged into the role template.
 */
export function createAgentConfig(
    agentId: string,
    role: AgentRole = "custom",
    overrides: Partial<AgentConfig> = {},
): AgentConfig {
    const dir = agentDir(agentId);
    fs.mkdirSync(dir, { recursive: true });

    const template = ROLE_TEMPLATES[role];
    // Filter out undefined overrides so template defaults aren't clobbered
    const cleanOverrides: Partial<AgentConfig> = {};
    for (const [key, value] of Object.entries(overrides)) {
        if (value !== undefined) (cleanOverrides as any)[key] = value;
    }
    const config: AgentConfig = {
        ...template,
        ...cleanOverrides,
        role: cleanOverrides.role || role,
        createdAt: Date.now(),
    };

    fs.writeFileSync(configPath(agentId), JSON.stringify(config, null, 2), "utf-8");

    // Write SKILLS.md from role template
    const skills = SKILLS_TEMPLATES[role];
    fs.writeFileSync(skillsPath(agentId), skills, "utf-8");

    console.log(`[AgentConfig] Created config for "${agentId}" (role: ${config.role})`);
    return config;
}

/**
 * Loads an agent's config from disk. Returns null if not found.
 */
export function loadAgentConfig(agentId: string): AgentConfig | null {
    try {
        const raw = fs.readFileSync(configPath(agentId), "utf-8");
        return JSON.parse(raw) as AgentConfig;
    } catch {
        return null;
    }
}

/**
 * Saves an agent's config to disk.
 */
export function saveAgentConfig(agentId: string, config: AgentConfig): void {
    const dir = agentDir(agentId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(configPath(agentId), JSON.stringify(config, null, 2), "utf-8");
}

/**
 * Reads an agent's SKILLS.md. Returns fallback if not found.
 */
export function loadSkills(agentId: string): string {
    try {
        return fs.readFileSync(skillsPath(agentId), "utf-8");
    } catch {
        return "No SKILLS.md found for this agent.";
    }
}

/**
 * Writes updated SKILLS.md for an agent.
 */
export function saveSkills(agentId: string, content: string): void {
    const dir = agentDir(agentId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(skillsPath(agentId), content, "utf-8");
}

/**
 * Updates specific fields of an agent's config.
 * Only allows mutation of safe fields (not allowedPrograms or maxSolPerTx upper bound).
 */
export function updateAgentConfig(
    agentId: string,
    updates: Partial<Pick<AgentConfig, "role" | "riskProfile" | "dailyTxLimit" | "allowedActions">>,
): AgentConfig {
    const config = loadAgentConfig(agentId);
    if (!config) throw new Error(`Config not found for agent: ${agentId}`);

    // Clamp dailyTxLimit to safe range
    if (updates.dailyTxLimit !== undefined) {
        updates.dailyTxLimit = Math.max(0, Math.min(100, updates.dailyTxLimit));
    }

    // Only allow actions that exist in the system
    const VALID_ACTIONS = ["transfer", "recover", "scan_airdrops", "scam_check"];
    if (updates.allowedActions) {
        updates.allowedActions = updates.allowedActions.filter(a => VALID_ACTIONS.includes(a));
    }

    const updated = { ...config, ...updates };
    saveAgentConfig(agentId, updated);
    console.log(`[AgentConfig] Updated config for "${agentId}":`, updates);
    return updated;
}

/**
 * Deletes agent data directory (config + skills).
 * Returns true if deleted.
 */
export function deleteAgentData(agentId: string): boolean {
    const dir = agentDir(agentId);
    try {
        if (fs.existsSync(dir)) {
            fs.rmSync(dir, { recursive: true, force: true });
            console.log(`[AgentConfig] Deleted data for "${agentId}"`);
            return true;
        }
    } catch { }
    return false;
}

/**
 * Lists all agent IDs that have config files.
 */
export function listConfiguredAgents(): string[] {
    try {
        if (!fs.existsSync(DATA_ROOT)) return [];
        return fs.readdirSync(DATA_ROOT).filter(name => {
            return fs.existsSync(path.join(DATA_ROOT, name, "config.json"));
        });
    } catch {
        return [];
    }
}

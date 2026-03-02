import * as fs from "fs";
import * as path from "path";

// ─────────── Types ───────────

export interface AgentMemory {
    preferences: Record<string, string>;   // e.g. { strategy: "conservative", risk: "low" }
    notes: string[];                       // User-defined notes/instructions
    successfulActions: ActionRecord[];     // Last N successful actions
    lastFailures: ActionRecord[];          // Last N failed actions
    lastUpdated: number;
}

export interface ActionRecord {
    action: string;
    timestamp: number;
    detail?: string;
}

// ─────────── Paths ───────────

const DATA_ROOT = path.resolve(process.cwd(), "data", "agents");

function memoryPath(agentId: string): string {
    return path.join(DATA_ROOT, agentId, "memory.json");
}

// ─────────── Default Memory ───────────

function defaultMemory(): AgentMemory {
    return {
        preferences: {},
        notes: [],
        successfulActions: [],
        lastFailures: [],
        lastUpdated: Date.now(),
    };
}

// ─────────── CRUD ───────────

/**
 * Load agent memory from disk. Creates default if not found.
 */
export function loadMemory(agentId: string): AgentMemory {
    try {
        const raw = fs.readFileSync(memoryPath(agentId), "utf-8");
        return JSON.parse(raw) as AgentMemory;
    } catch {
        return defaultMemory();
    }
}

/**
 * Save agent memory to disk.
 */
export function saveMemory(agentId: string, memory: AgentMemory): void {
    const dir = path.join(DATA_ROOT, agentId);
    fs.mkdirSync(dir, { recursive: true });
    memory.lastUpdated = Date.now();
    fs.writeFileSync(memoryPath(agentId), JSON.stringify(memory, null, 2), "utf-8");
}

/**
 * Set a preference key-value pair.
 */
export function setPreference(agentId: string, key: string, value: string): AgentMemory {
    const mem = loadMemory(agentId);
    mem.preferences[key] = value;
    saveMemory(agentId, mem);
    console.log(`[Memory] ${agentId}: preference "${key}" = "${value}"`);
    return mem;
}

/**
 * Add a note to the agent's memory.
 */
export function addNote(agentId: string, note: string): AgentMemory {
    const mem = loadMemory(agentId);
    mem.notes.push(note);
    // Keep last 20 notes
    if (mem.notes.length > 20) mem.notes = mem.notes.slice(-20);
    saveMemory(agentId, mem);
    console.log(`[Memory] ${agentId}: note added`);
    return mem;
}

/**
 * Record a successful action.
 */
export function recordSuccess(agentId: string, action: string, detail?: string): void {
    const mem = loadMemory(agentId);
    mem.successfulActions.push({ action, timestamp: Date.now(), detail });
    // Keep last 50
    if (mem.successfulActions.length > 50) mem.successfulActions = mem.successfulActions.slice(-50);
    saveMemory(agentId, mem);
}

/**
 * Record a failed action.
 */
export function recordFailure(agentId: string, action: string, detail?: string): void {
    const mem = loadMemory(agentId);
    mem.lastFailures.push({ action, timestamp: Date.now(), detail });
    // Keep last 20
    if (mem.lastFailures.length > 20) mem.lastFailures = mem.lastFailures.slice(-20);
    saveMemory(agentId, mem);
}

/**
 * Build a memory context string for LLM injection.
 */
export function memoryToPrompt(agentId: string): string {
    const mem = loadMemory(agentId);
    const parts: string[] = [];

    // Preferences
    const prefEntries = Object.entries(mem.preferences);
    if (prefEntries.length > 0) {
        parts.push("User preferences:\n" + prefEntries.map(([k, v]) => `- ${k}: ${v}`).join("\n"));
    }

    // Notes
    if (mem.notes.length > 0) {
        parts.push("Notes:\n" + mem.notes.map(n => `- ${n}`).join("\n"));
    }

    // Recent successes (last 5)
    const recentSuccess = mem.successfulActions.slice(-5);
    if (recentSuccess.length > 0) {
        parts.push("Recent successful actions:\n" + recentSuccess.map(s =>
            `- ${s.action}${s.detail ? ` (${s.detail})` : ""}`
        ).join("\n"));
    }

    // Recent failures (last 3)
    const recentFail = mem.lastFailures.slice(-3);
    if (recentFail.length > 0) {
        parts.push("Recent failures:\n" + recentFail.map(f =>
            `- ${f.action}${f.detail ? `: ${f.detail}` : ""}`
        ).join("\n"));
    }

    if (parts.length === 0) return "";
    return "\n\nAGENT MEMORY:\n" + parts.join("\n\n");
}

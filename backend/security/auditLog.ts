/**
 * Action Audit Logger
 * Every action is logged with timestamp, agentId, action, status, txSignature, reason.
 * Logs to data/audit.jsonl (JSON Lines format) and in-memory ring buffer.
 */
import * as fs from "fs";
import * as path from "path";

// ─────────── Types ───────────

export interface AuditEntry {
    timestamp: number;
    iso: string;
    userId?: string;
    agentId: string;
    action: string;
    status: "success" | "failed" | "denied" | "scheduled" | "delayed";
    txSignature?: string;
    reason?: string;
    params?: Record<string, any>;
    ip?: string;
}

// ─────────── Storage ───────────

const AUDIT_FILE = path.resolve(process.cwd(), "data", "audit.jsonl");
const MAX_MEMORY_ENTRIES = 500;
const recentEntries: AuditEntry[] = [];

// Ensure directory exists
const auditDir = path.dirname(AUDIT_FILE);
if (!fs.existsSync(auditDir)) {
    fs.mkdirSync(auditDir, { recursive: true });
}

// ─────────── Functions ───────────

/**
 * Log an action to audit trail.
 */
export function auditLog(entry: Omit<AuditEntry, "timestamp" | "iso">): void {
    const full: AuditEntry = {
        ...entry,
        timestamp: Date.now(),
        iso: new Date().toISOString(),
    };

    // Memory ring buffer
    recentEntries.push(full);
    if (recentEntries.length > MAX_MEMORY_ENTRIES) {
        recentEntries.splice(0, recentEntries.length - MAX_MEMORY_ENTRIES);
    }

    // Append to file (JSONL — one JSON per line)
    try {
        fs.appendFileSync(AUDIT_FILE, JSON.stringify(full) + "\n", "utf-8");
    } catch (err: any) {
        console.error("[Audit] Failed to write audit log:", err.message);
    }

    // Console output for visibility
    const emoji = full.status === "success" ? "✅" : full.status === "denied" ? "⛔" : full.status === "failed" ? "❌" : "⏰";
    console.log(`[Audit] ${emoji} ${full.agentId}/${full.action} → ${full.status}${full.reason ? ` (${full.reason})` : ""}${full.txSignature ? ` tx:${full.txSignature.slice(0, 8)}...` : ""}`);
}

/**
 * Get recent audit entries, optionally filtered by agentId.
 */
export function getAuditLog(agentId?: string, limit: number = 50): AuditEntry[] {
    let entries = recentEntries;
    if (agentId) {
        entries = entries.filter(e => e.agentId === agentId);
    }
    return entries.slice(-limit);
}

/**
 * Get audit entries from disk for a specific agent (slower, full history).
 */
export function getFullAuditLog(agentId?: string, limit: number = 200): AuditEntry[] {
    try {
        if (!fs.existsSync(AUDIT_FILE)) return [];
        const lines = fs.readFileSync(AUDIT_FILE, "utf-8").split("\n").filter(l => l.trim());
        let entries = lines.map(l => {
            try { return JSON.parse(l) as AuditEntry; }
            catch { return null; }
        }).filter(Boolean) as AuditEntry[];

        if (agentId) {
            entries = entries.filter(e => e.agentId === agentId);
        }
        return entries.slice(-limit);
    } catch {
        return [];
    }
}

/**
 * Supabase Store — Drop-in replacements for file-based CRUD.
 * Falls back to JSON files if Supabase is unavailable.
 */
import { getSupabase, isSupabaseReady } from "./supabaseClient.js";

// ─────────── Memory ───────────

export interface AgentMemoryRow {
    agent_id: string;
    preferences: Record<string, string>;
    notes: string[];
    successful_actions: any[];
    last_failures: any[];
    updated_at: string;
}

export async function loadMemoryFromDB(agentId: string): Promise<AgentMemoryRow | null> {
    const sb = getSupabase();
    if (!sb) return null;
    try {
        const { data, error } = await sb
            .from("agent_memory")
            .select("*")
            .eq("agent_id", agentId)
            .single();
        if (error || !data) return null;
        return data as AgentMemoryRow;
    } catch { return null; }
}

export async function saveMemoryToDB(agentId: string, mem: {
    preferences: Record<string, string>;
    notes: string[];
    successfulActions: any[];
    lastFailures: any[];
}): Promise<boolean> {
    const sb = getSupabase();
    if (!sb) return false;
    try {
        const { error } = await sb.from("agent_memory").upsert({
            agent_id: agentId,
            preferences: mem.preferences,
            notes: mem.notes,
            successful_actions: mem.successfulActions,
            last_failures: mem.lastFailures,
            updated_at: new Date().toISOString(),
        }, { onConflict: "agent_id" });
        return !error;
    } catch { return false; }
}

// ─────────── Audit Log ───────────

export interface AuditRow {
    agent_id: string;
    user_id?: string;
    action: string;
    status: string;
    tx_signature?: string;
    reason?: string;
    params?: Record<string, any>;
    ip?: string;
}

export async function insertAuditLog(entry: AuditRow): Promise<boolean> {
    const sb = getSupabase();
    if (!sb) return false;
    try {
        const { error } = await sb.from("audit_log").insert(entry);
        return !error;
    } catch { return false; }
}

export async function getAuditLogFromDB(
    agentId?: string, limit: number = 50
): Promise<any[]> {
    const sb = getSupabase();
    if (!sb) return [];
    try {
        let q = sb.from("audit_log")
            .select("*")
            .order("created_at", { ascending: false })
            .limit(limit);
        if (agentId) q = q.eq("agent_id", agentId);
        const { data, error } = await q;
        if (error || !data) return [];
        return data;
    } catch { return []; }
}

// ─────────── Agents ───────────

export async function upsertAgent(agent: {
    id: string;
    owner_id: string;
    name: string;
    public_key?: string;
    config?: any;
    skills_doc?: string;
}): Promise<boolean> {
    const sb = getSupabase();
    if (!sb) return false;
    try {
        const { error } = await sb.from("agents").upsert(agent, { onConflict: "id" });
        return !error;
    } catch { return false; }
}

export async function getAgentFromDB(agentId: string): Promise<any | null> {
    const sb = getSupabase();
    if (!sb) return null;
    try {
        const { data, error } = await sb
            .from("agents")
            .select("*")
            .eq("id", agentId)
            .single();
        if (error) return null;
        return data;
    } catch { return null; }
}

export async function getAgentsByOwner(ownerId: string): Promise<any[]> {
    const sb = getSupabase();
    if (!sb) return [];
    try {
        const { data, error } = await sb
            .from("agents")
            .select("*")
            .eq("owner_id", ownerId);
        if (error || !data) return [];
        return data;
    } catch { return []; }
}

export async function deleteAgentFromDB(agentId: string): Promise<boolean> {
    const sb = getSupabase();
    if (!sb) return false;
    try {
        const { error } = await sb.from("agents").delete().eq("id", agentId);
        return !error;
    } catch { return false; }
}

// ─────────── Scheduled Jobs ───────────

export async function insertScheduledJob(job: {
    agent_id: string;
    action: string;
    cron_pattern?: string;
    interval_text?: string;
    bullmq_key?: string;
}): Promise<boolean> {
    const sb = getSupabase();
    if (!sb) return false;
    try {
        const { error } = await sb.from("scheduled_jobs").insert({ ...job, status: "active" });
        return !error;
    } catch { return false; }
}

export async function getScheduledJobs(agentId: string): Promise<any[]> {
    const sb = getSupabase();
    if (!sb) return [];
    try {
        const { data, error } = await sb
            .from("scheduled_jobs")
            .select("*")
            .eq("agent_id", agentId)
            .eq("status", "active");
        if (error || !data) return [];
        return data;
    } catch { return []; }
}

export async function deactivateScheduledJob(agentId: string, action: string): Promise<boolean> {
    const sb = getSupabase();
    if (!sb) return false;
    try {
        let q = sb.from("scheduled_jobs")
            .update({ status: "inactive" })
            .eq("agent_id", agentId);
        if (action !== "all") q = q.eq("action", action);
        const { error } = await q;
        return !error;
    } catch { return false; }
}

// ─────────── History (combined audit + memory) ───────────

export async function getAgentHistory(agentId: string, limit: number = 20): Promise<any[]> {
    const sb = getSupabase();
    if (!sb) return [];
    try {
        const { data, error } = await sb
            .from("audit_log")
            .select("action, status, tx_signature, reason, created_at")
            .eq("agent_id", agentId)
            .order("created_at", { ascending: false })
            .limit(limit);
        if (error || !data) return [];
        return data.map((e: any) => ({
            type: e.status === "success" ? "success" : e.status === "denied" ? "denied" : "failure",
            action: e.action,
            detail: e.tx_signature ? `Tx: ${e.tx_signature.slice(0, 12)}...` : e.reason || "completed",
            timestamp: new Date(e.created_at).getTime(),
        }));
    } catch { return []; }
}

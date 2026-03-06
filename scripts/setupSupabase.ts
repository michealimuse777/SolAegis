/**
 * Create Supabase tables using the Management API (pg-meta).
 * This uses the /pg/query endpoint available in Supabase.
 */
import dotenv from "dotenv";
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;

// Supabase project ref from URL
const ref = SUPABASE_URL.replace("https://", "").replace(".supabase.co", "");

const SQL_STATEMENTS = [
    // Agents table
    `CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        name TEXT NOT NULL,
        public_key TEXT,
        config JSONB DEFAULT '{}'::jsonb,
        skills_doc TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT now()
    )`,
    // Agent memory
    `CREATE TABLE IF NOT EXISTS agent_memory (
        agent_id TEXT PRIMARY KEY,
        preferences JSONB DEFAULT '{}'::jsonb,
        notes JSONB DEFAULT '[]'::jsonb,
        successful_actions JSONB DEFAULT '[]'::jsonb,
        last_failures JSONB DEFAULT '[]'::jsonb,
        updated_at TIMESTAMPTZ DEFAULT now()
    )`,
    // Audit log
    `CREATE TABLE IF NOT EXISTS audit_log (
        id BIGSERIAL PRIMARY KEY,
        agent_id TEXT NOT NULL,
        user_id TEXT,
        action TEXT NOT NULL,
        status TEXT NOT NULL,
        tx_signature TEXT,
        reason TEXT,
        params JSONB,
        ip TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
    )`,
    // Scheduled jobs
    `CREATE TABLE IF NOT EXISTS scheduled_jobs (
        id BIGSERIAL PRIMARY KEY,
        agent_id TEXT NOT NULL,
        action TEXT NOT NULL,
        cron_pattern TEXT,
        interval_text TEXT,
        status TEXT DEFAULT 'active',
        bullmq_key TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
    )`,
    // Indexes
    `CREATE INDEX IF NOT EXISTS idx_audit_agent ON audit_log(agent_id)`,
    `CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_jobs_agent ON scheduled_jobs(agent_id)`,
    `CREATE INDEX IF NOT EXISTS idx_agents_owner ON agents(owner_id)`,
    // RLS
    `ALTER TABLE agents ENABLE ROW LEVEL SECURITY`,
    `ALTER TABLE agent_memory ENABLE ROW LEVEL SECURITY`,
    `ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY`,
    `ALTER TABLE scheduled_jobs ENABLE ROW LEVEL SECURITY`,
];

async function runSQL(sql: string): Promise<boolean> {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/`, {
            method: "POST",
            headers: {
                "apikey": SERVICE_KEY,
                "Authorization": `Bearer ${SERVICE_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ query: sql }),
        });
        return res.ok;
    } catch {
        return false;
    }
}

async function main() {
    console.log("🔧 Setting up Supabase tables...");
    console.log("   URL:", SUPABASE_URL);
    console.log("   Ref:", ref);

    // Try using the supabase-js client directly to create via raw queries
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
        db: { schema: "public" },
    });

    // Execute each SQL statement via RPC if available, otherwise try direct
    for (const sql of SQL_STATEMENTS) {
        const label = sql.slice(0, 60).replace(/\n/g, " ").trim();
        try {
            // Try using the rpc endpoint
            const { error } = await supabase.rpc("exec_sql", { query: sql });
            if (error) {
                // RPC doesn't exist — expected on fresh projects
                console.log(`   ⚡ ${label}... (RPC unavailable, will need manual SQL)`);
            } else {
                console.log(`   ✅ ${label}...`);
            }
        } catch (e: any) {
            console.log(`   ⚠️ ${label}... ${e.message}`);
        }
    }

    // Verify tables exist
    console.log("\n📋 Verifying tables...");
    for (const table of ["agents", "agent_memory", "audit_log", "scheduled_jobs"]) {
        const { error } = await supabase.from(table).select("*").limit(0);
        if (error) {
            console.log(`   ❌ ${table}: ${error.message}`);
        } else {
            console.log(`   ✅ ${table}: exists`);
        }
    }
}

main().catch(console.error);

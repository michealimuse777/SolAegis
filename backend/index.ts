import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import { WebSocketServer, WebSocket } from "ws";
import { Connection, PublicKey } from "@solana/web3.js";
import { AgentManager } from "./core/agentManager.js";
import { KeyStore } from "./llm/keyStore.js";
import { LLMManager } from "./llm/llmManager.js";
import { LLMInterface } from "./core/dermercist/llmInterface.js";
import { DerMercist } from "./core/dermercist/index.js";
import { ExecutionLock } from "./services/executionLock.js";
import { checkTokenSafety } from "./skills/scamFilter.js";
import { getRecoverySummary } from "./skills/solRecovery.js";
import {
    initScheduler,
    scheduleCronJob,
    createWorker,
    listScheduledJobs,
    shutdownScheduler,
} from "./scheduler/cronEngine.js";

// ─────────── CONFIG ───────────
const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const PORT = parseInt(process.env.PORT || "4000", 10);
const WS_PORT = parseInt(process.env.WS_PORT || "4001", 10);
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

// ─────────── INIT ───────────
const connection = new Connection(RPC_URL, "confirmed");
const agentManager = new AgentManager(connection);

// LLM setup
const keyStore = new KeyStore();
keyStore.loadFromEnv();
const llmManager = new LLMManager(
    keyStore,
    process.env.LLM_PRIMARY_PROVIDER || "gemini",
    process.env.LLM_PRIMARY_MODEL || "gemini-pro"
);
const llmInterface = new LLMInterface(llmManager);
const derMercist = new DerMercist(
    agentManager.getDeFiSkill(),
    llmInterface,
    connection
);

// ─────────── EXPRESS ───────────
const app = express();
app.use(cors());
app.use(express.json());

// WebSocket clients for live updates
const wsClients = new Set<WebSocket>();

function broadcast(event: string, data: any) {
    const message = JSON.stringify({ event, data, timestamp: Date.now() });
    for (const client of wsClients) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    }
}

// ─── Health ───
app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", rpc: RPC_URL, agents: agentManager.list().length });
});

// ─── Agents ───
app.get("/api/agents", async (_req, res) => {
    try {
        const states = await agentManager.listStates();
        res.json(states);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.post("/api/agents", (req, res) => {
    try {
        const { id } = req.body;
        if (!id) return res.status(400).json({ error: "Agent ID required" });
        const agent = agentManager.create(id);
        broadcast("agent:created", { id, publicKey: agent.getPublicKey() });
        res.json({ id, publicKey: agent.getPublicKey() });
    } catch (err: any) {
        res.status(400).json({ error: err.message });
    }
});

app.delete("/api/agents/:id", (req, res) => {
    const removed = agentManager.remove(req.params.id);
    if (removed) {
        broadcast("agent:removed", { id: req.params.id });
        res.json({ removed: true });
    } else {
        res.status(404).json({ error: "Agent not found" });
    }
});

// ─── Devnet Airdrop ───
app.post("/api/agents/:id/airdrop", async (req, res) => {
    try {
        const agent = agentManager.get(req.params.id);
        if (!agent) return res.status(404).json({ error: "Agent not found" });
        const amount = req.body.amount || 1; // default 1 SOL
        const lamports = Math.min(amount, 2) * 1e9; // max 2 SOL per airdrop
        const pubkey = new PublicKey(agent.getPublicKey());
        const sig = await connection.requestAirdrop(pubkey, lamports);
        await connection.confirmTransaction(sig, "confirmed");
        const balance = await connection.getBalance(pubkey) / 1e9;
        broadcast("agent:funded", { id: req.params.id, amount, balance });
        res.json({ success: true, signature: sig, newBalance: balance });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ─── SOL Transfer (plain SOL, no SPL mint needed) ───
app.post("/api/agents/:id/transfer-sol", async (req, res) => {
    try {
        const agent = agentManager.get(req.params.id);
        if (!agent) return res.status(404).json({ error: "Agent not found" });
        const { to, amount } = req.body;
        if (!to || !amount) return res.status(400).json({ error: "to (address) and amount (SOL) required" });

        const { SystemProgram, Transaction, LAMPORTS_PER_SOL } = await import("@solana/web3.js");
        const keypair = agent.getKeypair();
        const lamports = Math.floor(parseFloat(amount) * LAMPORTS_PER_SOL);

        const tx = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: keypair.publicKey,
                toPubkey: new PublicKey(to),
                lamports,
            })
        );
        tx.feePayer = keypair.publicKey;
        const { blockhash } = await connection.getLatestBlockhash();
        tx.recentBlockhash = blockhash;
        tx.sign(keypair);
        const sig = await connection.sendRawTransaction(tx.serialize());
        await connection.confirmTransaction(sig, "confirmed");
        const newBalance = await connection.getBalance(keypair.publicKey) / 1e9;
        broadcast("task:executed", { agentId: req.params.id, result: { success: true, action: "transfer-sol", signature: sig } });
        res.json({ success: true, signature: sig, newBalance });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─── Auto Recover (scan + batch close empty accounts) ───
app.post("/api/agents/:id/auto-recover", async (req, res) => {
    try {
        const agent = agentManager.get(req.params.id);
        if (!agent) return res.status(404).json({ error: "Agent not found" });

        const keypair = agent.getKeypair();
        const { findAllRecoverable, batchRecover } = await import("./skills/solRecovery.js");
        const recoverable = await findAllRecoverable(connection, keypair.publicKey);
        const empty = recoverable.filter(a => a.type === "empty");

        if (empty.length === 0) {
            return res.json({ success: true, message: "No empty accounts to recover", recovered: 0, solRecovered: 0 });
        }

        const { tx, count, estimatedSOL } = await batchRecover(connection, keypair, empty.map(e => e.address));
        tx.feePayer = keypair.publicKey;
        const { blockhash } = await connection.getLatestBlockhash();
        tx.recentBlockhash = blockhash;
        tx.sign(keypair);
        const sig = await connection.sendRawTransaction(tx.serialize());
        await connection.confirmTransaction(sig, "confirmed");
        broadcast("task:executed", { agentId: req.params.id, result: { success: true, action: "auto-recover", signature: sig } });
        res.json({ success: true, signature: sig, recovered: count, solRecovered: estimatedSOL });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─── Tasks ───
app.post("/api/agents/:id/execute", async (req, res) => {
    try {
        const agent = agentManager.get(req.params.id);
        if (!agent) return res.status(404).json({ error: "Agent not found" });

        const { action, params } = req.body;
        const result = await agent.execute({ action, params });
        broadcast("task:executed", { agentId: req.params.id, result });
        res.json(result);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ─── DerMercist ───
app.post("/api/dermercist/run", async (_req, res) => {
    try {
        const agents = agentManager.list();
        const results = await derMercist.runAll(agents);
        broadcast("dermercist:cycle", { results });
        res.json(results);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.post("/api/dermercist/run/:id", async (req, res) => {
    try {
        const agent = agentManager.get(req.params.id);
        if (!agent) return res.status(404).json({ error: "Agent not found" });

        const result = await derMercist.run(agent);
        broadcast("dermercist:result", { result });
        res.json(result);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Skills ───
app.get("/api/skills", (_req, res) => {
    const doc = agentManager.getDeFiSkill().getSkillsDocumentation();
    res.json({ skills: doc });
});

// ─── Scheduler ───
app.get("/api/scheduler/jobs", async (_req, res) => {
    const jobs = await listScheduledJobs();
    res.json(jobs);
});

app.post("/api/scheduler/schedule", async (req, res) => {
    try {
        const { agentId, action, params, cron } = req.body;
        const jobId = await scheduleCronJob(
            `${action}-${agentId}`,
            { agentId, action, params },
            cron
        );
        res.json({ jobId });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ─── LLM Stats ───
app.get("/api/llm/stats", (_req, res) => {
    res.json(llmManager.getUsageStats());
});

// ─── Portfolio & Analytics ───
app.get("/api/agents/:id/portfolio", async (req, res) => {
    try {
        const agent = agentManager.get(req.params.id);
        if (!agent) return res.status(404).json({ error: "Agent not found" });
        const keypair = agent.getKeypair();
        const portfolio = await derMercist.getPositionTracker().snapshot(req.params.id, keypair.publicKey);
        res.json(portfolio);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.get("/api/agents/:id/analytics", (req, res) => {
    try {
        const analytics = derMercist.getAnalytics(req.params.id);
        res.json(analytics);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.get("/api/agents/:id/decisions", (req, res) => {
    try {
        const count = parseInt(req.query.count as string) || 20;
        const decisions = derMercist.getDecisionHistory(req.params.id, count);
        res.json(decisions);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Scam Check ───
app.post("/api/tokens/check", async (req, res) => {
    try {
        const { mint } = req.body;
        if (!mint) return res.status(400).json({ error: "mint address required" });
        const result = await checkTokenSafety(connection, new PublicKey(mint));
        // Convert bigint to string for JSON
        const serializable = {
            ...result,
            details: {
                ...result.details,
                supply: result.details.supply.toString(),
            },
        };
        res.json(serializable);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Recovery Summary ───
app.get("/api/agents/:id/recovery", async (req, res) => {
    try {
        const agent = agentManager.get(req.params.id);
        if (!agent) return res.status(404).json({ error: "Agent not found" });
        const keypair = agent.getKeypair();
        const summary = await getRecoverySummary(connection, keypair.publicKey);
        res.json(summary);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Execution Locks ───
app.get("/api/locks", (_req, res) => {
    res.json({
        activeLocks: ExecutionLock.getActiveLocks(),
    });
});

// ─── Allocation Rules ───
app.get("/api/allocation/rules", (_req, res) => {
    res.json(derMercist.getAllocationRules());
});

// ─── Cron Jobs ───
app.post("/api/cron/schedule", async (req, res) => {
    try {
        const { name, pattern, agentId, action } = req.body;
        if (!name || !pattern || !agentId || !action) {
            return res.status(400).json({ error: "name, pattern, agentId, action required" });
        }
        const data = { agentId, action, params: {} };
        await scheduleCronJob(name, data, pattern);
        // Create a worker to process scheduled jobs
        createWorker(async (jobData) => {
            const agent = agentManager.get(jobData.agentId);
            if (!agent) return;
            const result = await agent.execute({ action: jobData.action as any, params: jobData.params || {} });
            broadcast("cron:executed", { name, agentId: jobData.agentId, result });
            console.log(`[Cron] Executed ${name}: ${jobData.action} for ${jobData.agentId}`);
        });
        res.json({ success: true, name, pattern, agentId, action });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.get("/api/cron/jobs", async (_req, res) => {
    try {
        const jobs = await listScheduledJobs();
        res.json(jobs);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ─────────── START ───────────
async function start() {
    console.log("\n╔══════════════════════════════════════╗");
    console.log("║       🛡️  SolAegis Backend  🛡️         ║");
    console.log("╚══════════════════════════════════════╝\n");

    // Init scheduler (graceful degradation)
    const redisReady = await initScheduler(REDIS_URL);
    if (redisReady) {
        createWorker(async (data) => {
            const agent = agentManager.get(data.agentId);
            if (agent) {
                const result = await derMercist.run(agent);
                broadcast("cron:executed", { result });
            }
        });
    }

    // Start Express
    app.listen(PORT, () => {
        console.log(`[Server] REST API → http://localhost:${PORT}`);
    });

    // Start WebSocket
    const wss = new WebSocketServer({ port: WS_PORT });
    wss.on("connection", (ws) => {
        wsClients.add(ws);
        console.log("[WS] Client connected");
        ws.on("close", () => wsClients.delete(ws));
    });
    console.log(`[Server] WebSocket → ws://localhost:${WS_PORT}`);
    console.log(`[Server] RPC       → ${RPC_URL}`);
    console.log(`[Server] LLM Keys  → ${keyStore.totalKeys()} loaded\n`);

    // Graceful shutdown
    process.on("SIGINT", async () => {
        console.log("\nShutting down...");
        await shutdownScheduler();
        process.exit(0);
    });
}

start().catch(console.error);

export { app, agentManager, derMercist };

import dotenv from "dotenv";
dotenv.config();

import * as fs from "fs";
import * as path from "path";

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
    scheduleDelayedJob,
    createWorker,
    listScheduledJobs,
    removeScheduledJob,
    shutdownScheduler,
} from "./scheduler/cronEngine.js";
import { DecisionMemory } from "./services/decisionMemory.js";
import { PositionTracker } from "./services/positionTracker.js";
import { ChatHandler, intervalToCron, delayToMs } from "./core/chatHandler.js";
import { loadMemory, saveMemory, defaultMemory } from "./core/memory.js";
import { getMarketData } from "./services/marketData.js";
import { PolicyEngine } from "./services/policyEngine.js";
import { loadAgentConfig, updateAgentConfig, AgentRole } from "./core/agentConfig.js";
import { recordSuccess, recordFailure } from "./core/memory.js";
import { authMiddleware, registerUser, loginUser, requestWalletNonce, verifyWalletSignature, assignAgentToUser, getUserAgents, removeAgentFromAllUsers, agentOwnershipMiddleware, AuthenticatedRequest } from "./security/auth.js";
import { chatRateLimiter, txRateLimiter } from "./security/rateLimiter.js";
import { validateAgentCreate } from "./security/configValidator.js";
import { auditLog, getAuditLog } from "./security/auditLog.js";
import { securityHeaders, inputSanitizer, payloadSizeGuard } from "./security/securityMiddleware.js";
import { checkPromptInjection, getThreatDescription } from "./security/promptInjectionGuard.js";
import { schedulerGuardrailMiddleware, registerUserJob } from "./security/schedulerGuardrails.js";
import { validateTransferInputs } from "./security/txSimulation.js";

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
    process.env.LLM_PRIMARY_MODEL || "gemini-2.0-flash"
);
const llmInterface = new LLMInterface(llmManager);
const derMercist = new DerMercist(
    agentManager.getDeFiSkill(),
    llmInterface,
    connection
);
const chatHandler = new ChatHandler(llmManager, connection);
const policyEngine = new PolicyEngine();

// ─────────── EXPRESS ───────────
const app = express();
app.disable("x-powered-by");            // Hide server fingerprint
app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, server-to-server, etc.)
        if (!origin) return callback(null, true);
        const allowed = process.env.FRONTEND_URL;
        // Allow configured frontend URL, any vercel.app preview, and localhost for dev
        if (!allowed
            || origin === allowed
            || origin.endsWith(".vercel.app")
            || origin.includes("localhost")
        ) {
            return callback(null, true);
        }
        callback(new Error("CORS not allowed"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use(express.json({ limit: "10kb" })); // Match payload guard

// Security middleware
app.use(securityHeaders);            // XSS, clickjacking, CSP, HSTS headers
app.use(inputSanitizer);             // Strip HTML/XSS from all request bodies
app.use(payloadSizeGuard(10_000));   // 10KB max request body
app.use(authMiddleware as any);      // JWT auth (strict)
app.use("/api/agents/:id", agentOwnershipMiddleware as any);  // User A cannot control User B's agents

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

// ─── Auth Routes ───
app.post("/api/auth/register", (req, res) => {
    try {
        const { userId, password } = req.body;
        if (!userId || !password) return res.status(400).json({ error: "userId and password required" });
        const result = registerUser(userId, password);
        res.json(result);
    } catch (err: any) {
        res.status(400).json({ error: err.message });
    }
});

app.post("/api/auth/login", (req, res) => {
    try {
        const { userId, password } = req.body;
        if (!userId || !password) return res.status(400).json({ error: "userId and password required" });
        const result = loginUser(userId, password);
        res.json(result);
    } catch (err: any) {
        res.status(401).json({ error: err.message });
    }
});

// ─── Wallet Signature Auth ───
app.post("/api/auth/wallet/nonce", (req, res) => {
    try {
        const { walletAddress } = req.body;
        if (!walletAddress) return res.status(400).json({ error: "walletAddress required" });
        const result = requestWalletNonce(walletAddress);
        res.json(result);
    } catch (err: any) {
        res.status(400).json({ error: err.message });
    }
});

app.post("/api/auth/wallet/verify", (req, res) => {
    try {
        const { walletAddress, signature, message } = req.body;
        if (!walletAddress || !signature || !message) {
            return res.status(400).json({ error: "walletAddress, signature, and message required" });
        }
        const result = verifyWalletSignature(walletAddress, signature, message);
        res.json(result);
    } catch (err: any) {
        res.status(401).json({ error: err.message });
    }
});

// ─── Agents (filtered by ownership) ───
app.get("/api/agents", async (req: AuthenticatedRequest, res) => {
    try {
        const states = await agentManager.listStates();
        if (req.userId) {
            const ownedIds = getUserAgents(req.userId);
            const filtered = (Array.isArray(states) ? states : []).filter(
                (a: any) => ownedIds.includes(a.id)
            );
            return res.json(filtered);
        }
        res.json(states);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.post("/api/agents", (req: AuthenticatedRequest, res) => {
    try {
        // Validate with Zod
        const validation = validateAgentCreate(req.body);
        if (!validation.valid) {
            return res.status(400).json({ error: "Invalid config", details: validation.errors });
        }
        const { id, role, maxSolPerTx, dailyTxLimit, allowedActions } = validation.data;
        const agent = agentManager.create(
            id,
            (role as AgentRole) || "custom",
            { maxSolPerTx, dailyTxLimit, allowedActions },
        );
        const config = agent.getConfig();

        // Associate agent with user
        if (req.userId) {
            assignAgentToUser(req.userId, id);
        }

        auditLog({ userId: req.userId, agentId: id, action: "create_agent", status: "success" });
        broadcast("agent:created", { id, publicKey: agent.getPublicKey(), config });
        res.json({ id, publicKey: agent.getPublicKey(), config });
    } catch (err: any) {
        res.status(400).json({ error: err.message });
    }
});

// ─── Agent Chat (rate limited) ───
app.post("/api/agents/:id/chat", chatRateLimiter as any, async (req: AuthenticatedRequest, res) => {
    try {
        const agent = agentManager.get(req.params.id);
        if (!agent) return res.status(404).json({ error: "Agent not found" });

        const { message } = req.body;
        if (!message) return res.status(400).json({ error: "Message required" });

        // ─── Prompt Injection Guard ───
        const injectionCheck = checkPromptInjection(message);
        if (!injectionCheck.safe) {
            auditLog({
                userId: req.userId,
                agentId: req.params.id,
                action: "prompt_injection",
                status: "denied",
                reason: `${injectionCheck.threat}: ${injectionCheck.pattern}`,
            });
            return res.json({
                reply: getThreatDescription(injectionCheck.threat!),
                intent: { type: "blocked" },
                blocked: true,
                threat: injectionCheck.threat,
            });
        }

        const response = await chatHandler.handleMessage(req.params.id, message);

        // Execute all approved intents sequentially
        const allIntents = response.intents || (response.intent ? [response.intent] : []);
        const executedReplies: string[] = [];

        for (const intent of allIntents) {
            if (
                intent.type === "execute_action" &&
                intent.action
            ) {
                const action = intent.action;
                const params = intent.params || {};

                // Policy check for this specific intent
                const check = await policyEngine.check(req.params.id, action, params);
                if (!check.allowed) {
                    executedReplies.push(`⛔ ${action} denied: ${check.reason}`);
                    auditLog({
                        userId: (req as AuthenticatedRequest).userId,
                        agentId: req.params.id,
                        action,
                        status: "denied",
                        reason: check.reason,
                    });
                    continue;
                }

                try {
                    // Handle airdrop
                    if (action === "airdrop") {
                        const sig = await connection.requestAirdrop(
                            agent.getKeypair().publicKey,
                            1e9,
                        );
                        await connection.confirmTransaction(sig, "confirmed");
                        const balance = await connection.getBalance(agent.getKeypair().publicKey) / 1e9;
                        executedReplies.push(`✅ Airdropped 1 SOL. New balance: ${balance.toFixed(4)} SOL`);
                        response.executionResult = { success: true, action: "airdrop", signature: sig };
                    }
                    // Handle transfer-sol
                    else if (action === "transfer" && params.to && params.amount) {
                        const keypair = agent.getKeypair();
                        const { Transaction, SystemProgram, LAMPORTS_PER_SOL } = await import("@solana/web3.js");
                        const lamports = Math.round(parseFloat(params.amount) * LAMPORTS_PER_SOL);
                        const tx = new Transaction().add(
                            SystemProgram.transfer({
                                fromPubkey: keypair.publicKey,
                                toPubkey: new PublicKey(params.to),
                                lamports,
                            }),
                        );
                        const sig = await connection.sendTransaction(tx, [keypair]);
                        await connection.confirmTransaction(sig, "confirmed");
                        executedReplies.push(`✅ Transferred ${params.amount} SOL to \`${params.to}\`. Tx: ${sig}`);
                        response.executionResult = { success: true, action: "transfer", signature: sig };
                    }
                    // Handle recover — AUTO-SCAN (no tokenAccount needed)
                    else if (action === "recover") {
                        const keypair = agent.getKeypair();
                        const { findAllRecoverable } = await import("./skills/solRecovery.js");
                        const { createCloseAccountInstruction } = await import("@solana/spl-token");
                        const { Transaction: Tx, LAMPORTS_PER_SOL: LSOL } = await import("@solana/web3.js");
                        const recoverable = await findAllRecoverable(connection, keypair.publicKey);

                        if (recoverable.length === 0) {
                            executedReplies.push("ℹ️ No empty token accounts found. Nothing to recover.");
                        } else {
                            const batch = recoverable.slice(0, 10);
                            const tx = new Tx();
                            for (const acc of batch) {
                                tx.add(createCloseAccountInstruction(
                                    acc.address,
                                    keypair.publicKey,
                                    keypair.publicKey,
                                ));
                            }
                            const sig = await connection.sendTransaction(tx, [keypair]);
                            await connection.confirmTransaction(sig, "confirmed");
                            const estimatedSOL = batch.reduce((s: number, a: any) => s + a.rentLamports / 1e9, 0);
                            executedReplies.push(`✅ Recovered ${batch.length} empty account(s), reclaiming ~${estimatedSOL.toFixed(4)} SOL. Tx: ${sig}`);
                            response.executionResult = { success: true, action: "recover", signature: sig, recovered: batch.length };
                        }
                    }
                    // Handle scan_airdrops
                    else if (action === "scan_airdrops") {
                        const result = await agent.execute({ action: "scan_airdrops" as any, params: {} });
                        if (result.success) {
                            const airdrops = result.data || [];
                            if (airdrops.length === 0) {
                                executedReplies.push("📊 Scan complete. No airdrop-eligible tokens found in your wallet.");
                            } else {
                                const summary = airdrops.map((a: any) => `• ${a.mint || a.name || "token"}: ${a.amount || a.balance || "?"}`).join("\n");
                                executedReplies.push(`📊 Scan complete. Found **${airdrops.length}** token(s):\n${summary}`);
                            }
                        } else {
                            executedReplies.push(`❌ Scan failed: ${result.error}`);
                        }
                        response.executionResult = result;
                    }
                    // Handle scam_check — token safety analysis
                    else if (action === "scam_check") {
                        const { checkTokenSafety } = await import("./skills/scamFilter.js");
                        const { TOKEN_PROGRAM_ID } = await import("@solana/spl-token");
                        const keypair = agent.getKeypair();

                        if (params.mint) {
                            // Check specific mint
                            const result = await checkTokenSafety(connection, new PublicKey(params.mint));
                            const status = result.safe ? "✅ SAFE" : "⚠️ RISKY";
                            executedReplies.push(`🔍 **Scam Check**: ${params.mint}\n\n${status} — Risk Score: **${result.riskScore}/100**\n\nFlags:\n${result.reasons.map((r: string) => `• ${r}`).join("\n")}\n\nDetails: freeze=${result.details.hasFreezeAuthority}, mint=${result.details.hasMintAuthority}, metadata=${result.details.hasMetadata}`);
                            response.executionResult = { success: true, action: "scam_check", result };
                        } else {
                            // Auto-scan all token accounts
                            const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
                                keypair.publicKey,
                                { programId: TOKEN_PROGRAM_ID },
                            );

                            if (tokenAccounts.value.length === 0) {
                                executedReplies.push("🔍 No token accounts found in wallet. Nothing to scan for scams.");
                            } else {
                                const results: string[] = [];
                                for (const ta of tokenAccounts.value.slice(0, 5)) {
                                    const mint = ta.account.data.parsed?.info?.mint;
                                    if (!mint) continue;
                                    try {
                                        const check = await checkTokenSafety(connection, new PublicKey(mint));
                                        const icon = check.safe ? "✅" : "⚠️";
                                        results.push(`${icon} **${mint.slice(0, 8)}...** — Risk: ${check.riskScore}/100 ${check.reasons.length > 0 ? `(${check.reasons[0]})` : ""}`);
                                    } catch {
                                        results.push(`❓ **${mint.slice(0, 8)}...** — Could not analyze`);
                                    }
                                }
                                executedReplies.push(`🔍 **Scam Scan** — ${tokenAccounts.value.length} token(s) found:\n\n${results.join("\n")}`);
                                response.executionResult = { success: true, action: "scam_check", scanned: results.length };
                            }
                        }
                    }
                    // Handle swap via Orca Whirlpools
                    else if (action === "swap") {
                        const { swapTokens } = await import("./skills/swap.js");
                        const keypair = agent.getKeypair();
                        const inputMint = params.inputMint || params.from || params.tokenIn || "SOL";
                        const outputMint = params.outputMint || params.to || params.tokenOut || "devUSDC";
                        const amount = parseFloat(params.amount || "0.01");
                        const slippageBps = parseInt(params.slippage || "100");

                        if (!amount || amount <= 0) {
                            executedReplies.push("⚠️ Please specify an amount to swap. Example: \"swap 0.1 SOL to devUSDC\"");
                        } else {
                            const result = await swapTokens({
                                connection,
                                payer: keypair,
                                inputMint,
                                outputMint,
                                amount,
                                slippageBps,
                            });
                            executedReplies.push(
                                `✅ **Swap Executed**\n\n` +
                                `• Input: ${amount} ${inputMint}\n` +
                                `• Output: ~${result.estimatedOutput} ${outputMint}\n` +
                                `• Route: ${result.route}\n` +
                                `• Pool: \`${result.pool}\`\n` +
                                `• Tx: \`${result.signature}\``
                            );
                            response.executionResult = { success: true, action: "swap", ...result };
                        }
                    }
                    // Unknown action
                    else {
                        executedReplies.push(`⚠️ Action "${action}" recognized but execution not implemented yet.`);
                    }

                    broadcast("chat:action", { agentId: req.params.id, action, result: response.executionResult });
                    recordSuccess(req.params.id, action, executedReplies[executedReplies.length - 1]?.slice(0, 80));
                    auditLog({
                        userId: (req as AuthenticatedRequest).userId,
                        agentId: req.params.id,
                        action,
                        status: "success",
                        txSignature: response.executionResult?.signature,
                    });
                } catch (err: any) {
                    executedReplies.push(`❌ ${action} failed: ${err.message}`);
                    recordFailure(req.params.id, action, err.message);
                    auditLog({
                        userId: (req as AuthenticatedRequest).userId,
                        agentId: req.params.id,
                        action,
                        status: "failed",
                        reason: err.message,
                    });
                }
            }

            // Handle schedule intent — convert interval to cron DIRECTLY here
            if (intent.type === "schedule" && intent.action && intent.interval) {
                const cron = intervalToCron(intent.interval);
                if (!cron) {
                    executedReplies.push(`⚠️ I don't support the interval "${intent.interval}". Try: 5m, 10m, 30m, 1h, 2h, 6h, 12h, 24h, daily, or hourly.`);
                } else {
                    try {
                        const jobName = `${req.params.id}-${intent.action}`;
                        const jobId = await scheduleCronJob(jobName, {
                            agentId: req.params.id,
                            action: intent.action,
                            params: intent.params || {},
                        }, cron);

                        if (jobId) {
                            executedReplies.push(`⏰ Done! I'll run "${intent.action}" every ${intent.interval} automatically. You can say "stop ${intent.action}" anytime to cancel.`);
                            broadcast("cron:scheduled", { agentId: req.params.id, action: intent.action, interval: intent.interval, cron, jobId });

                            // Persist to Supabase
                            import("./services/supabaseStore.js").then(({ insertScheduledJob }) => {
                                insertScheduledJob({
                                    agent_id: req.params.id,
                                    action: intent.action!,
                                    cron_pattern: cron,
                                    interval_text: intent.interval,
                                    bullmq_key: jobName,
                                }).catch(() => { });
                            }).catch(() => { });
                        } else {
                            executedReplies.push("⚠️ Scheduler unavailable — Redis isn't connected. The job wasn't created.");
                        }
                    } catch (err: any) {
                        executedReplies.push(`❌ Failed to schedule: ${err.message}`);
                    }
                }
            }

            // Handle unschedule intent
            if (intent.type === "unschedule" && intent.action) {
                try {
                    const jobs = await listScheduledJobs();
                    const targetAction = intent.action;
                    let removed = 0;

                    for (const job of jobs) {
                        const matchesAgent = job.name?.startsWith(req.params.id) || job.key?.includes(req.params.id);
                        const matchesAction = targetAction === "all" || job.name?.includes(targetAction) || job.key?.includes(targetAction);

                        if (matchesAgent && matchesAction) {
                            await removeScheduledJob(job.name, job.pattern || job.cron);
                            removed++;
                        }
                    }

                    if (removed > 0) {
                        executedReplies.push(`✅ Removed ${removed} scheduled job(s) for "${targetAction}".`);
                        broadcast("cron:unscheduled", { agentId: req.params.id, action: targetAction, removed });
                    } else {
                        executedReplies.push(`ℹ️ No scheduled jobs found for "${targetAction}".`);
                    }
                } catch (err: any) {
                    executedReplies.push(`❌ Failed to unschedule: ${err.message}`);
                }
            }

            // Handle delay intent — convert delay to ms DIRECTLY here
            if (intent.type === "delay" && intent.action && intent.delay) {
                const ms = delayToMs(intent.delay);
                if (!ms) {
                    executedReplies.push(`⚠️ I don't support the delay "${intent.delay}". Try: 1m, 5m, 10m, 30m, 1h, 2h, 3h, 6h, 12h, or 24h.`);
                } else {
                    try {
                        const jobName = `${req.params.id}-delayed-${intent.action}-${Date.now()}`;
                        const jobId = await scheduleDelayedJob(jobName, {
                            agentId: req.params.id,
                            action: intent.action,
                            params: intent.params || {},
                        }, ms);

                        if (jobId) {
                            const humanDelay = ms >= 3_600_000 ? `${ms / 3_600_000} hour(s)` : `${ms / 60_000} minute(s)`;
                            const paramDesc = intent.params?.to
                                ? ` — sending ${intent.params.amount || ""} SOL to ${intent.params.to}`
                                : "";
                            executedReplies.push(`⏳ Got it! I'll execute "${intent.action}" in ${humanDelay}${paramDesc}. Job queued.`);
                            broadcast("cron:delayed", { agentId: req.params.id, action: intent.action, delay: intent.delay, delayMs: ms, jobId });
                        } else {
                            executedReplies.push("⚠️ Scheduler unavailable — Redis isn't connected. Delayed job not created.");
                        }
                    } catch (err: any) {
                        executedReplies.push(`❌ Failed to create delayed job: ${err.message}`);
                    }
                }
            }

            // Handle query_balance — fetch real SOL + SPL token balances
            if (intent.type === "query_balance") {
                try {
                    const keypair = agent.getKeypair();
                    const solBal = await connection.getBalance(keypair.publicKey) / 1e9;
                    const { TOKEN_PROGRAM_ID } = await import("@solana/spl-token");
                    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
                        keypair.publicKey,
                        { programId: TOKEN_PROGRAM_ID },
                    );

                    let balanceText = `💰 Wallet Balance\n\nSOL: ${solBal.toFixed(4)} SOL`;

                    if (tokenAccounts.value.length > 0) {
                        balanceText += `\n\nSPL Tokens:`;
                        for (const ta of tokenAccounts.value) {
                            const info = ta.account.data.parsed?.info;
                            const mint = info?.mint?.slice(0, 8) + "..." || "Unknown";
                            const amount = info?.tokenAmount?.uiAmountString || "0";
                            const decimals = info?.tokenAmount?.decimals || 0;
                            if (parseFloat(amount) > 0 || decimals > 0) {
                                balanceText += `\n• ${mint}: ${amount}`;
                            }
                        }
                        if (tokenAccounts.value.every((ta: any) => {
                            const amt = ta.account.data.parsed?.info?.tokenAmount?.uiAmountString;
                            return !amt || parseFloat(amt) === 0;
                        })) {
                            balanceText += `\n• No tokens with balance found`;
                        }
                    } else {
                        balanceText += `\n\nNo SPL token accounts found.`;
                    }

                    balanceText += `\n\nAddress: ${keypair.publicKey.toBase58()}`;
                    executedReplies.push(balanceText);
                } catch (err: any) {
                    executedReplies.push(`❌ Could not fetch balance: ${err.message}`);
                }
            }
        }

        // If we executed actions, use those results as the reply
        if (executedReplies.length > 0) {
            response.reply = executedReplies.join("\n\n");
        }

        broadcast("chat:message", { agentId: req.params.id, message, reply: response.reply });
        res.json(response);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Agent Config ───
app.get("/api/agents/:id/config", (req, res) => {
    const config = loadAgentConfig(req.params.id);
    if (!config) return res.status(404).json({ error: "Config not found" });
    res.json(config);
});

app.patch("/api/agents/:id/config", (req, res) => {
    try {
        const updated = updateAgentConfig(req.params.id, req.body);
        broadcast("config:updated", { agentId: req.params.id, config: updated });
        res.json(updated);
    } catch (err: any) {
        res.status(400).json({ error: err.message });
    }
});

app.delete("/api/agents/:id", (req: AuthenticatedRequest, res) => {
    const agentId = req.params.id;
    const removed = agentManager.remove(agentId);
    if (removed) {
        // Remove from user ownership
        removeAgentFromAllUsers(agentId);

        // Remove from disk
        const agentDir = path.join(process.cwd(), "data", "agents", agentId);
        try {
            if (fs.existsSync(agentDir)) {
                fs.rmSync(agentDir, { recursive: true, force: true });
                console.log(`[Delete] Removed agent directory: ${agentDir}`);
            }
        } catch (e: any) {
            console.warn(`[Delete] Failed to remove agent dir: ${e.message}`);
        }

        auditLog({ userId: req.userId, agentId, action: "delete_agent", status: "success" });
        broadcast("agent:removed", { id: agentId });
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
        const startTime = Date.now();

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

        // Record in decision memory
        const dm = new DecisionMemory();
        dm.record({
            timestamp: Date.now(),
            agentId: req.params.id,
            action: "transfer-sol",
            source: "rules",
            params: { to, amount },
            result: "success",
            reason: `Sent ${amount} SOL to ${to.slice(0, 8)}...`,
            riskScore: 20,
            confidence: 100,
            balanceAtTime: newBalance,
            executionTimeMs: Date.now() - startTime,
            txSignature: sig,
        });

        // Record in position tracker
        const pt = new PositionTracker(connection);
        pt.recordTrade(req.params.id, {
            timestamp: Date.now(),
            action: "transfer_out",
            mint: "SOL",
            amount: parseFloat(amount),
            solValue: parseFloat(amount),
            txSignature: sig,
        });

        broadcast("task:executed", { agentId: req.params.id, result: { success: true, action: "transfer-sol", signature: sig } });
        res.json({ success: true, signature: sig, newBalance });
    } catch (err: any) {
        // Record failure in decision memory
        const dm = new DecisionMemory();
        dm.record({
            timestamp: Date.now(),
            agentId: req.params.id,
            action: "transfer-sol",
            source: "rules",
            params: { to: req.body?.to, amount: req.body?.amount },
            result: "failure",
            reason: err.message,
            riskScore: 20,
            confidence: 100,
            balanceAtTime: 0,
        });
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─── Auto Recover (scan + close empty AND dust accounts) ───
app.post("/api/agents/:id/auto-recover", async (req, res) => {
    try {
        const agent = agentManager.get(req.params.id);
        if (!agent) return res.status(404).json({ error: "Agent not found" });

        const keypair = agent.getKeypair();
        const { findAllRecoverable } = await import("./skills/solRecovery.js");
        const { createCloseAccountInstruction, createBurnInstruction, TOKEN_PROGRAM_ID } = await import("@solana/spl-token");
        const { Transaction, LAMPORTS_PER_SOL } = await import("@solana/web3.js");
        const recoverable = await findAllRecoverable(connection, keypair.publicKey);

        if (recoverable.length === 0) {
            return res.json({ success: true, message: "No accounts to recover", recovered: 0, solRecovered: 0 });
        }

        // For each account: burn dust tokens first (if any), then close
        const batch = recoverable.slice(0, 10);
        const tx = new Transaction();
        for (const acct of batch) {
            if (acct.type === "dust" && acct.balance > 0) {
                // Get raw token amount (balance * 10^decimals)
                const tokenAccounts = await connection.getParsedAccountInfo(acct.address);
                const parsed = (tokenAccounts.value?.data as any)?.parsed?.info;
                const rawAmount = BigInt(parsed?.tokenAmount?.amount || "0");
                if (rawAmount > 0n) {
                    tx.add(createBurnInstruction(
                        acct.address,
                        new PublicKey(acct.mint),
                        keypair.publicKey,
                        rawAmount,
                    ));
                }
            }
            tx.add(createCloseAccountInstruction(acct.address, keypair.publicKey, keypair.publicKey));
        }
        tx.feePayer = keypair.publicKey;
        const { blockhash } = await connection.getLatestBlockhash();
        tx.recentBlockhash = blockhash;
        tx.sign(keypair);
        const sig = await connection.sendRawTransaction(tx.serialize());
        await connection.confirmTransaction(sig, "confirmed");
        const estimatedSOL = batch.reduce((s, a) => s + a.rentLamports, 0) / LAMPORTS_PER_SOL;
        broadcast("task:executed", { agentId: req.params.id, result: { success: true, action: "auto-recover", signature: sig, recovered: batch.length } });
        res.json({ success: true, signature: sig, recovered: batch.length, solRecovered: estimatedSOL });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─── Swap via SPL Token Swap ───
app.post("/api/agents/:id/swap", async (req, res) => {
    try {
        const agent = agentManager.get(req.params.id);
        if (!agent) return res.status(404).json({ error: "Agent not found" });

        const { inputMint, outputMint, amount } = req.body;
        if (!inputMint || !outputMint || !amount) {
            return res.status(400).json({ error: "inputMint, outputMint, and amount required" });
        }

        const keypair = agent.getKeypair();
        const startTime = Date.now();
        const { swapTokens } = await import("./skills/swap.js");
        const result = await swapTokens({
            connection,
            payer: keypair,
            inputMint,
            outputMint,
            amount: parseFloat(amount),
        });

        // Record in decision memory
        const dm = new DecisionMemory();
        dm.record({
            timestamp: Date.now(),
            agentId: req.params.id,
            action: "swap",
            source: "rules",
            params: { inputMint, outputMint, amount },
            result: "success",
            reason: `Swapped via ${result.route}`,
            riskScore: 40,
            confidence: 85,
            balanceAtTime: await connection.getBalance(keypair.publicKey) / 1e9,
            executionTimeMs: Date.now() - startTime,
            txSignature: result.signature,
        });

        // Record in position tracker
        const pt = new PositionTracker(connection);
        pt.recordTrade(req.params.id, {
            timestamp: Date.now(),
            action: "sell",
            mint: result.inputMint,
            amount: parseFloat(amount),
            solValue: parseFloat(amount),
            txSignature: result.signature,
        });

        broadcast("task:executed", {
            agentId: req.params.id,
            result: { success: true, action: "swap", ...result },
        });
        res.json({ success: true, ...result });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─── Pool Management ───
app.post("/api/pools/create", async (req, res) => {
    try {
        const { agentId, tokenMintA, tokenMintB, initialAmountA, initialAmountB } = req.body;
        if (!agentId || !tokenMintA || !tokenMintB || !initialAmountA || !initialAmountB) {
            return res.status(400).json({ error: "agentId, tokenMintA, tokenMintB, initialAmountA, initialAmountB required" });
        }
        const agent = agentManager.get(agentId);
        if (!agent) return res.status(404).json({ error: "Agent not found" });

        const keypair = agent.getKeypair();
        const { createPool } = await import("./skills/swap.js");
        const pool = await createPool(
            connection, keypair,
            tokenMintA, tokenMintB,
            parseInt(initialAmountA), parseInt(initialAmountB),
        );

        broadcast("task:executed", { agentId, result: { success: true, action: "create-pool", pool } });
        res.json({ success: true, pool });
    } catch (err: any) {
        console.error("[PoolCreate] Error:", err);
        res.status(500).json({ success: false, error: err.message || String(err) });
    }
});

app.get("/api/pools", async (_req, res) => {
    try {
        const { listPools } = await import("./skills/swap.js");
        res.json({ success: true, pools: listPools() });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─── Raydium CLMM Liquidity ───
app.post("/api/agents/:id/liquidity/add", async (req, res) => {
    try {
        const agent = agentManager.get(req.params.id);
        if (!agent) return res.status(404).json({ error: "Agent not found" });

        const { poolId, amountA, amountB, priceLower, priceUpper } = req.body;
        if (!poolId || !amountA || !amountB) {
            return res.status(400).json({ error: "poolId, amountA, amountB required (priceLower/priceUpper optional)" });
        }

        const keypair = agent.getKeypair();
        const { addLiquidity } = await import("./skills/raydiumLiquidity.js");
        const result = await addLiquidity(
            connection, keypair, poolId,
            parseInt(amountA), parseInt(amountB),
            priceLower ? parseFloat(priceLower) : 0.001,
            priceUpper ? parseFloat(priceUpper) : 1000,
        );

        broadcast("task:executed", { agentId: req.params.id, result: { ...result, action: "add-liquidity" } });
        res.json(result);
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post("/api/agents/:id/liquidity/remove", async (req, res) => {
    try {
        const agent = agentManager.get(req.params.id);
        if (!agent) return res.status(404).json({ error: "Agent not found" });

        const { poolId, positionNftMint, percentage } = req.body;
        if (!poolId || !positionNftMint) {
            return res.status(400).json({ error: "poolId and positionNftMint required" });
        }

        const keypair = agent.getKeypair();
        const { removeLiquidity } = await import("./skills/raydiumLiquidity.js");
        const result = await removeLiquidity(
            connection, keypair, poolId, positionNftMint,
            percentage ? parseFloat(percentage) : 100,
        );

        broadcast("task:executed", { agentId: req.params.id, result: { ...result, action: "remove-liquidity" } });
        res.json(result);
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
        const startTime = Date.now();
        const result = await agent.execute({ action, params });

        // Record in decision memory
        const dm = new DecisionMemory();
        dm.record({
            timestamp: Date.now(),
            agentId: req.params.id,
            action,
            source: "rules",
            params: params || {},
            result: result.success ? "success" : "failure",
            reason: result.error || (result.data ? `Scan found ${Array.isArray(result.data) ? result.data.length : 0} token(s)` : "Executed"),
            riskScore: 30,
            confidence: 80,
            balanceAtTime: 0,
            executionTimeMs: Date.now() - startTime,
        });

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

// NOTE: /api/agents/:id/schedules and /api/agents/:id/history are defined below
// with auth + Supabase fallback (lines ~1048 and ~1076).


app.post("/api/scheduler/schedule", schedulerGuardrailMiddleware as any, async (req: AuthenticatedRequest, res) => {
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

// ─── Agent Schedules & History ───
app.get("/api/agents/:id/schedules", authMiddleware as any, async (req: AuthenticatedRequest, res) => {
    try {
        const agentId = req.params.id;
        // Try Supabase first
        try {
            const { getScheduledJobs } = await import("./services/supabaseStore.js");
            const dbJobs = await getScheduledJobs(agentId);
            if (dbJobs.length > 0) {
                return res.json(dbJobs.map((j: any) => ({
                    name: `${j.action}-${agentId}`,
                    action: j.action,
                    cron: j.cron_pattern || "—",
                    interval: j.interval_text || "—",
                    status: j.status,
                    created: j.created_at,
                })));
            }
        } catch { }
        // Fallback: BullMQ
        const allJobs = await listScheduledJobs();
        const agentJobs = allJobs.filter((j: any) => j.data?.agentId === agentId || j.name?.includes(agentId));
        res.json(agentJobs);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.get("/api/agents/:id/history", authMiddleware as any, async (req: AuthenticatedRequest, res) => {
    try {
        const agentId = req.params.id;
        // Try Supabase first
        try {
            const { getAgentHistory } = await import("./services/supabaseStore.js");
            const dbHistory = await getAgentHistory(agentId, 30);
            if (dbHistory.length > 0) {
                return res.json(dbHistory);
            }
        } catch { }
        // Fallback: local audit log
        const entries = getAuditLog(agentId, 30);
        res.json(entries.map(e => ({
            type: e.status === "success" ? "success" : e.status === "denied" ? "denied" : "failure",
            action: e.action,
            detail: e.txSignature ? `Tx: ${e.txSignature.slice(0, 12)}...` : e.reason || "completed",
            timestamp: e.timestamp,
        })));
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

app.delete("/api/cron/jobs/:name", async (req, res) => {
    try {
        const { pattern } = req.body || {};
        if (!pattern) return res.status(400).json({ error: "pattern required in body" });
        const removed = await removeScheduledJob(req.params.name, pattern);
        res.json({ success: removed, name: req.params.name });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ─────────── START ───────────
async function start() {
    console.log("\n╔══════════════════════════════════════╗");
    console.log("║       🛡️  SolAegis Backend  🛡️         ║");
    console.log("╚══════════════════════════════════════╝\n");

    // Init scheduler (graceful degradation — falls back to in-process timers)
    await initScheduler(REDIS_URL);

    // Register the job processor — works with both Redis (BullMQ) and in-process fallback
    createWorker(async (data) => {
        const agent = agentManager.get(data.agentId);
        if (!agent) {
            console.warn(`[Worker] Agent ${data.agentId} not found, skipping job`);
            return;
        }

        const action = data.action || "dermercist";
        console.log(`[Worker] Executing ${action} for agent ${data.agentId}`);

        try {
            let result: any = {};

            if (action === "scam_check") {
                const { checkTokenSafety } = await import("./skills/scamFilter.js");
                const { TOKEN_PROGRAM_ID } = await import("@solana/spl-token");
                const keypair = agent.getKeypair();
                const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
                    keypair.publicKey, { programId: TOKEN_PROGRAM_ID });
                const flagged: string[] = [];
                for (const ta of tokenAccounts.value.slice(0, 5)) {
                    const mint = ta.account.data.parsed?.info?.mint;
                    if (!mint) continue;
                    try {
                        const check = await checkTokenSafety(connection, new PublicKey(mint));
                        if (!check.safe) flagged.push(mint);
                    } catch { }
                }
                result = { action: "scam_check", scanned: tokenAccounts.value.length, flagged: flagged.length };
            } else if (action === "scan_airdrops") {
                const execResult = await agent.execute({ action: "scan_airdrops" as any, params: {} });
                result = { action: "scan_airdrops", ...execResult };
            } else if (action === "recover") {
                const { findAllRecoverable } = await import("./skills/solRecovery.js");
                const { createCloseAccountInstruction } = await import("@solana/spl-token");
                const { Transaction: Tx } = await import("@solana/web3.js");
                const keypair = agent.getKeypair();
                const recoverable = await findAllRecoverable(connection, keypair.publicKey);
                if (recoverable.length > 0) {
                    const batch = recoverable.slice(0, 10);
                    const tx = new Tx();
                    for (const acc of batch) {
                        tx.add(createCloseAccountInstruction(acc.address, keypair.publicKey, keypair.publicKey));
                    }
                    const sig = await connection.sendTransaction(tx, [keypair]);
                    await connection.confirmTransaction(sig, "confirmed");
                    result = { action: "recover", recovered: batch.length, signature: sig };
                } else {
                    result = { action: "recover", recovered: 0 };
                }
            } else if (action === "transfer") {
                const { Transaction: Tx, SystemProgram, LAMPORTS_PER_SOL } = await import("@solana/web3.js");
                const keypair = agent.getKeypair();
                const to = data.params?.to;
                const amount = parseFloat(data.params?.amount || "0");
                if (to && amount > 0) {
                    const tx = new Tx().add(
                        SystemProgram.transfer({
                            fromPubkey: keypair.publicKey,
                            toPubkey: new PublicKey(to),
                            lamports: Math.round(amount * LAMPORTS_PER_SOL),
                        })
                    );
                    const sig = await connection.sendTransaction(tx, [keypair]);
                    await connection.confirmTransaction(sig, "confirmed");
                    result = { action: "transfer", to, amount, signature: sig };
                } else {
                    result = { action: "transfer", error: "Missing to/amount params" };
                }
            } else if (action === "airdrop") {
                const sig = await connection.requestAirdrop(agent.getKeypair().publicKey, 1e9);
                await connection.confirmTransaction(sig, "confirmed");
                result = { action: "airdrop", signature: sig };
            } else {
                // Default: run derMercist
                const dmResult = await derMercist.run(agent);
                result = { action: "dermercist", ...dmResult };
            }

            broadcast("cron:executed", { agentId: data.agentId, ...result });
        } catch (err: any) {
            console.error(`[Worker] ${action} failed for ${data.agentId}:`, err.message);
            broadcast("cron:failed", { agentId: data.agentId, action, error: err.message });
        }
    });

    // ─── Memory API ───
    app.get("/api/agents/:id/memory", (req, res) => {
        const mem = loadMemory(req.params.id);
        res.json(mem);
    });

    app.delete("/api/agents/:id/memory", (req, res) => {
        saveMemory(req.params.id, defaultMemory());
        res.json({ success: true, message: "Memory wiped" });
    });

    // ─── SOL Price API ───
    app.get("/api/price/sol", async (_req, res) => {
        try {
            const data = await getMarketData();
            res.json(data);
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    // ─── Audit Log ───
    app.get("/api/agents/:id/audit", (req, res) => {
        const entries = getAuditLog(req.params.id, 100);
        res.json(entries);
    });

    // Start HTTP + WebSocket on the same server (required for Railway/Render single-port)
    const { createServer } = await import("http");
    const server = createServer(app);
    const wss = new WebSocketServer({ server });

    server.listen(PORT, "0.0.0.0", () => {
        console.log(`[Server] REST API → http://0.0.0.0:${PORT}`);
        console.log(`[Server] WebSocket → ws://0.0.0.0:${PORT} (same port)`);
    });
    wss.on("connection", (ws) => {
        wsClients.add(ws);
        console.log("[WS] Client connected");
        ws.on("close", () => wsClients.delete(ws));

        ws.on("message", async (raw) => {
            try {
                const msg = JSON.parse(raw.toString());

                // Stream chat: { type: "chat:stream", agentId, message, token }
                if (msg.type === "chat:stream" && msg.agentId && msg.message) {
                    const agent = agentManager.get(msg.agentId);
                    if (!agent) {
                        ws.send(JSON.stringify({ type: "chat:error", error: "Agent not found" }));
                        return;
                    }

                    // First pass: parse intents deterministically (instant)
                    const response = await chatHandler.handleMessage(msg.agentId, msg.message);

                    // Process intents (schedule, unschedule, audit) — mirror HTTP handler
                    const intents = response.intents || [];
                    const executedReplies: string[] = [];
                    for (const intent of intents) {
                        // Handle schedule intent
                        if (intent.type === "schedule" && intent.action && intent.interval) {
                            const cron = intervalToCron(intent.interval);
                            if (cron) {
                                try {
                                    const jobName = `${msg.agentId}-${intent.action}`;
                                    const jobId = await scheduleCronJob(jobName, {
                                        agentId: msg.agentId,
                                        action: intent.action,
                                        params: intent.params || {},
                                    }, cron);
                                    if (jobId) {
                                        executedReplies.push(`✅ Scheduled! I'll run "${intent.action}" every ${intent.interval} automatically.`);
                                        broadcast("cron:scheduled", { agentId: msg.agentId, action: intent.action, interval: intent.interval, cron, jobId });
                                        auditLog({ agentId: msg.agentId, action: "schedule", status: "success", reason: `${intent.action} every ${intent.interval}` });
                                        // Persist to Supabase
                                        import("./services/supabaseStore.js").then(({ insertScheduledJob }) => {
                                            insertScheduledJob({
                                                agent_id: msg.agentId,
                                                action: intent.action!,
                                                cron_pattern: cron,
                                                interval_text: intent.interval,
                                                bullmq_key: jobName,
                                            }).catch(() => { });
                                        }).catch(() => { });
                                    }
                                } catch (err: any) { console.warn(`[WS] Schedule failed: ${err.message}`); }
                            }
                        }

                        // Handle unschedule intent
                        if (intent.type === "unschedule" && intent.action) {
                            try {
                                const jobs = await listScheduledJobs();
                                let removed = 0;
                                for (const job of jobs) {
                                    if (intent.action === "all" || job.name?.includes(intent.action)) {
                                        if (job.name?.includes(msg.agentId)) {
                                            await removeScheduledJob(job.name, job.pattern || job.cron);
                                            removed++;
                                        }
                                    }
                                }
                                if (removed > 0) {
                                    executedReplies.push(`✅ Removed ${removed} scheduled job(s).`);
                                    auditLog({ agentId: msg.agentId, action: "unschedule", status: "success", reason: `Removed ${intent.action}` });
                                }
                            } catch (err: any) { console.warn(`[WS] Unschedule failed: ${err.message}`); }
                        }

                        // Handle delay intent — one-shot delayed jobs ("transfer in 6 hours")
                        if (intent.type === "delay" && intent.action && intent.delay) {
                            const ms = delayToMs(intent.delay);
                            if (!ms) {
                                executedReplies.push(`⚠️ I don't support the delay "${intent.delay}". Try: 1m, 5m, 10m, 30m, 1h, 2h, 3h, 6h, 12h, or 24h.`);
                            } else {
                                try {
                                    const jobName = `${msg.agentId}-delayed-${intent.action}-${Date.now()}`;
                                    const jobId = await scheduleDelayedJob(jobName, {
                                        agentId: msg.agentId,
                                        action: intent.action,
                                        params: intent.params || {},
                                    }, ms);

                                    if (jobId) {
                                        const humanDelay = ms >= 3_600_000 ? `${ms / 3_600_000} hour(s)` : `${ms / 60_000} minute(s)`;
                                        const paramDesc = intent.params?.to
                                            ? ` — sending ${intent.params.amount || ""} SOL to ${intent.params.to}`
                                            : "";
                                        executedReplies.push(`⏳ Got it! I'll execute "${intent.action}" in ${humanDelay}${paramDesc}. Job queued.`);
                                        broadcast("cron:delayed", { agentId: msg.agentId, action: intent.action, delay: intent.delay, delayMs: ms, jobId });
                                        auditLog({ agentId: msg.agentId, action: "delay", status: "success", reason: `${intent.action} in ${humanDelay}` });
                                    } else {
                                        executedReplies.push("⚠️ Scheduler unavailable — delayed job not created.");
                                    }
                                } catch (err: any) {
                                    console.warn(`[WS] Delay job failed: ${err.message}`);
                                    executedReplies.push(`❌ Failed to create delayed job: ${err.message}`);
                                }
                            }
                        }

                        // Execute actions (airdrop, transfer, swap, recover, scam_check, scan_airdrops)
                        if (intent.type === "execute_action" && intent.action) {
                            const action = intent.action;
                            const params = intent.params || {};
                            const agent = agentManager.get(msg.agentId);

                            if (!agent) {
                                executedReplies.push(`⚠️ Agent ${msg.agentId} not found.`);
                            } else if (response.policyResult && !response.policyResult.allowed) {
                                auditLog({ agentId: msg.agentId, action, status: "denied", reason: response.policyResult.reason });
                            } else {
                                try {
                                    if (action === "airdrop") {
                                        const sig = await connection.requestAirdrop(agent.getKeypair().publicKey, 1e9);
                                        await connection.confirmTransaction(sig, "confirmed");
                                        const balance = await connection.getBalance(agent.getKeypair().publicKey) / 1e9;
                                        executedReplies.push(`✅ Airdropped 1 SOL. New balance: ${balance.toFixed(4)} SOL`);
                                        response.executionResult = { success: true, action: "airdrop", signature: sig };
                                    } else if (action === "transfer" && params.to && params.amount) {
                                        const keypair = agent.getKeypair();
                                        const { Transaction: Tx, SystemProgram, LAMPORTS_PER_SOL } = await import("@solana/web3.js");
                                        const lamports = Math.round(parseFloat(params.amount) * LAMPORTS_PER_SOL);
                                        const tx = new Tx().add(SystemProgram.transfer({ fromPubkey: keypair.publicKey, toPubkey: new PublicKey(params.to), lamports }));
                                        const sig = await connection.sendTransaction(tx, [keypair]);
                                        await connection.confirmTransaction(sig, "confirmed");
                                        executedReplies.push(`✅ Transferred ${params.amount} SOL to \`${params.to}\`. Tx: ${sig}`);
                                        response.executionResult = { success: true, action: "transfer", signature: sig };
                                    } else if (action === "recover") {
                                        const keypair = agent.getKeypair();
                                        const { findAllRecoverable } = await import("./skills/solRecovery.js");
                                        const { createCloseAccountInstruction } = await import("@solana/spl-token");
                                        const { Transaction: Tx } = await import("@solana/web3.js");
                                        const recoverable = await findAllRecoverable(connection, keypair.publicKey);
                                        if (recoverable.length === 0) {
                                            executedReplies.push("ℹ️ No empty token accounts found. Nothing to recover.");
                                        } else {
                                            const batch = recoverable.slice(0, 10);
                                            const tx = new Tx();
                                            for (const acc of batch) {
                                                tx.add(createCloseAccountInstruction(acc.address, keypair.publicKey, keypair.publicKey));
                                            }
                                            const sig = await connection.sendTransaction(tx, [keypair]);
                                            await connection.confirmTransaction(sig, "confirmed");
                                            const est = batch.reduce((s: number, a: any) => s + a.rentLamports / 1e9, 0);
                                            executedReplies.push(`✅ Recovered ${batch.length} account(s), ~${est.toFixed(4)} SOL. Tx: ${sig}`);
                                            response.executionResult = { success: true, action: "recover", signature: sig };
                                        }
                                    } else if (action === "scan_airdrops") {
                                        const result = await agent.execute({ action: "scan_airdrops" as any, params: {} });
                                        if (result.success) {
                                            const airdrops = result.data || [];
                                            executedReplies.push(airdrops.length === 0
                                                ? "📊 Scan complete. No airdrop-eligible tokens found."
                                                : `📊 Found **${airdrops.length}** token(s):\n${airdrops.map((a: any) => `• ${a.mint || "token"}: ${a.amount || "?"}`).join("\n")}`);
                                        } else {
                                            executedReplies.push(`❌ Scan failed: ${result.error}`);
                                        }
                                        response.executionResult = result;
                                    } else if (action === "scam_check") {
                                        const { checkTokenSafety } = await import("./skills/scamFilter.js");
                                        const { TOKEN_PROGRAM_ID } = await import("@solana/spl-token");
                                        const keypair = agent.getKeypair();
                                        const tokenAccounts = await connection.getParsedTokenAccountsByOwner(keypair.publicKey, { programId: TOKEN_PROGRAM_ID });
                                        if (tokenAccounts.value.length === 0) {
                                            executedReplies.push("🔍 No token accounts found. Nothing to scan.");
                                        } else {
                                            const results: string[] = [];
                                            for (const ta of tokenAccounts.value.slice(0, 5)) {
                                                const mint = ta.account.data.parsed?.info?.mint;
                                                if (!mint) continue;
                                                try {
                                                    const check = await checkTokenSafety(connection, new PublicKey(mint));
                                                    results.push(`${check.safe ? "✅" : "⚠️"} **${mint.slice(0, 8)}...** — Risk: ${check.riskScore}/100`);
                                                } catch { results.push(`❓ **${mint.slice(0, 8)}...** — Could not analyze`); }
                                            }
                                            executedReplies.push(`🔍 **Scam Scan** — ${tokenAccounts.value.length} token(s):\n\n${results.join("\n")}`);
                                        }
                                        response.executionResult = { success: true, action: "scam_check" };
                                    } else if (action === "swap") {
                                        const { swapTokens } = await import("./skills/swap.js");
                                        const keypair = agent.getKeypair();
                                        const inputMint = params.inputMint || params.from || params.tokenIn || "SOL";
                                        const outputMint = params.outputMint || params.to || params.tokenOut || "devUSDC";
                                        const amount = parseFloat(params.amount || "0.01");
                                        if (!amount || amount <= 0) {
                                            executedReplies.push("⚠️ Specify an amount. Example: \"swap 0.1 SOL to devUSDC\"");
                                        } else {
                                            const result = await swapTokens({ connection, payer: keypair, inputMint, outputMint, amount, slippageBps: parseInt(params.slippage || "100") });
                                            executedReplies.push(`✅ **Swap Executed**\n• ${amount} ${inputMint} → ~${result.estimatedOutput} ${outputMint}\n• Tx: \`${result.signature}\``);
                                            response.executionResult = { success: true, action: "swap", ...result };
                                        }
                                    } else {
                                        executedReplies.push(`⚠️ "${action}" recognized but not implemented yet.`);
                                    }

                                    auditLog({
                                        agentId: msg.agentId, action,
                                        status: response.executionResult?.success ? "success" : "failed",
                                        txSignature: response.executionResult?.signature,
                                    });
                                } catch (err: any) {
                                    executedReplies.push(`❌ ${action} failed: ${err.message}`);
                                    auditLog({ agentId: msg.agentId, action, status: "failed", reason: err.message });
                                }
                            }
                        }
                    }

                    // Stream the response back character by character for effect
                    // Handle query_balance — fetch real SOL + SPL balances
                    for (const intent of intents) {
                        if (intent.type === "query_balance") {
                            const agent = agentManager.get(msg.agentId);
                            if (agent) {
                                try {
                                    const keypair = agent.getKeypair();
                                    const solBal = await connection.getBalance(keypair.publicKey) / 1e9;
                                    const { TOKEN_PROGRAM_ID } = await import("@solana/spl-token");
                                    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
                                        keypair.publicKey, { programId: TOKEN_PROGRAM_ID });

                                    let balanceText = `💰 Wallet Balance\n\nSOL: ${solBal.toFixed(4)} SOL`;
                                    if (tokenAccounts.value.length > 0) {
                                        balanceText += `\n\nSPL Tokens:`;
                                        for (const ta of tokenAccounts.value) {
                                            const info = ta.account.data.parsed?.info;
                                            const mint = info?.mint?.slice(0, 8) + "..." || "Unknown";
                                            const amount = info?.tokenAmount?.uiAmountString || "0";
                                            if (parseFloat(amount) > 0 || (info?.tokenAmount?.decimals || 0) > 0) {
                                                balanceText += `\n• ${mint}: ${amount}`;
                                            }
                                        }
                                    } else {
                                        balanceText += `\n\nNo SPL token accounts found.`;
                                    }
                                    balanceText += `\n\nAddress: ${keypair.publicKey.toBase58()}`;
                                    executedReplies.push(balanceText);
                                } catch (err: any) {
                                    executedReplies.push(`❌ Could not fetch balance: ${err.message}`);
                                }
                            }
                        }
                    }

                    // Stream the response back character by character for effect
                    const fullReply = executedReplies.length > 0
                        ? response.reply + "\n\n" + executedReplies.join("\n")
                        : response.reply || "";
                    const chunkSize = 8; // Characters per chunk
                    for (let i = 0; i < fullReply.length; i += chunkSize) {
                        const chunk = fullReply.slice(i, i + chunkSize);
                        ws.send(JSON.stringify({ type: "chat:chunk", text: chunk }));
                        // Small delay for streaming effect (4ms per chunk ~ 2000 chars/sec)
                        await new Promise(r => setTimeout(r, 4));
                    }

                    // Send final message with full response
                    ws.send(JSON.stringify({
                        type: "chat:done",
                        reply: fullReply,
                        intents: response.intents,
                        policyResult: response.policyResult,
                        executionResult: response.executionResult,
                    }));
                }
            } catch (err: any) {
                ws.send(JSON.stringify({ type: "chat:error", error: err.message }));
            }
        });
    });
    console.log(`[Server] WebSocket → ws://localhost:${WS_PORT}`);
    console.log(`[Server] RPC       → ${RPC_URL}`);
    console.log(`[Server] LLM Keys  → ${keyStore.totalKeys()} loaded`);

    // Initialize Supabase
    try {
        const { getSupabase, isSupabaseReady } = await import("./services/supabaseClient.js");
        if (isSupabaseReady()) {
            getSupabase();
            console.log(`[Server] Supabase  → connected`);
        } else {
            console.log(`[Server] Supabase  → not configured (using JSON files)`);
        }
    } catch { console.log(`[Server] Supabase  → unavailable`); }

    console.log("");

    // Graceful shutdown
    process.on("SIGINT", async () => {
        console.log("\nShutting down...");
        await shutdownScheduler();
        process.exit(0);
    });
}

start().catch(console.error);

export { app, agentManager, derMercist };

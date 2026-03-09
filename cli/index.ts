#!/usr/bin/env npx tsx
/**
 * @solaegis/cli — API-first terminal interface for SolAegis agents.
 *
 * Usage:
 *   npx tsx cli/index.ts auth login
 *   npx tsx cli/index.ts agents list
 *   npx tsx cli/index.ts chat --agent <id> "Swap 1 SOL for USDC"
 *   npx tsx cli/index.ts skills --agent <id>
 *   npx tsx cli/index.ts jobs list --agent <id>
 *   npx tsx cli/index.ts config update --agent <id> --risk low
 *   npx tsx cli/index.ts config show --agent <id>
 */

import dotenv from "dotenv";
dotenv.config();

import { Command } from "commander";

const chalkModule = await import("chalk");
const chalk = chalkModule.default;

const API_URL = process.env.API_URL || `http://localhost:${process.env.PORT || 4000}/api`;
let AUTH_TOKEN: string | null = null;

// ─── Helpers ───

async function api(method: string, path: string, body?: any): Promise<any> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (AUTH_TOKEN) headers["Authorization"] = `Bearer ${AUTH_TOKEN}`;

    const res = await fetch(`${API_URL}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`);
    return data;
}

function requireAgent(agent: string | undefined): string {
    if (!agent) {
        console.error(chalk.red("  ✗ --agent <id> is required"));
        process.exit(1);
    }
    return agent;
}

function banner() {
    console.log("");
    console.log(chalk.cyan("╔══════════════════════════════════════════════════╗"));
    console.log(chalk.cyan("║") + chalk.bold.white("       🛡️  SolAegis CLI  🛡️                       ") + chalk.cyan("║"));
    console.log(chalk.cyan("║") + chalk.gray("   Autonomous Agent Platform for Solana DeFi     ") + chalk.cyan("║"));
    console.log(chalk.cyan("╚══════════════════════════════════════════════════╝"));
    console.log(chalk.gray(`   API: ${API_URL}\n`));
}

// ─── Program ───

const program = new Command();
program
    .name("solaegis")
    .description("CLI for the SolAegis autonomous agent platform")
    .version("1.0.0")
    .option("-t, --token <jwt>", "JWT auth token (or set SOLAEGIS_TOKEN env var)")
    .hook("preAction", (thisCmd) => {
        const opts = thisCmd.opts();
        AUTH_TOKEN = opts.token || process.env.SOLAEGIS_TOKEN || null;
        banner();
    });

// ─── Auth ───

const auth = program.command("auth").description("Authentication commands");

auth.command("login")
    .description("Login with username and password")
    .requiredOption("-u, --username <user>", "Username")
    .requiredOption("-p, --password <pass>", "Password")
    .action(async (opts) => {
        try {
            const data = await api("POST", "/auth/login", {
                userId: opts.username,
                password: opts.password,
            });
            AUTH_TOKEN = data.token;
            console.log(chalk.green("  ✓ Logged in successfully"));
            console.log(chalk.gray(`    Token: ${data.token?.slice(0, 24)}...`));
            console.log(chalk.gray(`    User: ${data.user?.id || opts.username}\n`));
        } catch (err: any) {
            console.error(chalk.red(`  ✗ Login failed: ${err.message}\n`));
        }
    });

auth.command("register")
    .description("Register a new account")
    .requiredOption("-u, --username <user>", "Username")
    .requiredOption("-p, --password <pass>", "Password")
    .action(async (opts) => {
        try {
            const data = await api("POST", "/auth/register", {
                userId: opts.username,
                password: opts.password,
            });
            console.log(chalk.green(`  ✓ Registered: ${data.user?.id || opts.username}\n`));
        } catch (err: any) {
            console.error(chalk.red(`  ✗ Registration failed: ${err.message}\n`));
        }
    });

auth.command("wallet-verify")
    .description("Authenticate via Ed25519 wallet signature")
    .requiredOption("-a, --address <address>", "Wallet public key (base58)")
    .action(async (opts) => {
        try {
            const nonceData = await api("POST", "/auth/wallet/nonce", { address: opts.address });
            console.log(chalk.yellow(`  ⚡ Sign this nonce with your wallet: ${nonceData.nonce}`));
            console.log(chalk.gray(`    Then call: solaegis auth wallet-submit --address ${opts.address} --signature <sig>\n`));
        } catch (err: any) {
            console.error(chalk.red(`  ✗ Nonce request failed: ${err.message}\n`));
        }
    });

// ─── Agents ───

const agents = program.command("agents").description("Manage agents");

agents.command("list")
    .description("List all agents")
    .action(async () => {
        try {
            const data = await api("GET", "/agents");
            const list = Array.isArray(data) ? data : data.agents || [];
            if (list.length === 0) {
                console.log(chalk.yellow("  No agents found.\n"));
                return;
            }
            console.log(chalk.bold.white("\n  📋 Active Agents\n"));
            for (const a of list) {
                const bal = a.balance != null ? `${Number(a.balance).toFixed(4)} SOL` : "?";
                const addr = a.publicKey || a.address || "?";
                console.log(
                    `  ✅ ${chalk.bold.cyan((a.id || a.name || "?").padEnd(22))} ` +
                    `${chalk.green(bal.padEnd(14))} ` +
                    `${chalk.gray("→ " + addr.slice(0, 16) + "...")}`
                );
            }
            console.log("");
        } catch (err: any) {
            console.error(chalk.red(`  ✗ ${err.message}\n`));
        }
    });

agents.command("create")
    .description("Create a new agent")
    .requiredOption("-n, --name <name>", "Agent name")
    .option("-r, --role <role>", "Agent role", "trader")
    .option("--risk <profile>", "Risk profile: low, medium, high", "medium")
    .action(async (opts) => {
        try {
            const data = await api("POST", "/agents", {
                id: opts.name,
                role: opts.role,
                riskProfile: opts.risk,
            });
            console.log(chalk.green(`  ✓ Agent "${opts.name}" created`));
            console.log(chalk.gray(`    Public Key: ${data.publicKey || data.agent?.publicKey || "?"}`));
            console.log(chalk.gray(`    Role: ${opts.role} | Risk: ${opts.risk}\n`));
        } catch (err: any) {
            console.error(chalk.red(`  ✗ ${err.message}\n`));
        }
    });

agents.command("delete")
    .description("Remove an agent")
    .requiredOption("-a, --agent <id>", "Agent ID")
    .action(async (opts) => {
        try {
            await api("DELETE", `/agents/${opts.agent}`);
            console.log(chalk.green(`  ✓ Agent "${opts.agent}" removed\n`));
        } catch (err: any) {
            console.error(chalk.red(`  ✗ ${err.message}\n`));
        }
    });

// ─── Chat ───

program.command("chat")
    .description("Send a message to an agent via the LLM intent pipeline")
    .requiredOption("-a, --agent <id>", "Agent ID")
    .argument("<message...>", "Message to send")
    .action(async (messageParts, opts) => {
        const agentId = requireAgent(opts.agent);
        const message = messageParts.join(" ");
        try {
            console.log(chalk.gray(`  → Sending to ${agentId}: "${message}"\n`));
            const data = await api("POST", `/agents/${agentId}/chat`, { message });

            // Show reply
            console.log(chalk.bold.white("  🤖 Agent Reply:\n"));
            console.log("  " + (data.reply || "No reply").split("\n").join("\n  "));
            console.log("");

            // Show intents
            const intents = data.intents || (data.intent ? [data.intent] : []);
            if (intents.length > 0) {
                console.log(chalk.bold.white("  📋 Parsed Intents:\n"));
                for (const intent of intents) {
                    const color = intent.type === "execute_action" ? chalk.green :
                        intent.type === "schedule" ? chalk.blue :
                            intent.type === "delay" ? chalk.yellow :
                                chalk.gray;
                    console.log(`  ${color("●")} ${chalk.bold(intent.type)}${intent.action ? `: ${intent.action}` : ""}`);
                    if (intent.params && Object.keys(intent.params).length > 0) {
                        console.log(chalk.gray(`    params: ${JSON.stringify(intent.params)}`));
                    }
                    if (intent.interval) console.log(chalk.gray(`    interval: ${intent.interval}`));
                    if (intent.delay) console.log(chalk.gray(`    delay: ${intent.delay}`));
                }
                console.log("");
            }

            // Show execution result
            if (data.executionResult) {
                const r = data.executionResult;
                const icon = r.success ? chalk.green("✓") : chalk.red("✗");
                console.log(chalk.bold.white("  ⚡ Execution Result:\n"));
                console.log(`  ${icon} ${JSON.stringify(r, null, 2).split("\n").join("\n  ")}\n`);
            }

            // Show policy result
            if (data.policyResult && !data.policyResult.allowed) {
                console.log(chalk.red(`  ⛔ Policy Denied: ${data.policyResult.reason}\n`));
            }
        } catch (err: any) {
            console.error(chalk.red(`  ✗ Chat failed: ${err.message}\n`));
        }
    });

// ─── Skills ───

program.command("skills")
    .description("View the loaded SKILLS.md operating manual for an agent")
    .requiredOption("-a, --agent <id>", "Agent ID")
    .action(async (opts) => {
        const agentId = requireAgent(opts.agent);
        try {
            console.log(chalk.gray(`\n  🔍 Fetching loaded skills for agent: ${agentId}...\n`));
            const data = await api("GET", `/agents/${agentId}/skills`);

            // Render skills with basic formatting
            const lines = (data.skills || "").split("\n");
            for (const line of lines) {
                if (line.startsWith("# ")) {
                    console.log(chalk.bold.cyan(`  ${line}`));
                } else if (line.startsWith("## ")) {
                    console.log(chalk.bold.white(`  ${line}`));
                } else if (line.startsWith("### ")) {
                    console.log(chalk.bold.yellow(`  ${line}`));
                } else if (line.startsWith("- ")) {
                    console.log(chalk.white(`  ${line}`));
                } else if (line.startsWith("> ")) {
                    console.log(chalk.italic.gray(`  ${line}`));
                } else if (line.startsWith("```")) {
                    console.log(chalk.gray(`  ${line}`));
                } else {
                    console.log(chalk.gray(`  ${line}`));
                }
            }

            // Show metadata
            if (data.meta) {
                console.log(chalk.bold.white("\n  📊 Meta\n"));
                console.log(chalk.gray(`    Lines: ${data.meta.lines}`));
                console.log(chalk.gray(`    Sections: ${data.meta.sections?.join(", ")}`));
                console.log(chalk.gray(`    Loaded at: ${data.meta.loadedAt}`));
            }
            console.log(chalk.green(`\n  ✅ Skills loaded from ${agentId}'s memory.\n`));
        } catch (err: any) {
            console.error(chalk.red(`  ✗ ${err.message}\n`));
        }
    });

// ─── Jobs ───

const jobs = program.command("jobs").description("View and manage scheduled jobs");

jobs.command("list")
    .description("List scheduled jobs for an agent")
    .option("-a, --agent <id>", "Filter by agent ID")
    .action(async (opts) => {
        try {
            let data;
            if (opts.agent) {
                data = await api("GET", `/agents/${opts.agent}/schedules`);
            } else {
                data = await api("GET", "/cron/jobs");
            }
            const list = Array.isArray(data) ? data : data.jobs || [];
            if (list.length === 0) {
                console.log(chalk.yellow("  No scheduled jobs found.\n"));
                return;
            }
            console.log(chalk.bold.white("\n  ⏰ Scheduled Jobs\n"));
            for (const job of list) {
                const name = job.name || job.key || "?";
                const cron = job.pattern || job.cron || job.repeat?.pattern || "?";
                const action = job.data?.action || "?";
                const agent = job.data?.agentId || "?";
                console.log(
                    `  🔄 ${chalk.bold.cyan(name.padEnd(30))} ` +
                    `${chalk.yellow(cron.padEnd(16))} ` +
                    `${chalk.gray(`action=${action}`)} ` +
                    `${chalk.gray(`agent=${agent}`)}`
                );
            }
            console.log("");
        } catch (err: any) {
            console.error(chalk.red(`  ✗ ${err.message}\n`));
        }
    });

jobs.command("remove")
    .description("Remove a scheduled job")
    .requiredOption("-n, --name <name>", "Job name")
    .action(async (opts) => {
        try {
            await api("DELETE", `/cron/jobs/${encodeURIComponent(opts.name)}`);
            console.log(chalk.green(`  ✓ Job "${opts.name}" removed\n`));
        } catch (err: any) {
            console.error(chalk.red(`  ✗ ${err.message}\n`));
        }
    });

// ─── Config ───

const config = program.command("config").description("View and update agent configuration");

config.command("show")
    .description("Show agent configuration")
    .requiredOption("-a, --agent <id>", "Agent ID")
    .action(async (opts) => {
        const agentId = requireAgent(opts.agent);
        try {
            const data = await api("GET", `/agents/${agentId}/config`);
            console.log(chalk.bold.white(`\n  ⚙️  Config: ${agentId}\n`));
            console.log(chalk.white(`    Role:           ${chalk.cyan(data.role || "?")}`));
            console.log(chalk.white(`    Risk Profile:   ${chalk.yellow(data.riskProfile || "?")}`));
            console.log(chalk.white(`    Max SOL/tx:     ${chalk.green(data.maxSolPerTx || "?")}`));
            console.log(chalk.white(`    Daily Limit:    ${chalk.green(data.dailyTxLimit || "?")}`));
            console.log(chalk.white(`    Allowed:        ${chalk.gray((data.allowedActions || []).join(", "))}`));
            console.log(chalk.white(`    Created:        ${chalk.gray(data.createdAt || "?")}\n`));
        } catch (err: any) {
            console.error(chalk.red(`  ✗ ${err.message}\n`));
        }
    });

config.command("update")
    .description("Update agent configuration")
    .requiredOption("-a, --agent <id>", "Agent ID")
    .option("--risk <profile>", "Risk profile: low, medium, high")
    .option("--max-sol <amount>", "Max SOL per transaction")
    .option("--daily-limit <n>", "Daily transaction limit")
    .option("--role <role>", "Agent role")
    .action(async (opts) => {
        const agentId = requireAgent(opts.agent);
        const updates: any = {};
        if (opts.risk) updates.riskProfile = opts.risk;
        if (opts.maxSol) updates.maxSolPerTx = parseFloat(opts.maxSol);
        if (opts.dailyLimit) updates.dailyTxLimit = parseInt(opts.dailyLimit);
        if (opts.role) updates.role = opts.role;

        if (Object.keys(updates).length === 0) {
            console.log(chalk.yellow("  No updates specified. Use --risk, --max-sol, --daily-limit, or --role.\n"));
            return;
        }
        try {
            const data = await api("PATCH", `/agents/${agentId}/config`, updates);
            console.log(chalk.green(`  ✓ Config updated for ${agentId}`));
            for (const [k, v] of Object.entries(updates)) {
                console.log(chalk.gray(`    ${k}: ${v}`));
            }
            console.log("");
        } catch (err: any) {
            console.error(chalk.red(`  ✗ ${err.message}\n`));
        }
    });

// ─── History ───

program.command("history")
    .description("View agent action history")
    .requiredOption("-a, --agent <id>", "Agent ID")
    .action(async (opts) => {
        const agentId = requireAgent(opts.agent);
        try {
            const data = await api("GET", `/agents/${agentId}/history`);
            const list = Array.isArray(data) ? data : [];
            if (list.length === 0) {
                console.log(chalk.yellow("  No history found.\n"));
                return;
            }
            console.log(chalk.bold.white(`\n  📜 History: ${agentId}\n`));
            for (const entry of list) {
                const icon = entry.type === "success" ? chalk.green("✓") :
                    entry.type === "failure" ? chalk.red("✗") :
                        chalk.gray("●");
                const time = entry.timestamp ? new Date(entry.timestamp).toLocaleString() : "";
                console.log(`  ${icon} ${chalk.bold(entry.action || "?")} ${chalk.gray(entry.detail || "")} ${chalk.gray(time)}`);
            }
            console.log("");
        } catch (err: any) {
            console.error(chalk.red(`  ✗ ${err.message}\n`));
        }
    });

// ─── Audit ───

program.command("audit")
    .description("View agent audit log")
    .requiredOption("-a, --agent <id>", "Agent ID")
    .action(async (opts) => {
        const agentId = requireAgent(opts.agent);
        try {
            const data = await api("GET", `/agents/${agentId}/audit`);
            const list = Array.isArray(data) ? data : [];
            if (list.length === 0) {
                console.log(chalk.yellow("  No audit entries found.\n"));
                return;
            }
            console.log(chalk.bold.white(`\n  🔐 Audit Log: ${agentId}\n`));
            for (const entry of list) {
                const icon = entry.status === "success" ? chalk.green("✓") :
                    entry.status === "denied" ? chalk.red("⛔") :
                        entry.status === "failed" ? chalk.red("✗") :
                            chalk.gray("●");
                const sig = entry.txSignature ? chalk.gray(` tx:${entry.txSignature.slice(0, 12)}...`) : "";
                console.log(`  ${icon} ${chalk.bold(entry.action || "?")} ${chalk.gray(entry.reason || "")}${sig}`);
            }
            console.log("");
        } catch (err: any) {
            console.error(chalk.red(`  ✗ ${err.message}\n`));
        }
    });

// ─── Market ───

program.command("market")
    .description("Get SOL price and market data")
    .action(async () => {
        try {
            const data = await api("GET", "/price/sol");
            console.log(chalk.bold.white("\n  📈 SOL Market Data\n"));
            console.log(chalk.white(`    Price:      ${chalk.green("$" + (data.price || data.solPrice || "?"))}`));
            if (data.change24h != null) console.log(chalk.white(`    24h Change: ${data.change24h >= 0 ? chalk.green("+" + data.change24h + "%") : chalk.red(data.change24h + "%")}`));
            if (data.marketCap) console.log(chalk.white(`    Market Cap: ${chalk.gray("$" + data.marketCap)}`));
            if (data.volume) console.log(chalk.white(`    Volume:     ${chalk.gray("$" + data.volume)}`));
            console.log("");
        } catch (err: any) {
            console.error(chalk.red(`  ✗ ${err.message}\n`));
        }
    });

// ─── Parse & Run ───

program.parse(process.argv);

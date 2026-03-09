#!/usr/bin/env npx tsx
/**
 * SolAegis CLI Demo — runs the full multi-agent demo flow in one shot.
 * Designed to be recorded for hackathon submission.
 */
import dotenv from "dotenv";
dotenv.config();

const chalkModule = await import("chalk");
const chalk = chalkModule.default;

const API_URL = process.env.API_URL || `https://solaegis-production.up.railway.app/api`;
let AUTH_TOKEN: string | null = null;

async function api(method: string, path: string, body?: any): Promise<any> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (AUTH_TOKEN) headers["Authorization"] = `Bearer ${AUTH_TOKEN}`;

    const res = await fetch(`${API_URL}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) throw new Error((data as any).error || `HTTP ${res.status}`);
    return data;
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function banner() {
    console.log("");
    console.log(chalk.cyan("╔══════════════════════════════════════════════════╗"));
    console.log(chalk.cyan("║") + chalk.bold.white("       🛡️  SolAegis CLI  🛡️                       ") + chalk.cyan("║"));
    console.log(chalk.cyan("║") + chalk.gray("   Autonomous Agent Platform for Solana DeFi     ") + chalk.cyan("║"));
    console.log(chalk.cyan("╚══════════════════════════════════════════════════╝"));
    console.log(chalk.gray(`   API: ${API_URL}\n`));
}

async function main() {
    banner();

    // ──── Step 0: Authenticate ────
    console.log(chalk.bold.white("  🔐 Authenticating...\n"));
    try {
        const data = await api("POST", "/auth/login", { userId: "clidemo", password: "SolAegis2026!" });
        AUTH_TOKEN = data.token;
        console.log(chalk.green("  ✓ Authenticated as clidemo\n"));
    } catch {
        // If login fails, try register
        try {
            const data = await api("POST", "/auth/register", { userId: "clidemo", password: "SolAegis2026!" });
            AUTH_TOKEN = data.token;
            console.log(chalk.green("  ✓ Registered & authenticated as clidemo\n"));
        } catch (err: any) {
            console.error(chalk.red(`  ✗ Auth failed: ${err.message}\n`));
            return;
        }
    }
    await sleep(500);

    // ──── Step 1: Create agents (if they don't exist) ────
    console.log(chalk.bold.white("  📦 Creating Agents...\n"));

    const agentsToCreate = [
        { id: "TraderBot", role: "trader" },
        { id: "SecurityBot", role: "monitor" },
        { id: "MonitorBot", role: "custom" },
    ];

    for (const a of agentsToCreate) {
        try {
            const data = await api("POST", "/agents", { id: a.id, role: a.role });
            console.log(chalk.green(`  ✓ Created ${chalk.bold.cyan(a.id)} (${a.role}) → ${chalk.gray((data.publicKey || "?").slice(0, 16) + "...")}`));
        } catch (err: any) {
            if (err.message.includes("exists")) {
                console.log(chalk.yellow(`  ● ${chalk.bold.cyan(a.id)} already exists`));
            } else {
                console.log(chalk.yellow(`  ● ${chalk.bold.cyan(a.id)}: ${err.message}`));
            }
        }
    }
    console.log("");
    await sleep(500);

    // ──── Step 2: List Agents ────
    console.log(chalk.bold.white("  📋 Active Agents\n"));
    try {
        const data = await api("GET", "/agents");
        const list = Array.isArray(data) ? data : [];
        for (const a of list) {
            const bal = a.balance != null ? `${Number(a.balance).toFixed(4)} SOL` : "—";
            const addr = a.publicKey || "?";
            const role = a.config?.role || "?";
            console.log(
                `  ${chalk.green("●")} ${chalk.bold.cyan((a.id || "?").padEnd(18))} ` +
                `${chalk.yellow(role.padEnd(10))} ` +
                `${chalk.green(bal.padEnd(14))} ` +
                `${chalk.gray("→ " + addr.slice(0, 16) + "...")}`
            );
        }
        console.log("");
    } catch (err: any) {
        console.error(chalk.red(`  ✗ ${err.message}\n`));
    }
    await sleep(1000);

    // ──── Step 3: Send commands to different agents ────
    console.log(chalk.bold.white("  ⚡ Sending Commands...\n"));

    const commands = [
        { agent: "TraderBot", message: "Scan airdrops" },
        { agent: "SecurityBot", message: "What can you do?" },
        { agent: "MonitorBot", message: "Check wallet balance" },
    ];

    for (const cmd of commands) {
        console.log(chalk.gray(`  → [${cmd.agent}] "${cmd.message}"`));
        try {
            const data = await api("POST", `/agents/${cmd.agent}/chat`, { message: cmd.message });
            const reply = (data.reply || "No reply").split("\n").map((l: string) => `    ${l}`).join("\n");
            const intents = data.intents || (data.intent ? [data.intent] : []);
            const intentStr = intents.map((i: any) => `${i.type}${i.action ? `:${i.action}` : ""}`).join(", ");

            console.log(chalk.white(`  ${chalk.bold.cyan("🤖")} [${chalk.bold(cmd.agent)}]:`));
            console.log(chalk.white(reply));
            if (intentStr) {
                console.log(chalk.gray(`    📋 Intent: ${intentStr}`));
            }
            if (data.executionResult?.signature) {
                console.log(chalk.green(`    ✓ Tx: ${data.executionResult.signature.slice(0, 24)}...`));
            }
            console.log("");
        } catch (err: any) {
            console.log(chalk.red(`  ✗ [${cmd.agent}]: ${err.message}\n`));
        }
        await sleep(500);
    }

    // ──── Done ────
    console.log(chalk.cyan("  ────────────────────────────────────────────────"));
    console.log(chalk.bold.white("  ✅ Demo Complete — 3 autonomous agents executed\n"));
    console.log(chalk.gray("  Each agent has its own Solana wallet, risk limits,"));
    console.log(chalk.gray("  policy engine, and LLM-powered intent pipeline.\n"));
}

main().catch(err => console.error(chalk.red(err.message)));

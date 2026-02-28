import dotenv from "dotenv";
dotenv.config();

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const inquirer = require("inquirer");
const chalk = require("chalk");

import { Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { AgentManager } from "../backend/core/agentManager.js";

const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const connection = new Connection(RPC_URL, "confirmed");
const agentManager = new AgentManager(connection);

async function banner() {
    console.log("");
    console.log(chalk.cyan("╔══════════════════════════════════════════════════╗"));
    console.log(chalk.cyan("║") + chalk.bold.white("       🛡️  SolAegis — CLI Dashboard  🛡️           ") + chalk.cyan("║"));
    console.log(chalk.cyan("║") + chalk.gray("   Autonomous Multi-Agent DeFi Infrastructure   ") + chalk.cyan("║"));
    console.log(chalk.cyan("╚══════════════════════════════════════════════════╝"));
    console.log(chalk.gray(`   RPC: ${RPC_URL}\n`));
}

async function showAgents() {
    const agents = agentManager.list();
    if (agents.length === 0) {
        console.log(chalk.yellow("\n  No agents created yet.\n"));
        return;
    }

    console.log(chalk.bold.white("\n  📋 Active Agents\n"));
    for (const agent of agents) {
        const state = await agent.getState();
        const balanceStr = state.balance.toFixed(4);
        const statusIcon = state.pendingTx > 0 ? "⏳" : "✅";
        console.log(
            `  ${statusIcon} ${chalk.bold.cyan(state.id.padEnd(20))} ` +
            `${chalk.green(balanceStr + " SOL")} ` +
            `${chalk.gray("→ " + state.publicKey.slice(0, 12) + "...")}`
        );
    }
    console.log("");
}

async function showSkills() {
    const skills = agentManager.getDeFiSkill().getSkillsDocumentation();
    console.log(chalk.bold.white("\n  📖 Skills Documentation\n"));
    console.log(chalk.gray("  " + skills.split("\n").join("\n  ")));
    console.log("");
}

async function mainMenu() {
    const { action } = await inquirer.prompt([
        {
            type: "list",
            name: "action",
            message: chalk.bold("What would you like to do?"),
            choices: [
                { name: "📋 List Agents", value: "list" },
                { name: "➕ Create Agent", value: "create" },
                { name: "🚀 Execute Task", value: "execute" },
                { name: "📖 View Skills", value: "skills" },
                { name: "💰 Request Airdrop", value: "airdrop" },
                { name: "🔍 Scan Airdrops", value: "scan" },
                { name: "🧠 Run DerMercist", value: "dermercist" },
                { name: "❌ Exit", value: "exit" },
            ],
        },
    ]);

    switch (action) {
        case "list":
            await showAgents();
            break;

        case "create": {
            const { name } = await inquirer.prompt([
                { type: "input", name: "name", message: "Agent name:" },
            ]);
            if (name.trim()) {
                const agent = agentManager.create(name.trim());
                console.log(
                    chalk.green(`\n  ✓ Agent "${name}" created → ${agent.getPublicKey()}\n`)
                );
            }
            break;
        }

        case "execute": {
            const agents = agentManager.list();
            if (agents.length === 0) {
                console.log(chalk.yellow("\n  Create an agent first.\n"));
                break;
            }

            const { agentId, taskAction } = await inquirer.prompt([
                {
                    type: "list",
                    name: "agentId",
                    message: "Select agent:",
                    choices: agents.map((a) => a.id),
                },
                {
                    type: "list",
                    name: "taskAction",
                    message: "Select action:",
                    choices: ["transfer", "swap", "liquidity", "recover", "scan_airdrops"],
                },
            ]);

            const agent = agentManager.get(agentId);
            if (agent) {
                console.log(chalk.gray(`\n  Executing "${taskAction}" for ${agentId}...`));
                const result = await agent.execute({ action: taskAction, params: {} });
                if (result.success) {
                    console.log(chalk.green(`  ✓ Success — sig: ${result.signature}\n`));
                } else {
                    console.log(chalk.red(`  ✗ Failed — ${result.error}\n`));
                }
            }
            break;
        }

        case "skills":
            await showSkills();
            break;

        case "airdrop": {
            const agents = agentManager.list();
            if (agents.length === 0) {
                console.log(chalk.yellow("\n  Create an agent first.\n"));
                break;
            }
            const { agentId } = await inquirer.prompt([
                {
                    type: "list",
                    name: "agentId",
                    message: "Airdrop SOL to which agent?",
                    choices: agents.map((a) => a.id),
                },
            ]);
            try {
                const keypair = agentManager.getWalletService().getDecryptedKeypair(agentId);
                const sig = await connection.requestAirdrop(
                    keypair.publicKey,
                    1 * LAMPORTS_PER_SOL
                );
                console.log(chalk.green(`\n  ✓ Airdropped 1 SOL → sig: ${sig}\n`));
            } catch (err: any) {
                console.log(chalk.red(`\n  ✗ Airdrop failed: ${err.message}\n`));
            }
            break;
        }

        case "scan": {
            const agents = agentManager.list();
            if (agents.length === 0) {
                console.log(chalk.yellow("\n  Create an agent first.\n"));
                break;
            }
            const { agentId } = await inquirer.prompt([
                {
                    type: "list",
                    name: "agentId",
                    message: "Scan which agent's tokens?",
                    choices: agents.map((a) => a.id),
                },
            ]);
            const agent = agentManager.get(agentId);
            if (agent) {
                const result = await agent.execute({
                    action: "scan_airdrops",
                    params: {},
                });
                if (result.data && result.data.length > 0) {
                    console.log(chalk.bold.white(`\n  🔍 Found ${result.data.length} token(s):\n`));
                    for (const t of result.data) {
                        const icon = t.suspicious ? "⚠️" : "✅";
                        console.log(
                            `  ${icon} ${chalk.cyan(t.mint.slice(0, 16))}... ` +
                            `amount=${t.amount} ${t.reason ? chalk.red(t.reason) : ""}`
                        );
                    }
                } else {
                    console.log(chalk.gray("\n  No token accounts found.\n"));
                }
            }
            break;
        }

        case "dermercist": {
            const agents = agentManager.list();
            if (agents.length === 0) {
                console.log(chalk.yellow("\n  Create agents first.\n"));
                break;
            }
            console.log(chalk.gray("\n  Running DerMercist decision loop...\n"));
            // DerMercist would need LLM — for CLI demo, show agent states
            for (const agent of agents) {
                const state = await agent.getState();
                console.log(
                    `  🧠 ${chalk.bold(state.id)}: balance=${chalk.green(state.balance.toFixed(4))} SOL, ` +
                    `pending=${state.pendingTx}, skills=[${state.skills.join(",")}]`
                );
            }
            console.log("");
            break;
        }

        case "exit":
            console.log(chalk.gray("\n  Goodbye! 👋\n"));
            process.exit(0);
    }

    // Loop
    await mainMenu();
}

async function startCLI() {
    await banner();
    await mainMenu();
}

startCLI().catch(console.error);

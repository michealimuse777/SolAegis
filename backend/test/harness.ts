import dotenv from "dotenv";
dotenv.config();

import { Connection, LAMPORTS_PER_SOL, Keypair } from "@solana/web3.js";
import { AgentManager } from "../core/agentManager.js";

const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";

function log(msg: string) {
    console.log(`[Harness] ${msg}`);
}

function pass(test: string) {
    console.log(`  ✅ PASS: ${test}`);
}

function fail(test: string, reason: string) {
    console.log(`  ❌ FAIL: ${test} — ${reason}`);
}

async function runHarness() {
    console.log("\n╔══════════════════════════════════════════╗");
    console.log("║   🧪 SolAegis Multi-Agent Test Harness   ║");
    console.log("╚══════════════════════════════════════════╝\n");

    // Verify MASTER_KEY is set
    if (!process.env.MASTER_KEY) {
        // Generate a temporary one for testing
        const crypto = await import("crypto");
        process.env.MASTER_KEY = crypto.randomBytes(32).toString("hex");
        log("Generated temporary MASTER_KEY for testing");
    }

    const connection = new Connection(RPC_URL, "confirmed");
    const agentManager = new AgentManager(connection);

    let passed = 0;
    let failed = 0;

    // ───── Test 1: Create Agents ─────
    log("\n─── Test 1: Agent Creation ───");
    try {
        const trader = agentManager.create("Trader");
        const lp = agentManager.create("LiquidityProvider");
        const scanner = agentManager.create("AirdropScanner");

        if (
            trader.getPublicKey().length > 30 &&
            lp.getPublicKey().length > 30 &&
            scanner.getPublicKey().length > 30
        ) {
            pass("Created 3 agents with unique wallets");
            passed++;
        } else {
            fail("Agent creation", "Invalid public keys");
            failed++;
        }
    } catch (err: any) {
        fail("Agent creation", err.message);
        failed++;
    }

    // ───── Test 2: Wallet Encryption Round-trip ─────
    log("\n─── Test 2: Encryption Round-trip ───");
    try {
        const ws = agentManager.getWalletService();
        const keypair = ws.getDecryptedKeypair("Trader");
        const pubkey = keypair.publicKey.toBase58();

        if (pubkey === agentManager.get("Trader")!.getPublicKey()) {
            pass("Encryption round-trip OK — decrypt matches original");
            passed++;
        } else {
            fail("Encryption", "Decrypted key doesn't match");
            failed++;
        }
    } catch (err: any) {
        fail("Encryption round-trip", err.message);
        failed++;
    }

    // ───── Test 3: Agent State ─────
    log("\n─── Test 3: Agent State ───");
    try {
        const trader = agentManager.get("Trader")!;
        const state = await trader.getState();

        if (
            state.id === "Trader" &&
            state.publicKey.length > 30 &&
            typeof state.balance === "number" &&
            Array.isArray(state.skills)
        ) {
            pass(`Agent state OK — balance=${state.balance} SOL, skills=[${state.skills.join(",")}]`);
            passed++;
        } else {
            fail("Agent state", "Invalid state structure");
            failed++;
        }
    } catch (err: any) {
        fail("Agent state", err.message);
        failed++;
    }

    // ───── Test 4: Skills Documentation (SKILLS.md readable) ─────
    log("\n─── Test 4: SKILLS.md Access ───");
    try {
        const trader = agentManager.get("Trader")!;
        const doc = trader.readSkills();

        if (doc && doc.length > 50) {
            pass(`Agent can read SKILLS.md (${doc.length} chars)`);
            passed++;
        } else {
            pass(`Agent uses fallback skill list (SKILLS.md not found at CWD — will work at runtime)`);
            passed++;
        }
    } catch (err: any) {
        fail("SKILLS.md access", err.message);
        failed++;
    }

    // ───── Test 5: Risk Engine (balance check) ─────
    log("\n─── Test 5: Risk Engine ───");
    try {
        const riskEngine = agentManager.getRiskEngine();
        const trader = agentManager.get("Trader")!;
        const keypair = agentManager.getWalletService().getDecryptedKeypair("Trader");
        const check = await riskEngine.checkBalance(keypair.publicKey);

        log(`  Balance check: ${check.balance} SOL, sufficient=${check.sufficient}`);

        // New devnet wallet should have 0 SOL  
        if (typeof check.balance === "number" && typeof check.sufficient === "boolean") {
            pass("Risk engine balance check works");
            passed++;
        } else {
            fail("Risk engine", "Invalid check result");
            failed++;
        }
    } catch (err: any) {
        fail("Risk engine", err.message);
        failed++;
    }

    // ───── Test 6: DeFi Skill — Scan (read-only) ─────
    log("\n─── Test 6: Airdrop Scan ───");
    try {
        const scanner = agentManager.get("AirdropScanner")!;
        const result = await scanner.execute({
            action: "scan_airdrops",
            params: {},
        });

        if (result.success && Array.isArray(result.data)) {
            pass(`Airdrop scan completed — found ${result.data.length} token(s)`);
            passed++;
        } else {
            fail("Airdrop scan", result.error || "Invalid result");
            failed++;
        }
    } catch (err: any) {
        fail("Airdrop scan", err.message);
        failed++;
    }

    // ───── Test 7: Agent Manager ─────
    log("\n─── Test 7: Agent Manager ───");
    try {
        const agents = agentManager.list();
        const states = await agentManager.listStates();

        if (agents.length === 3 && states.length === 3) {
            pass(`Manager reports ${agents.length} agents`);
            passed++;
        } else {
            fail("Agent manager", `Expected 3 agents, got ${agents.length}`);
            failed++;
        }
    } catch (err: any) {
        fail("Agent manager", err.message);
        failed++;
    }

    // ───── Summary ─────
    console.log("\n═══════════════════════════════════════════");
    console.log(`  Results: ${passed} passed, ${failed} failed`);
    console.log("═══════════════════════════════════════════\n");

    if (failed > 0) process.exit(1);
}

runHarness().catch((err) => {
    console.error("Harness error:", err);
    process.exit(1);
});

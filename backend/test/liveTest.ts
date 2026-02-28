/**
 * Live on-chain test script:
 * 1. Transfer SPL tokens from main wallet to Trader agent
 * 2. Create Scout agent + fund it
 * 3. Agent-to-agent SPL token transfer (Trader -> Scout)
 * 4. Schedule a cron job
 */
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
    createTransferInstruction,
    getOrCreateAssociatedTokenAccount,
    TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Transaction } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

const RPC = "https://api.devnet.solana.com";
const MINT = "AZEPqpuF6EiNMHx8k2USTXb1PpcSkLzszi399wrtp4so";
const API = "http://localhost:4000";

async function main() {
    const connection = new Connection(RPC, "confirmed");

    // Step 1: Load main wallet keypair
    const keyPath = path.join(process.cwd(), ".solana-key.json");
    const keyData = JSON.parse(fs.readFileSync(keyPath, "utf-8"));
    const mainWallet = Keypair.fromSecretKey(Uint8Array.from(keyData));
    console.log(`\n=== Main Wallet: ${mainWallet.publicKey.toBase58()} ===`);

    const mainBalance = await connection.getBalance(mainWallet.publicKey);
    console.log(`Main SOL Balance: ${mainBalance / LAMPORTS_PER_SOL}`);

    // Step 2: Get Trader's public key
    const agentsRes = await fetch(`${API}/api/agents`);
    const agentsData = await agentsRes.json() as any;
    const agents = Array.isArray(agentsData) ? agentsData : agentsData.value;
    const trader = agents.find((a: any) => a.id === "Trader");
    if (!trader) {
        console.log("ERROR: Trader agent not found");
        return;
    }
    console.log(`\nTrader PublicKey: ${trader.publicKey}`);
    const traderPubkey = new PublicKey(trader.publicKey);

    // Step 3: Transfer SPL tokens to Trader
    console.log(`\n=== Transferring 100 ${MINT.slice(0, 8)}... to Trader ===`);
    const mintPubkey = new PublicKey(MINT);

    // Get/create source ATA (main wallet)
    const sourceATA = await getOrCreateAssociatedTokenAccount(
        connection, mainWallet, mintPubkey, mainWallet.publicKey
    );
    console.log(`Source ATA: ${sourceATA.address.toBase58()}, Balance: ${sourceATA.amount.toString()}`);

    // Get/create destination ATA (Trader agent)
    const destATA = await getOrCreateAssociatedTokenAccount(
        connection, mainWallet, mintPubkey, traderPubkey
    );
    console.log(`Dest ATA:   ${destATA.address.toBase58()}`);

    // Transfer 100 tokens (with 9 decimals)
    const transferAmount = 100 * 1e9; // 100 tokens with 9 decimals
    const transferTx = new Transaction().add(
        createTransferInstruction(
            sourceATA.address,
            destATA.address,
            mainWallet.publicKey,
            transferAmount
        )
    );
    transferTx.feePayer = mainWallet.publicKey;
    const { blockhash } = await connection.getLatestBlockhash();
    transferTx.recentBlockhash = blockhash;
    transferTx.sign(mainWallet);
    const sig = await connection.sendRawTransaction(transferTx.serialize());
    await connection.confirmTransaction(sig, "confirmed");
    console.log(`✓ SPL Transfer to Trader: ${sig}`);

    // Verify
    const updatedATA = await connection.getTokenAccountBalance(destATA.address);
    console.log(`Trader Token Balance: ${updatedATA.value.uiAmountString}`);

    // Step 4: Ensure Agent2 exists and is funded
    let agent2 = agents.find((a: any) => a.id === "Agent2");
    if (!agent2) {
        console.log("\nCreating Agent2...");
        const createRes = await fetch(`${API}/api/agents`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: "Agent2" }),
        });
        agent2 = await createRes.json();
    }
    console.log(`\nAgent2 PublicKey: ${agent2.publicKey}`);

    // Airdrop 0.5 SOL to Agent2 for rent
    console.log("Funding Agent2 with 0.5 SOL...");
    try {
        const airdropSig = await connection.requestAirdrop(
            new PublicKey(agent2.publicKey), 0.5 * LAMPORTS_PER_SOL
        );
        await connection.confirmTransaction(airdropSig, "confirmed");
        console.log(`✓ Agent2 funded: ${airdropSig}`);
    } catch (e: any) {
        console.log(`Airdrop failed (rate limit?): ${e.message}. Trying SOL transfer instead...`);
        const fundTx = new Transaction().add({
            keys: [
                { pubkey: mainWallet.publicKey, isSigner: true, isWritable: true },
                { pubkey: new PublicKey(agent2.publicKey), isSigner: false, isWritable: true },
            ],
            programId: new PublicKey("11111111111111111111111111111111"),
            data: Buffer.alloc(12),
        });
        // Use system program transfer
        const { SystemProgram } = await import("@solana/web3.js");
        const fundTx2 = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: mainWallet.publicKey,
                toPubkey: new PublicKey(agent2.publicKey),
                lamports: 0.1 * LAMPORTS_PER_SOL,
            })
        );
        fundTx2.feePayer = mainWallet.publicKey;
        const bh2 = await connection.getLatestBlockhash();
        fundTx2.recentBlockhash = bh2.blockhash;
        fundTx2.sign(mainWallet);
        const fundSig = await connection.sendRawTransaction(fundTx2.serialize());
        await connection.confirmTransaction(fundSig, "confirmed");
        console.log(`✓ Agent2 funded via SOL transfer: ${fundSig}`);
    }

    // Step 5: Agent-to-agent SPL transfer via API
    console.log(`\n=== Agent-to-Agent SPL Transfer (Trader -> Agent2) ===`);
    const transferRes = await fetch(`${API}/api/agents/Trader/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            action: "transfer",
            params: {
                mint: MINT,
                to: agent2.publicKey,
                amount: "10",
            },
        }),
    });
    const transferResult = await transferRes.json();
    console.log("Transfer Result:", JSON.stringify(transferResult, null, 2));

    // Step 6: Test cron job scheduling
    console.log(`\n=== Scheduling Cron Job ===`);
    const cronRes = await fetch(`${API}/api/cron/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            name: "scan-airdrops-test",
            pattern: "*/5 * * * *",  // every 5 minutes
            agentId: "Trader",
            action: "scan_airdrops",
        }),
    });
    const cronResult = await cronRes.json();
    console.log("Cron Schedule Result:", JSON.stringify(cronResult, null, 2));

    // List scheduled jobs
    const listRes = await fetch(`${API}/api/cron/jobs`);
    const jobs = await listRes.json();
    console.log("Scheduled Jobs:", JSON.stringify(jobs, null, 2));

    console.log("\n=== ALL LIVE TESTS COMPLETE ===");
}

main().catch(console.error);

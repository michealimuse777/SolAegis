import { Keypair, Connection, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { encrypt, decrypt } from "./encryption.js";
import * as fs from "fs";
import * as path from "path";

const WALLET_FILE = path.join(process.cwd(), ".wallets.json");

// Load persisted wallets from disk, or start fresh
function loadWalletDB(): Map<string, string> {
    try {
        if (fs.existsSync(WALLET_FILE)) {
            const data = JSON.parse(fs.readFileSync(WALLET_FILE, "utf-8"));
            console.log(`[WalletService] Loaded ${Object.keys(data).length} wallet(s) from disk`);
            return new Map(Object.entries(data));
        }
    } catch (err: any) {
        console.warn("[WalletService] Failed to load wallets from disk:", err.message);
    }
    return new Map();
}

// Save wallets to disk
function saveWalletDB(db: Map<string, string>): void {
    try {
        const obj = Object.fromEntries(db);
        fs.writeFileSync(WALLET_FILE, JSON.stringify(obj, null, 2), "utf-8");
    } catch (err: any) {
        console.error("[WalletService] Failed to save wallets to disk:", err.message);
    }
}

const walletDB = loadWalletDB();

export class WalletService {
    constructor(private connection: Connection) { }

    /**
     * Creates a new wallet for an agent, encrypts the secret key, and stores it.
     * Persists to disk so wallets survive restarts.
     * Returns the public key as a base58 string.
     */
    createWallet(agentId: string): string {
        // If wallet already exists on disk, return existing public key
        if (walletDB.has(agentId)) {
            console.log(`[WalletService] Wallet for "${agentId}" already exists, reusing`);
            const keypair = this.getDecryptedKeypair(agentId);
            return keypair.publicKey.toBase58();
        }

        const keypair = Keypair.generate();
        const secretBase64 = Buffer.from(keypair.secretKey).toString("base64");
        const encryptedSecret = encrypt(secretBase64);
        walletDB.set(agentId, encryptedSecret);
        saveWalletDB(walletDB);
        return keypair.publicKey.toBase58();
    }

    /**
     * Retrieves and decrypts the keypair for a given agent.
     */
    getDecryptedKeypair(agentId: string): Keypair {
        const encryptedSecret = walletDB.get(agentId);
        if (!encryptedSecret) {
            throw new Error(`No wallet found for agent: ${agentId}`);
        }
        const secretBase64 = decrypt(encryptedSecret);
        const secretKey = Uint8Array.from(Buffer.from(secretBase64, "base64"));
        return Keypair.fromSecretKey(secretKey);
    }

    /**
     * Returns the public key string for an agent.
     */
    getPublicKey(agentId: string): string {
        const keypair = this.getDecryptedKeypair(agentId);
        return keypair.publicKey.toBase58();
    }

    /**
     * Gets the SOL balance for an agent's wallet.
     */
    async getBalance(agentId: string): Promise<number> {
        const keypair = this.getDecryptedKeypair(agentId);
        const balance = await this.connection.getBalance(keypair.publicKey);
        return balance;
    }

    /**
     * Signs and sends a transaction using the agent's keypair.
     */
    async signAndSend(tx: Transaction, keypair: Keypair): Promise<string> {
        tx.feePayer = keypair.publicKey;
        const { blockhash } = await this.connection.getLatestBlockhash();
        tx.recentBlockhash = blockhash;
        tx.sign(keypair);
        const signature = await this.connection.sendRawTransaction(tx.serialize(), {
            skipPreflight: false,
            preflightCommitment: "confirmed",
        });
        return signature;
    }

    /**
     * Checks if an agent has a wallet.
     */
    hasWallet(agentId: string): boolean {
        return walletDB.has(agentId);
    }

    /**
     * Lists all agent IDs with wallets.
     */
    listAgentIds(): string[] {
        return Array.from(walletDB.keys());
    }

    /**
     * Removes a wallet (also removes from disk).
     */
    removeWallet(agentId: string): boolean {
        const removed = walletDB.delete(agentId);
        if (removed) saveWalletDB(walletDB);
        return removed;
    }
}

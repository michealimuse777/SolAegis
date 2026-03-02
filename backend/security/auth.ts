/**
 * JWT Authentication — Production-Hardened
 * 
 * Auth Methods:
 * 1. Password-based: username + password → JWT (kept for compatibility)
 * 2. Wallet signature: wallet → nonce → signature verification → JWT (preferred for Solana)
 * 
 * Security Features:
 * - Persistent user store (data/users.enc — encrypted at rest with AES-256-GCM)
 * - Stable JWT secret (persisted to data/.jwt_secret)
 * - Salted password hashing (HMAC-SHA256 + per-user salt)
 * - Password strength enforcement (min 8 chars, 1 number, 1 letter)
 * - Wallet nonce-based auth (prevents replay attacks)
 * - User-agent ownership with persistence
 */
import jwt from "jsonwebtoken";
import crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { Request, Response, NextFunction } from "express";
import nacl from "tweetnacl";
import bs58 from "bs58";

// ─────────── Paths ───────────

const DATA_DIR = path.resolve(process.cwd(), "data");
const USERS_FILE = path.join(DATA_DIR, "users.enc");          // Encrypted at rest
const USERS_FILE_LEGACY = path.join(DATA_DIR, "users.json");  // Legacy unencrypted
const JWT_SECRET_FILE = path.join(DATA_DIR, ".jwt_secret");
const TOKEN_EXPIRY = "24h";

// Ensure data dir exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ─────────── File Encryption (AES-256-GCM) ───────────

function getFileEncryptionKey(): Buffer {
    // Derive a file encryption key from JWT secret (deterministic)
    const secret = getJwtSecret();
    return crypto.createHash("sha256").update(secret + ":users-file-key").digest();
}

function encryptFile(data: string): string {
    const key = getFileEncryptionKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
    let enc = cipher.update(data, "utf8");
    enc = Buffer.concat([enc, cipher.final()]);
    const tag = cipher.getAuthTag();
    return iv.toString("hex") + ":" + tag.toString("hex") + ":" + enc.toString("hex");
}

function decryptFile(encrypted: string): string {
    const parts = encrypted.split(":");
    if (parts.length !== 3) throw new Error("Invalid encrypted file format");
    const key = getFileEncryptionKey();
    const iv = Buffer.from(parts[0], "hex");
    const tag = Buffer.from(parts[1], "hex");
    const data = Buffer.from(parts[2], "hex");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
    decipher.setAuthTag(tag);
    let dec = decipher.update(data);
    dec = Buffer.concat([dec, decipher.final()]);
    return dec.toString("utf8");
}

// ─────────── Stable JWT Secret ───────────

function getJwtSecret(): string {
    if (process.env.JWT_SECRET) return process.env.JWT_SECRET;

    try {
        if (fs.existsSync(JWT_SECRET_FILE)) {
            const secret = fs.readFileSync(JWT_SECRET_FILE, "utf-8").trim();
            if (secret.length >= 32) return secret;
        }
    } catch { }

    const secret = crypto.randomBytes(64).toString("hex");
    fs.writeFileSync(JWT_SECRET_FILE, secret, { mode: 0o600 });
    console.log("[Auth] Generated new JWT secret (persisted to data/.jwt_secret)");
    return secret;
}

const JWT_SECRET = getJwtSecret();

// ─────────── User Store (persistent + encrypted) ───────────

interface UserRecord {
    userId: string;
    passwordHash?: string;
    salt?: string;
    walletAddress?: string;    // Solana public key (base58)
    agents: string[];
    createdAt: number;
    lastLogin?: number;
}

function loadUsers(): Map<string, UserRecord> {
    // Try encrypted file first
    try {
        if (fs.existsSync(USERS_FILE)) {
            const encrypted = fs.readFileSync(USERS_FILE, "utf-8");
            const data = JSON.parse(decryptFile(encrypted));
            console.log(`[Auth] Loaded ${Object.keys(data).length} user(s) from encrypted store`);
            return new Map(Object.entries(data));
        }
    } catch (err: any) {
        console.warn("[Auth] Failed to load encrypted users:", err.message);
    }

    // Try legacy unencrypted file (migrate on next save)
    try {
        if (fs.existsSync(USERS_FILE_LEGACY)) {
            const data = JSON.parse(fs.readFileSync(USERS_FILE_LEGACY, "utf-8"));
            console.log(`[Auth] Migrating ${Object.keys(data).length} user(s) from legacy unencrypted store`);
            const map = new Map<string, UserRecord>(Object.entries(data));
            // Will be saved encrypted on next write
            return map;
        }
    } catch (err: any) {
        console.warn("[Auth] Failed to load legacy users:", err.message);
    }

    return new Map();
}

function saveUsers(): void {
    try {
        const obj = Object.fromEntries(users);
        const encrypted = encryptFile(JSON.stringify(obj));
        fs.writeFileSync(USERS_FILE, encrypted, "utf-8");
        // Remove legacy file if it exists
        if (fs.existsSync(USERS_FILE_LEGACY)) {
            fs.unlinkSync(USERS_FILE_LEGACY);
            console.log("[Auth] Removed legacy unencrypted users.json");
        }
    } catch (err: any) {
        console.error("[Auth] Failed to save users:", err.message);
    }
}

const users = loadUsers();
// Save immediately to encrypt any migrated data
if (users.size > 0) saveUsers();

// ─────────── Nonce Store (for wallet auth) ───────────

const nonceStore = new Map<string, { nonce: string; expiresAt: number }>();
const NONCE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

function cleanExpiredNonces(): void {
    const now = Date.now();
    for (const [key, val] of nonceStore) {
        if (val.expiresAt < now) nonceStore.delete(key);
    }
}

// ─────────── Password Helpers ───────────

function generateSalt(): string {
    return crypto.randomBytes(16).toString("hex");
}

function hashPassword(password: string, salt: string): string {
    return crypto.createHmac("sha256", salt).update(password).digest("hex");
}

function validatePasswordStrength(password: string): string | null {
    if (password.length < 8) return "Password must be at least 8 characters";
    if (!/[a-zA-Z]/.test(password)) return "Password must contain at least one letter";
    if (!/[0-9]/.test(password)) return "Password must contain at least one number";
    if (/\s/.test(password)) return "Password must not contain spaces";
    return null;
}

function validateUserId(userId: string): string | null {
    if (userId.length < 3) return "Username must be at least 3 characters";
    if (userId.length > 24) return "Username must be at most 24 characters";
    if (!/^[a-zA-Z0-9_-]+$/.test(userId)) return "Username can only contain letters, numbers, hyphens, and underscores";
    return null;
}

// ─────────── Password Auth ───────────

export function registerUser(userId: string, password: string): { token: string } {
    const userError = validateUserId(userId);
    if (userError) throw new Error(userError);
    const passError = validatePasswordStrength(password);
    if (passError) throw new Error(passError);
    if (users.has(userId)) throw new Error("User already exists");

    const salt = generateSalt();
    const record: UserRecord = {
        userId,
        passwordHash: hashPassword(password, salt),
        salt,
        agents: [],
        createdAt: Date.now(),
    };
    users.set(userId, record);
    saveUsers();
    console.log(`[Auth] User registered: ${userId}`);

    const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
    return { token };
}

export function loginUser(userId: string, password: string): { token: string } {
    const record = users.get(userId);
    if (!record || !record.passwordHash || !record.salt) {
        hashPassword(password, "dummy-salt-timing-safe");
        throw new Error("Invalid credentials");
    }
    if (record.passwordHash !== hashPassword(password, record.salt)) {
        throw new Error("Invalid credentials");
    }

    record.lastLogin = Date.now();
    saveUsers();

    const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
    console.log(`[Auth] User logged in: ${userId}`);
    return { token };
}

// ─────────── Wallet Signature Auth ───────────

/**
 * Step 1: Request a nonce for a wallet address.
 * Returns a unique nonce the user must sign with their wallet.
 */
export function requestWalletNonce(walletAddress: string): { nonce: string; message: string } {
    cleanExpiredNonces();

    const nonce = crypto.randomBytes(32).toString("hex");
    nonceStore.set(walletAddress, {
        nonce,
        expiresAt: Date.now() + NONCE_EXPIRY_MS,
    });

    const message = `SolAegis authentication\nWallet: ${walletAddress}\nNonce: ${nonce}\nTimestamp: ${Date.now()}`;

    console.log(`[Auth] Nonce issued for wallet: ${walletAddress.substring(0, 8)}...`);
    return { nonce, message };
}

/**
 * Step 2: Verify wallet signature and issue JWT.
 * The user signs the nonce message with their Solana wallet.
 */
export function verifyWalletSignature(
    walletAddress: string,
    signature: string,
    message: string,
): { token: string; userId: string } {
    // Check nonce exists and hasn't expired
    const stored = nonceStore.get(walletAddress);
    if (!stored) {
        throw new Error("No pending nonce for this wallet. Request a new one via /api/auth/wallet/nonce.");
    }
    if (stored.expiresAt < Date.now()) {
        nonceStore.delete(walletAddress);
        throw new Error("Nonce expired. Request a new one.");
    }

    // Verify the nonce is embedded in the message
    if (!message.includes(stored.nonce)) {
        throw new Error("Message does not contain the expected nonce.");
    }

    // Verify Ed25519 signature
    try {
        const publicKey = bs58.decode(walletAddress);
        const messageBytes = new TextEncoder().encode(message);
        const signatureBytes = bs58.decode(signature);

        const valid = nacl.sign.detached.verify(messageBytes, signatureBytes, publicKey);
        if (!valid) {
            throw new Error("Invalid signature");
        }
    } catch (err: any) {
        if (err.message === "Invalid signature") throw err;
        throw new Error(`Signature verification failed: ${err.message}`);
    }

    // Consume the nonce (one-time use)
    nonceStore.delete(walletAddress);

    // Create or update user record linked to wallet
    const userId = `wallet:${walletAddress}`;
    if (!users.has(userId)) {
        users.set(userId, {
            userId,
            walletAddress,
            agents: [],
            createdAt: Date.now(),
        });
        console.log(`[Auth] Wallet user created: ${walletAddress.substring(0, 8)}...`);
    }

    const record = users.get(userId)!;
    record.lastLogin = Date.now();
    saveUsers();

    const token = jwt.sign({ userId, walletAddress }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
    console.log(`[Auth] Wallet login: ${walletAddress.substring(0, 8)}...`);
    return { token, userId };
}

// ─────────── Agent Ownership ───────────

export function assignAgentToUser(userId: string, agentId: string): void {
    const record = users.get(userId);
    if (record && !record.agents.includes(agentId)) {
        record.agents.push(agentId);
        saveUsers();
    }
}

export function userOwnsAgent(userId: string, agentId: string): boolean {
    const record = users.get(userId);
    if (!record) return false;
    return record.agents.includes(agentId);
}

export function getUserAgents(userId: string): string[] {
    return users.get(userId)?.agents || [];
}

// ─────────── Express Middleware ───────────

export interface AuthenticatedRequest extends Request {
    userId?: string;
    walletAddress?: string;
}

export function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
    if (req.path.startsWith("/api/auth") || req.path === "/api/health") {
        return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        res.status(401).json({ error: "Authentication required. Use POST /api/auth/register, /api/auth/login, or /api/auth/wallet/nonce to authenticate." });
        return;
    }

    const token = authHeader.split(" ")[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; walletAddress?: string };
        req.userId = decoded.userId;
        req.walletAddress = decoded.walletAddress;
        next();
    } catch (err: any) {
        res.status(401).json({ error: "Invalid or expired token. Please login again." });
    }
}

export function agentOwnershipMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
    const agentId = req.params.id;
    const userId = req.userId;

    if (!agentId || !userId) {
        return next();
    }

    if (!userOwnsAgent(userId, agentId)) {
        res.status(403).json({ error: `You don't have access to agent "${agentId}". You can only manage your own agents.` });
        return;
    }

    next();
}

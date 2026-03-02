/**
 * Rate Limiter — Express middleware.
 * - 10 chat requests per 30 seconds per user
 * - 20 tx attempts per hour per agent
 * In-memory sliding window. No external dependencies.
 */
import { Request, Response, NextFunction } from "express";
import { AuthenticatedRequest } from "./auth.js";

// ─────────── Sliding Window Store ───────────

interface RateWindow {
    timestamps: number[];
}

const chatLimits = new Map<string, RateWindow>();
const txLimits = new Map<string, RateWindow>();

function cleanWindow(window: RateWindow, windowMs: number): void {
    const cutoff = Date.now() - windowMs;
    window.timestamps = window.timestamps.filter(t => t > cutoff);
}

function checkLimit(store: Map<string, RateWindow>, key: string, maxRequests: number, windowMs: number): { allowed: boolean; remaining: number; retryAfterMs: number } {
    if (!store.has(key)) {
        store.set(key, { timestamps: [] });
    }

    const window = store.get(key)!;
    cleanWindow(window, windowMs);

    if (window.timestamps.length >= maxRequests) {
        const oldestInWindow = window.timestamps[0];
        const retryAfterMs = (oldestInWindow + windowMs) - Date.now();
        return { allowed: false, remaining: 0, retryAfterMs: Math.max(0, retryAfterMs) };
    }

    window.timestamps.push(Date.now());
    return { allowed: true, remaining: maxRequests - window.timestamps.length, retryAfterMs: 0 };
}

// ─────────── Middleware ───────────

/**
 * Chat rate limiter: 10 requests per 30 seconds per user.
 */
export function chatRateLimiter(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
    const key = req.userId || req.ip || "anonymous";
    const result = checkLimit(chatLimits, key, 10, 30_000);

    res.setHeader("X-RateLimit-Limit", "10");
    res.setHeader("X-RateLimit-Remaining", String(result.remaining));

    if (!result.allowed) {
        const retrySeconds = Math.ceil(result.retryAfterMs / 1000);
        res.setHeader("Retry-After", String(retrySeconds));
        res.status(429).json({
            error: "Rate limit exceeded. Max 10 chat requests per 30 seconds.",
            retryAfterSeconds: retrySeconds,
        });
        return;
    }
    next();
}

/**
 * Transaction rate limiter: 20 attempts per hour per agent.
 */
export function txRateLimiter(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
    const agentId = req.params.id || "unknown";
    const result = checkLimit(txLimits, agentId, 20, 3_600_000);

    res.setHeader("X-RateLimit-Limit", "20");
    res.setHeader("X-RateLimit-Remaining", String(result.remaining));

    if (!result.allowed) {
        const retrySeconds = Math.ceil(result.retryAfterMs / 1000);
        res.setHeader("Retry-After", String(retrySeconds));
        res.status(429).json({
            error: `Rate limit exceeded for agent "${agentId}". Max 20 transaction attempts per hour.`,
            retryAfterSeconds: retrySeconds,
        });
        return;
    }
    next();
}

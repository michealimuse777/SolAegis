/**
 * Scheduler Guardrails — Prevent abuse of cron scheduling system.
 * 
 * Enforces:
 * - Max 5 active jobs per user
 * - Min interval of 5 minutes between executions
 * - Max job lifetime of 7 days
 * - No recursive scheduling (jobs can't schedule other jobs)
 */
import { AuthenticatedRequest } from "./auth.js";
import { Request, Response, NextFunction } from "express";

// ─────────── Constants ───────────

const MAX_JOBS_PER_USER = 5;
const MIN_INTERVAL_MS = 5 * 60 * 1000;   // 5 minutes
const MAX_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;  // 7 days

// Known cron-unsafe patterns (runs too frequently)
const UNSAFE_CRON_PATTERNS = [
    /^\*\s/,           // Every minute: "* * * * *"
    /^\*\/[1-4]\s/,    // Every 1-4 minutes: "*/1", "*/2", "*/3", "*/4"
];

// Track active jobs per user
const userJobCounts = new Map<string, Set<string>>();

// ─────────── Helpers ───────────

/**
 * Parse cron pattern to estimate interval in ms.
 * Only checks minute field for simplicity.
 */
function estimateCronIntervalMs(pattern: string): number {
    const parts = pattern.trim().split(/\s+/);
    if (parts.length < 5) return 0;

    const minutePart = parts[0];

    // Every N minutes: */N
    const everyMatch = minutePart.match(/^\*\/(\d+)$/);
    if (everyMatch) {
        return parseInt(everyMatch[1]) * 60 * 1000;
    }

    // Every minute: *
    if (minutePart === "*") {
        return 60 * 1000; // 1 minute
    }

    // Fixed minute(s): 0,30 → every 30 min (rough estimate)
    const fixedMinutes = minutePart.split(",").map(Number).filter(n => !isNaN(n));
    if (fixedMinutes.length > 1) {
        fixedMinutes.sort((a, b) => a - b);
        const gaps = [];
        for (let i = 1; i < fixedMinutes.length; i++) {
            gaps.push(fixedMinutes[i] - fixedMinutes[i - 1]);
        }
        const minGap = Math.min(...gaps);
        return minGap * 60 * 1000;
    }

    // Hourly or less frequent
    return 60 * 60 * 1000;
}

// ─────────── Validation ───────────

export interface SchedulerValidation {
    valid: boolean;
    error?: string;
}

/**
 * Validate a cron job request against guardrails.
 */
export function validateCronJob(
    userId: string,
    jobName: string,
    pattern: string,
    _agentId: string,
): SchedulerValidation {
    // 1. Check max jobs per user
    const userJobs = userJobCounts.get(userId) || new Set();
    if (userJobs.size >= MAX_JOBS_PER_USER) {
        return {
            valid: false,
            error: `Maximum ${MAX_JOBS_PER_USER} scheduled jobs per user. Remove an existing job before creating a new one.`,
        };
    }

    // 2. Check for unsafe cron patterns
    for (const unsafePattern of UNSAFE_CRON_PATTERNS) {
        if (unsafePattern.test(pattern)) {
            return {
                valid: false,
                error: `Cron pattern "${pattern}" runs too frequently. Minimum interval is 5 minutes (use */5 or higher).`,
            };
        }
    }

    // 3. Check estimated interval
    const intervalMs = estimateCronIntervalMs(pattern);
    if (intervalMs > 0 && intervalMs < MIN_INTERVAL_MS) {
        return {
            valid: false,
            error: `Cron interval (~${Math.round(intervalMs / 1000)}s) is below the minimum of 5 minutes. Use */5 or higher.`,
        };
    }

    // 4. Check for recursive scheduling patterns in job name
    if (/schedule|cron|create_job|add_job/i.test(jobName)) {
        return {
            valid: false,
            error: "Recursive scheduling is not allowed. Jobs cannot schedule other jobs.",
        };
    }

    return { valid: true };
}

/**
 * Register a job for a user (call after successful creation).
 */
export function registerUserJob(userId: string, jobName: string): void {
    if (!userJobCounts.has(userId)) {
        userJobCounts.set(userId, new Set());
    }
    userJobCounts.get(userId)!.add(jobName);
}

/**
 * Unregister a job for a user (call after deletion).
 */
export function unregisterUserJob(userId: string, jobName: string): void {
    userJobCounts.get(userId)?.delete(jobName);
}

/**
 * Get job count for a user.
 */
export function getUserJobCount(userId: string): number {
    return userJobCounts.get(userId)?.size || 0;
}

/**
 * Calculate expiry date (7 days from now).
 */
export function getJobExpiryDate(): Date {
    return new Date(Date.now() + MAX_LIFETIME_MS);
}

/**
 * Express middleware for scheduler routes — validates job creation requests.
 */
export function schedulerGuardrailMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
    const userId = req.userId || "anonymous";
    const { name, pattern, agentId } = req.body || {};

    if (!name || !pattern) {
        return next(); // Let the route handler deal with missing fields
    }

    const validation = validateCronJob(userId, name, pattern, agentId || "");

    if (!validation.valid) {
        res.status(400).json({
            error: "Scheduler guardrail violation",
            detail: validation.error,
        });
        return;
    }

    next();
}

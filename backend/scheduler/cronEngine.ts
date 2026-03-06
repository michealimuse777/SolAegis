import { Queue, Worker } from "bullmq";

let redisConnection: any = null;
let agentQueue: Queue | null = null;

export interface CronJobData {
    agentId: string;
    action: string;
    params: Record<string, any>;
}

// ─────────── In-Process Fallback Scheduler ───────────
// When Redis is unavailable, jobs run via setInterval / setTimeout
// so scheduled tasks still execute on Railway / any host without Redis.

interface InProcessJob {
    name: string;
    data: CronJobData;
    cronExpression?: string;
    intervalMs?: number;
    timer: ReturnType<typeof setInterval> | ReturnType<typeof setTimeout>;
    type: "repeating" | "delayed";
}

const inProcessJobs = new Map<string, InProcessJob>();
let _processor: ((data: CronJobData) => Promise<void>) | null = null;
let _useInProcess = false;

/**
 * Convert a cron expression to milliseconds for setInterval.
 * Supports standard patterns used in SolAegis.
 */
function cronToMs(cron: string): number {
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5) return 600_000; // fallback: 10 min

    const [min, hour, _dom, _mon, dow] = parts;

    // "* * * * *" → every minute
    if (min === "*" && hour === "*") return 60_000;

    // "*/N * * * *" → every N minutes
    const minMatch = min.match(/^\*\/(\d+)$/);
    if (minMatch && hour === "*") return parseInt(minMatch[1]) * 60_000;

    // "0 */N * * *" → every N hours
    const hourMatch = hour.match(/^\*\/(\d+)$/);
    if (min === "0" && hourMatch) return parseInt(hourMatch[1]) * 3_600_000;

    // "0 * * * *" → every hour
    if (min === "0" && hour === "*") return 3_600_000;

    // "0 0 * * *" → every day
    if (min === "0" && hour === "0" && dow === "*") return 86_400_000;

    // "0 0 * * 0" → every week
    if (min === "0" && hour === "0" && dow === "0") return 604_800_000;

    // Fallback: 10 minutes
    return 600_000;
}

/**
 * Initializes the BullMQ cron engine.
 * Gracefully degrades if Redis is unavailable — uses in-process scheduler.
 * Uses dynamic import of ioredis to avoid version conflicts with BullMQ's bundled copy.
 */
export async function initScheduler(
    redisUrl: string = "redis://localhost:6379"
): Promise<boolean> {
    try {
        const ioredisModule: any = await import("ioredis");
        const RedisClient = ioredisModule.Redis || ioredisModule.default;
        redisConnection = new RedisClient(redisUrl, {
            maxRetriesPerRequest: null,
            lazyConnect: true,
            retryStrategy: () => null,  // Do not retry — fail fast
            connectTimeout: 3000,
        });

        // Suppress unhandled error events (we handle via try/catch)
        redisConnection.on("error", () => { });

        await redisConnection.connect();
        console.log("[CronEngine] Redis connected");

        agentQueue = new Queue("solaegis-agent-jobs", {
            connection: redisConnection,
        });

        _useInProcess = false;
        return true;
    } catch (err: any) {
        console.warn(
            "[CronEngine] Redis unavailable (" + err.message + ") — using in-process scheduler"
        );
        // Clean up the failed connection
        if (redisConnection) {
            try { redisConnection.disconnect(); } catch { }
        }
        redisConnection = null;
        agentQueue = null;
        _useInProcess = true;
        return false;
    }
}

/**
 * Schedule a repeating cron job for an agent.
 * Falls back to setInterval when Redis is unavailable.
 */
export async function scheduleCronJob(
    jobName: string,
    data: CronJobData,
    cronExpression: string = "*/10 * * * *"
): Promise<string | null> {
    // ─── In-process fallback ───
    if (_useInProcess || !agentQueue) {
        if (!_processor) {
            console.warn("[CronEngine] No processor registered — skipping in-process job");
            return null;
        }

        // Remove existing job with same name if any
        const existing = inProcessJobs.get(jobName);
        if (existing) {
            clearInterval(existing.timer as any);
            inProcessJobs.delete(jobName);
        }

        const intervalMs = cronToMs(cronExpression);
        console.log(`[CronEngine:InProcess] Scheduling ${jobName} every ${intervalMs / 1000}s (${cronExpression})`);

        const timer = setInterval(async () => {
            const startTime = Date.now();
            console.log(`[CronEngine:InProcess] Executing ${jobName} for agent ${data.agentId}`);
            try {
                // 30s timeout
                const timeout = new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error("Job timed out after 30s")), 30_000)
                );
                await Promise.race([_processor!(data), timeout]);
                console.log(`[CronEngine:InProcess] ✅ ${jobName} completed in ${Date.now() - startTime}ms`);
            } catch (err: any) {
                console.error(`[CronEngine:InProcess] ❌ ${jobName} failed: ${err.message}`);
            }
        }, intervalMs);

        const jobId = `inproc-${Date.now()}-${jobName}`;
        inProcessJobs.set(jobName, {
            name: jobName,
            data,
            cronExpression,
            intervalMs,
            timer,
            type: "repeating",
        });

        return jobId;
    }

    // ─── Redis / BullMQ ───
    const job = await agentQueue.add(jobName, data, {
        repeat: { pattern: cronExpression },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
    });

    console.log(
        "[CronEngine] Scheduled " + jobName + " for agent " + data.agentId + " (" + cronExpression + ")"
    );
    return job.id ?? null;
}

/**
 * Schedule a ONE-SHOT delayed job for an agent.
 * Falls back to setTimeout when Redis is unavailable.
 */
export async function scheduleDelayedJob(
    jobName: string,
    data: CronJobData,
    delayMs: number,
): Promise<string | null> {
    // ─── In-process fallback ───
    if (_useInProcess || !agentQueue) {
        if (!_processor) {
            console.warn("[CronEngine] No processor registered — skipping in-process delayed job");
            return null;
        }

        const delayMins = Math.round(delayMs / 60000);
        console.log(`[CronEngine:InProcess] Delayed job ${jobName} for agent ${data.agentId} (in ${delayMins} min)`);

        const timer = setTimeout(async () => {
            const startTime = Date.now();
            console.log(`[CronEngine:InProcess] Executing delayed job ${jobName} for agent ${data.agentId}`);
            try {
                const timeout = new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error("Job timed out after 30s")), 30_000)
                );
                await Promise.race([_processor!(data), timeout]);
                console.log(`[CronEngine:InProcess] ✅ ${jobName} completed in ${Date.now() - startTime}ms`);
            } catch (err: any) {
                console.error(`[CronEngine:InProcess] ❌ ${jobName} failed: ${err.message}`);
            }
            // Clean up after one-shot
            inProcessJobs.delete(jobName);
        }, delayMs);

        const jobId = `inproc-delay-${Date.now()}-${jobName}`;
        inProcessJobs.set(jobName, {
            name: jobName,
            data,
            intervalMs: delayMs,
            timer,
            type: "delayed",
        });

        return jobId;
    }

    // ─── Redis / BullMQ ───
    const job = await agentQueue.add(jobName, data, {
        delay: delayMs,
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
    });

    const delayMins = Math.round(delayMs / 60000);
    console.log(
        "[CronEngine] Delayed job " + jobName + " for agent " + data.agentId + " (in " + delayMins + " min)"
    );
    return job.id ?? null;
}

/**
 * Create a worker that processes scheduled jobs with retry and timeout.
 * Also stores the processor for in-process fallback use.
 */
export function createWorker(
    processor: (data: CronJobData) => Promise<void>
): Worker | null {
    // Always store the processor for in-process fallback
    _processor = processor;

    if (!redisConnection) {
        console.log("[CronEngine] In-process mode — processor registered for fallback scheduler");
        return null;
    }

    const worker = new Worker(
        "solaegis-agent-jobs",
        async (job) => {
            const startTime = Date.now();
            console.log(`[CronEngine] Processing job ${job.name} for agent ${job.data.agentId} (attempt ${job.attemptsMade + 1})`);

            // Wrap in a timeout
            const timeout = new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error("Job timed out after 30s")), 30_000)
            );

            try {
                await Promise.race([
                    processor(job.data as CronJobData),
                    timeout,
                ]);
                const elapsed = Date.now() - startTime;
                console.log(`[CronEngine] Job ${job.name} completed in ${elapsed}ms`);
            } catch (err: any) {
                const elapsed = Date.now() - startTime;
                console.error(`[CronEngine] Job ${job.name} failed after ${elapsed}ms: ${err.message}`);
                throw err; // BullMQ will retry based on config
            }
        },
        {
            connection: redisConnection,
            concurrency: 3,
            limiter: { max: 5, duration: 60_000 }, // Max 5 jobs per minute
        }
    );

    worker.on("completed", (job) => {
        console.log(`[CronEngine] ✅ Job ${job.id} completed`);
    });

    worker.on("failed", (job, err) => {
        console.error(`[CronEngine] ❌ Job ${job?.id ?? "unknown"} failed (attempt ${job?.attemptsMade ?? "?"}): ${err.message}`);
    });

    return worker;
}

/**
 * List all repeatable jobs (BullMQ + in-process).
 */
export async function listScheduledJobs(): Promise<any[]> {
    // In-process jobs
    if (_useInProcess || !agentQueue) {
        return Array.from(inProcessJobs.values()).map(j => ({
            name: j.name,
            pattern: j.cronExpression || "",
            cron: j.cronExpression || "",
            every: j.intervalMs ? `${j.intervalMs}ms` : undefined,
            type: j.type,
            agentId: j.data.agentId,
            action: j.data.action,
        }));
    }
    return await agentQueue.getRepeatableJobs();
}

/**
 * Remove a repeatable job (BullMQ + in-process).
 */
export async function removeScheduledJob(
    jobName: string,
    cronExpression: string
): Promise<boolean> {
    // In-process jobs
    if (_useInProcess || !agentQueue) {
        const job = inProcessJobs.get(jobName);
        if (job) {
            if (job.type === "repeating") {
                clearInterval(job.timer as any);
            } else {
                clearTimeout(job.timer as any);
            }
            inProcessJobs.delete(jobName);
            console.log(`[CronEngine:InProcess] Removed job ${jobName}`);
            return true;
        }
        return false;
    }
    return await agentQueue.removeRepeatable(jobName, {
        pattern: cronExpression,
    });
}

/**
 * Gracefully shutdown the scheduler.
 */
export async function shutdownScheduler(): Promise<void> {
    // Clear all in-process timers
    for (const [name, job] of inProcessJobs) {
        if (job.type === "repeating") {
            clearInterval(job.timer as any);
        } else {
            clearTimeout(job.timer as any);
        }
    }
    inProcessJobs.clear();

    if (agentQueue) await agentQueue.close();
    if (redisConnection) await redisConnection.quit();
    console.log("[CronEngine] Scheduler shut down");
}

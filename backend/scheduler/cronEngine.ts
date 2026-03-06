import { Queue, Worker } from "bullmq";

let redisConnection: any = null;
let agentQueue: Queue | null = null;

export interface CronJobData {
    agentId: string;
    action: string;
    params: Record<string, any>;
}

/**
 * Initializes the BullMQ cron engine.
 * Gracefully degrades if Redis is unavailable.
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

        return true;
    } catch (err: any) {
        console.warn(
            "[CronEngine] Redis unavailable (" + err.message + ") — scheduler disabled"
        );
        // Clean up the failed connection
        if (redisConnection) {
            try { redisConnection.disconnect(); } catch { }
        }
        redisConnection = null;
        agentQueue = null;
        return false;
    }
}

/**
 * Schedule a repeating cron job for an agent.
 */
export async function scheduleCronJob(
    jobName: string,
    data: CronJobData,
    cronExpression: string = "*/10 * * * *"
): Promise<string | null> {
    if (!agentQueue) {
        console.warn("[CronEngine] Scheduler not initialized — skipping job");
        return null;
    }

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
 * e.g. "transfer 0.1 SOL in 6 hours" → delay = 6 * 60 * 60 * 1000
 */
export async function scheduleDelayedJob(
    jobName: string,
    data: CronJobData,
    delayMs: number,
): Promise<string | null> {
    if (!agentQueue) {
        console.warn("[CronEngine] Scheduler not initialized — skipping job");
        return null;
    }

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
 */
export function createWorker(
    processor: (data: CronJobData) => Promise<void>
): Worker | null {
    if (!redisConnection) {
        console.warn("[CronEngine] No Redis — worker not created");
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
 * List all repeatable jobs.
 */
export async function listScheduledJobs(): Promise<any[]> {
    if (!agentQueue) return [];
    return await agentQueue.getRepeatableJobs();
}

/**
 * Remove a repeatable job.
 */
export async function removeScheduledJob(
    jobName: string,
    cronExpression: string
): Promise<boolean> {
    if (!agentQueue) return false;
    return await agentQueue.removeRepeatable(jobName, {
        pattern: cronExpression,
    });
}

/**
 * Gracefully shutdown the scheduler.
 */
export async function shutdownScheduler(): Promise<void> {
    if (agentQueue) await agentQueue.close();
    if (redisConnection) await redisConnection.quit();
    console.log("[CronEngine] Scheduler shut down");
}

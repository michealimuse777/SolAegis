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
    });

    console.log(
        "[CronEngine] Scheduled " + jobName + " for agent " + data.agentId + " (" + cronExpression + ")"
    );
    return job.id ?? null;
}

/**
 * Create a worker that processes scheduled jobs.
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
            console.log("[CronEngine] Processing job " + job.name + " for agent " + job.data.agentId);
            await processor(job.data as CronJobData);
        },
        { connection: redisConnection }
    );

    worker.on("completed", (job) => {
        console.log("[CronEngine] Job " + job.id + " completed");
    });

    worker.on("failed", (job, err) => {
        console.error("[CronEngine] Job " + (job?.id ?? "unknown") + " failed: " + err.message);
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

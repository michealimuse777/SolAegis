/**
 * Execution Lock — per-agent mutex to prevent concurrent execution.
 * Also provides conflict detection between agents targeting the same token.
 */

interface LockEntry {
    agentId: string;
    action: string;
    targetMint?: string;
    acquiredAt: number;
    expiresAt: number;     // Auto-expire to prevent deadlocks
}

const locks = new Map<string, LockEntry>();
const executionQueue = new Map<string, (() => void)[]>();

export class ExecutionLock {
    private static readonly DEFAULT_TIMEOUT_MS = 60_000; // 1 minute auto-expire

    /**
     * Attempts to acquire an execution lock for an agent.
     * Returns true if lock acquired, false if agent is already executing.
     */
    static acquire(agentId: string, action: string, targetMint?: string): boolean {
        // Clean expired locks first
        ExecutionLock.cleanExpired();

        // Check if agent already has a lock
        if (locks.has(agentId)) {
            const existing = locks.get(agentId)!;
            console.log(`[Lock] Agent "${agentId}" blocked — already executing ${existing.action}`);
            return false;
        }

        // Check for cross-agent conflicts on same token
        if (targetMint) {
            for (const [otherId, lock] of locks) {
                if (otherId !== agentId && lock.targetMint === targetMint) {
                    console.log(`[Lock] Agent "${agentId}" blocked — agent "${otherId}" targeting same token`);
                    return false;
                }
            }
        }

        locks.set(agentId, {
            agentId,
            action,
            targetMint,
            acquiredAt: Date.now(),
            expiresAt: Date.now() + ExecutionLock.DEFAULT_TIMEOUT_MS,
        });

        return true;
    }

    /**
     * Releases an agent's execution lock.
     */
    static release(agentId: string): void {
        locks.delete(agentId);

        // Process queued executions for this agent
        const queue = executionQueue.get(agentId);
        if (queue && queue.length > 0) {
            const next = queue.shift()!;
            if (queue.length === 0) executionQueue.delete(agentId);
            next();
        }
    }

    /**
     * Queues an execution callback for when the lock is released.
     */
    static enqueue(agentId: string, callback: () => void): void {
        if (!executionQueue.has(agentId)) {
            executionQueue.set(agentId, []);
        }
        const queue = executionQueue.get(agentId)!;
        // Max queue depth of 5
        if (queue.length >= 5) {
            console.warn(`[Lock] Queue full for agent "${agentId}" — dropping task`);
            return;
        }
        queue.push(callback);
    }

    /**
     * Checks if an agent is currently locked.
     */
    static isLocked(agentId: string): boolean {
        ExecutionLock.cleanExpired();
        return locks.has(agentId);
    }

    /**
     * Gets all active locks for monitoring.
     */
    static getActiveLocks(): LockEntry[] {
        ExecutionLock.cleanExpired();
        return Array.from(locks.values());
    }

    /**
     * Gets queue depth for an agent.
     */
    static getQueueDepth(agentId: string): number {
        return executionQueue.get(agentId)?.length ?? 0;
    }

    private static cleanExpired(): void {
        const now = Date.now();
        for (const [id, lock] of locks) {
            if (lock.expiresAt < now) {
                console.warn(`[Lock] Auto-expired lock for agent "${id}" (action: ${lock.action})`);
                locks.delete(id);
            }
        }
    }
}

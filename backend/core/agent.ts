import { Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { WalletService } from "../services/walletService.js";
import { DeFiSkill, DeFiAction, TaskParams, ExecutionResult } from "../skills/defiSkill.js";
import { AgentConfig, loadAgentConfig, loadSkills } from "./agentConfig.js";

export interface AgentState {
    id: string;
    publicKey: string;
    balance: number;
    pendingTx: number;
    lastAction?: string;
    lastResult?: ExecutionResult;
    skills: string[];
    config: AgentConfig | null;
}

export interface AgentTask {
    action: DeFiAction;
    params: TaskParams;
}

/**
 * Autonomous agent with its own encrypted wallet, config, and DeFi capabilities.
 * Each agent is isolated — it can only access its own wallet and config.
 */
export class Agent {
    public pendingTx = 0;
    public lastAction?: string;
    public lastResult?: ExecutionResult;

    constructor(
        public readonly id: string,
        private walletService: WalletService,
        private defiSkill: DeFiSkill,
        private connection: Connection
    ) { }

    /**
     * Execute a DeFi task.
     * NOTE: Caller should check PolicyEngine BEFORE calling this.
     */
    async execute(task: AgentTask): Promise<ExecutionResult> {
        this.pendingTx++;
        this.lastAction = task.action;

        try {
            const result = await this.defiSkill.execute(
                this.id,
                task.action,
                task.params
            );
            this.lastResult = result;
            return result;
        } finally {
            this.pendingTx--;
        }
    }

    /**
     * Get current agent state including config.
     */
    async getState(): Promise<AgentState> {
        const publicKey = this.walletService.getPublicKey(this.id);
        const balance = await this.walletService.getBalance(this.id);
        const config = this.getConfig();

        return {
            id: this.id,
            publicKey,
            balance: balance / LAMPORTS_PER_SOL,
            pendingTx: this.pendingTx,
            lastAction: this.lastAction,
            lastResult: this.lastResult,
            skills: config?.allowedActions || this.defiSkill.getAvailableActions(),
            config,
        };
    }

    /**
     * Load this agent's config from disk.
     */
    getConfig(): AgentConfig | null {
        return loadAgentConfig(this.id);
    }

    /**
     * Read this agent's SKILLS.md.
     */
    readSkills(): string {
        return loadSkills(this.id);
    }

    /**
     * Get the agent's public key (own wallet only — isolation enforced).
     */
    getPublicKey(): string {
        return this.walletService.getPublicKey(this.id);
    }

    /**
     * Get the agent's decrypted keypair (own wallet only — isolation enforced).
     */
    getKeypair() {
        return this.walletService.getDecryptedKeypair(this.id);
    }
}

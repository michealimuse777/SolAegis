import { Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { WalletService } from "../services/walletService.js";
import { DeFiSkill, DeFiAction, TaskParams, ExecutionResult } from "../skills/defiSkill.js";

export interface AgentState {
    id: string;
    publicKey: string;
    balance: number;
    pendingTx: number;
    lastAction?: string;
    lastResult?: ExecutionResult;
    skills: string[];
}

export interface AgentTask {
    action: DeFiAction;
    params: TaskParams;
}

/**
 * Autonomous agent with its own encrypted wallet and DeFi capabilities.
 * Can read SKILLS.md to understand its own capabilities.
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
     * Get current agent state (for DerMercist decision engine).
     */
    async getState(): Promise<AgentState> {
        const publicKey = this.walletService.getPublicKey(this.id);
        const balance = await this.walletService.getBalance(this.id);

        return {
            id: this.id,
            publicKey,
            balance: balance / LAMPORTS_PER_SOL,
            pendingTx: this.pendingTx,
            lastAction: this.lastAction,
            lastResult: this.lastResult,
            skills: this.defiSkill.getAvailableActions(),
        };
    }

    /**
     * Returns the SKILLS.md documentation so the agent can read its own capabilities.
     */
    readSkills(): string {
        return this.defiSkill.getSkillsDocumentation();
    }

    /**
     * Get the agent's public key.
     */
    getPublicKey(): string {
        return this.walletService.getPublicKey(this.id);
    }
}

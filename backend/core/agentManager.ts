import { Connection } from "@solana/web3.js";
import { WalletService } from "../services/walletService.js";
import { RiskEngine } from "../services/riskEngine.js";
import { DeFiSkill } from "../skills/defiSkill.js";
import { Agent, AgentState } from "./agent.js";

/**
 * Manages the lifecycle of all agents.
 * Creates, lists, retrieves, and removes agents.
 */
export class AgentManager {
    private agents = new Map<string, Agent>();
    private walletService: WalletService;
    private riskEngine: RiskEngine;
    private defiSkill: DeFiSkill;

    constructor(private connection: Connection) {
        this.walletService = new WalletService(connection);
        this.riskEngine = new RiskEngine(connection);
        this.defiSkill = new DeFiSkill(
            this.walletService,
            this.riskEngine,
            connection
        );

        // Auto-restore agents from persisted wallets
        this.restoreFromDisk();
    }

    /**
     * Restores agents from persisted wallet storage.
     * Called automatically on startup.
     */
    private restoreFromDisk(): void {
        const persistedIds = this.walletService.listAgentIds();
        for (const agentId of persistedIds) {
            if (!this.agents.has(agentId)) {
                const publicKey = this.walletService.getPublicKey(agentId);
                const agent = new Agent(
                    agentId,
                    this.walletService,
                    this.defiSkill,
                    this.connection
                );
                this.agents.set(agentId, agent);
                console.log(`[AgentManager] Restored agent "${agentId}" → wallet ${publicKey}`);
            }
        }
        if (persistedIds.length > 0) {
            console.log(`[AgentManager] Restored ${persistedIds.length} agent(s) from disk`);
        }
    }

    /**
     * Create a new agent with an auto-generated encrypted wallet.
     */
    create(agentId: string): Agent {
        if (this.agents.has(agentId)) {
            throw new Error(`Agent already exists: ${agentId}`);
        }

        // Create wallet for agent
        const publicKey = this.walletService.createWallet(agentId);
        console.log(`[AgentManager] Created agent "${agentId}" → wallet ${publicKey}`);

        const agent = new Agent(
            agentId,
            this.walletService,
            this.defiSkill,
            this.connection
        );

        this.agents.set(agentId, agent);
        return agent;
    }

    /**
     * Get agent by ID.
     */
    get(agentId: string): Agent | undefined {
        return this.agents.get(agentId);
    }

    /**
     * List all agents.
     */
    list(): Agent[] {
        return Array.from(this.agents.values());
    }

    /**
     * Get state of all agents.
     */
    async listStates(): Promise<AgentState[]> {
        const states: AgentState[] = [];
        for (const agent of this.agents.values()) {
            states.push(await agent.getState());
        }
        return states;
    }

    /**
     * Remove an agent.
     */
    remove(agentId: string): boolean {
        return this.agents.delete(agentId);
    }

    /**
     * Get the shared wallet service.
     */
    getWalletService(): WalletService {
        return this.walletService;
    }

    /**
     * Get the shared risk engine.
     */
    getRiskEngine(): RiskEngine {
        return this.riskEngine;
    }

    /**
     * Get the shared DeFi skill orchestrator.
     */
    getDeFiSkill(): DeFiSkill {
        return this.defiSkill;
    }
}

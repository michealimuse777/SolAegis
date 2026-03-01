import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { WalletService } from "../services/walletService.js";
import { RiskEngine } from "../services/riskEngine.js";
import { transferSPL } from "./transferSpl.js";
import { swapTokens } from "./swap.js";
import { provideLiquidity } from "./provideLiquidity.js";
import { recoverRent } from "./solRecovery.js";
import { checkTokenSafety } from "./scamFilter.js";
import { scanAirdrops } from "./airdropScanner.js";
import fs from "fs";
import path from "path";

export type DeFiAction =
    | "transfer"
    | "swap"
    | "liquidity"
    | "recover"
    | "scan_airdrops";

export interface TaskParams {
    [key: string]: any;
}

export interface ExecutionResult {
    success: boolean;
    action: string;
    signature?: string;
    data?: any;
    error?: string;
}

/**
 * Central DeFi skill orchestrator.
 * Routes actions to the appropriate skill, applies scam filtering and risk validation.
 */
export class DeFiSkill {
    private skillsDoc: string | null = null;

    constructor(
        private walletService: WalletService,
        private riskEngine: RiskEngine,
        private connection: Connection
    ) {
        this.loadSkillsDoc();
    }

    /**
     * Loads SKILLS.md so agents can read their capabilities.
     */
    private loadSkillsDoc(): void {
        try {
            const skillsPath = path.resolve(process.cwd(), "SKILLS.md");
            if (fs.existsSync(skillsPath)) {
                this.skillsDoc = fs.readFileSync(skillsPath, "utf-8");
            }
        } catch {
            this.skillsDoc = null;
        }
    }

    /**
     * Returns the SKILLS.md content so agents can introspect their capabilities.
     */
    getSkillsDocumentation(): string {
        if (this.skillsDoc) return this.skillsDoc;
        return "SKILLS.md not found — using hardcoded skill list: transfer, swap, liquidity, recover, scan_airdrops";
    }

    /**
     * Lists all available actions.
     */
    getAvailableActions(): DeFiAction[] {
        return ["transfer", "swap", "liquidity", "recover", "scan_airdrops"];
    }

    /**
     * Executes a DeFi action for a given agent.
     */
    async execute(
        agentId: string,
        action: DeFiAction,
        params: TaskParams
    ): Promise<ExecutionResult> {
        try {
            const keypair = this.walletService.getDecryptedKeypair(agentId);

            // ---------- Scan airdrops (read-only, no tx) ----------
            if (action === "scan_airdrops") {
                const results = await scanAirdrops(this.connection, keypair.publicKey);
                return { success: true, action, data: results };
            }

            // ---------- Parameter validation ----------
            if (action === "transfer") {
                if (!params.mint || !params.to || !params.amount) {
                    return { success: false, action, error: "Transfer requires params: mint (token mint address), to (recipient address), amount (number)" };
                }
            }
            if (action === "swap") {
                if (!params.inputMint || !params.outputMint || !params.amount) {
                    return { success: false, action, error: "Swap requires params: inputMint (token to sell), outputMint (token to buy), amount (human-readable number)" };
                }
            }
            if (action === "liquidity") {
                if (!params.userTokenAccountA || !params.userTokenAccountB || !params.poolVaultA || !params.poolVaultB) {
                    return { success: false, action, error: "Liquidity requires params: userTokenAccountA, userTokenAccountB, poolVaultA, poolVaultB, amountA, amountB" };
                }
            }
            if (action === "recover") {
                if (!params.tokenAccount) {
                    return { success: false, action, error: "Recover requires params: tokenAccount (empty token account address to close)" };
                }
            }

            // ---------- Build transaction ----------
            let tx: Transaction;

            switch (action) {
                case "transfer":
                    tx = await transferSPL({
                        connection: this.connection,
                        payer: keypair,
                        mint: new PublicKey(params.mint),
                        to: new PublicKey(params.to),
                        amount: params.amount,
                    });
                    break;

                case "swap": {
                    // Scam filter before swap
                    const safety = await checkTokenSafety(
                        this.connection,
                        new PublicKey(params.inputMint)
                    );
                    if (!safety.safe) {
                        return {
                            success: false,
                            action,
                            error: `Unsafe token blocked: ${safety.reasons.join("; ")}`,
                        };
                    }

                    // Use Jupiter Aggregator for real swap
                    const swapResult = await swapTokens({
                        connection: this.connection,
                        payer: keypair,
                        inputMint: params.inputMint,
                        outputMint: params.outputMint,
                        amount: parseFloat(params.amount),
                        slippageBps: params.slippageBps ? parseInt(params.slippageBps) : 100,
                    });

                    return {
                        success: true,
                        action,
                        signature: swapResult.signature,
                        data: {
                            inAmount: swapResult.inAmount,
                            outAmount: swapResult.outAmount,
                            priceImpact: swapResult.priceImpact,
                            route: swapResult.route,
                        },
                    };
                }

                case "liquidity":
                    tx = await provideLiquidity({
                        payer: keypair,
                        userTokenAccountA: new PublicKey(params.userTokenAccountA),
                        userTokenAccountB: new PublicKey(params.userTokenAccountB),
                        poolVaultA: new PublicKey(params.poolVaultA),
                        poolVaultB: new PublicKey(params.poolVaultB),
                        amountA: params.amountA,
                        amountB: params.amountB,
                    });
                    break;

                case "recover":
                    tx = await recoverRent({
                        connection: this.connection,
                        payer: keypair,
                        tokenAccount: new PublicKey(params.tokenAccount),
                    });
                    break;

                default:
                    return { success: false, action, error: `Unknown action: ${action}` };
            }

            // ---------- Risk validation ----------
            const validation = await this.riskEngine.validateTransaction(
                tx,
                keypair.publicKey
            );
            if (!validation.valid) {
                return {
                    success: false,
                    action,
                    error: `Risk engine rejected: ${validation.reason}`,
                };
            }

            // ---------- Sign & send ----------
            const signature = await this.walletService.signAndSend(tx, keypair);
            return { success: true, action, signature };
        } catch (err: any) {
            return { success: false, action, error: err.message };
        }
    }
}

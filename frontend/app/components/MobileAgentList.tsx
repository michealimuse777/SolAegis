"use client";
import { type ExecutionBlockData } from "./ExecutionBlock";

interface Agent {
    id: string;
    publicKey: string;
    balance: number;
    config: { role: string; };
}

interface MobileAgentListProps {
    agents: Agent[];
    agentBlocks: Record<string, ExecutionBlockData[]>;
    onSelectAgent: (id: string) => void;
    onNewAgent: () => void;
    walletAddress?: string;
    onDisconnect: () => void;
}

function RoleIcon({ role, size = 18 }: { role: string; size?: number }) {
    if (role === "trader") {
        return (
            <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#00e0ff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.75 }}>
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
        );
    }
    const icons: Record<string, string> = { monitor: "◉", recovery: "⟲", custom: "◆" };
    return <>{icons[role] || "◆"}</>;
}

export default function MobileAgentList({ agents, agentBlocks, onSelectAgent, onNewAgent, walletAddress, onDisconnect }: MobileAgentListProps) {
    return (
        <div className="h-screen bg-bg flex flex-col">
            {/* Header */}
            <div className="px-5 pt-6 pb-4 border-b border-border bg-panel/95">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-accent shadow-[0_0_8px_rgba(0,224,255,0.4)]" />
                        <h1 className="text-[16px] font-semibold text-text">SolAegis</h1>
                        <span className="text-[7px] text-warning-text border border-warning/30 rounded-sm px-1 py-px tracking-[0.1em] uppercase font-semibold">
                            Devnet
                        </span>
                    </div>
                    {walletAddress && (
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] font-mono text-dim">{walletAddress.slice(0, 4)}···{walletAddress.slice(-4)}</span>
                            <button onClick={onDisconnect} className="text-[10px] text-dim hover:text-danger-text cursor-pointer bg-transparent border-none">×</button>
                        </div>
                    )}
                </div>
            </div>

            {/* Agent List */}
            <div className="flex-1 overflow-y-auto">
                {agents.map(agent => {
                    const blocks = agentBlocks[agent.id] || [];
                    const lastBlock = blocks[blocks.length - 1];
                    const lastMsg = lastBlock ? lastBlock.content.slice(0, 60) : "No activity yet";
                    const lastTime = lastBlock
                        ? new Date(lastBlock.timestamp).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
                        : "";

                    return (
                        <div
                            key={agent.id}
                            onClick={() => onSelectAgent(agent.id)}
                            className="flex items-center gap-3 px-5 py-3.5 border-b border-border active:bg-elevated/50 cursor-pointer transition-colors"
                        >
                            <div className="w-10 h-10 rounded-full bg-elevated flex items-center justify-center text-lg flex-shrink-0">
                                <RoleIcon role={agent.config?.role || "custom"} />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between">
                                    <span className="text-[13px] font-medium text-text">{agent.id}</span>
                                    <span className="text-[9px] text-dim font-mono">{lastTime}</span>
                                </div>
                                <div className="flex items-center gap-1.5 mt-0.5">
                                    {agent.balance > 0 && <span className="status-dot online" style={{ width: 5, height: 5 }} />}
                                    <p className="text-[11px] text-muted truncate">{lastMsg}</p>
                                </div>
                            </div>
                            <span className="text-dim text-[14px] flex-shrink-0">›</span>
                        </div>
                    );
                })}

                {/* Create New */}
                <button
                    onClick={onNewAgent}
                    className="w-full flex items-center gap-3 px-5 py-3.5 border-b border-border cursor-pointer bg-transparent text-left"
                >
                    <div className="w-10 h-10 rounded-full border border-accent/30 flex items-center justify-center text-accent text-lg flex-shrink-0">
                        +
                    </div>
                    <span className="text-[13px] text-accent font-medium">Create New Agent</span>
                </button>
            </div>
        </div>
    );
}

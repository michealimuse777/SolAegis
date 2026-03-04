"use client";

interface Agent {
    id: string;
    publicKey: string;
    balance: number;
    config: {
        role: string;
        maxSolPerTx: number;
        dailyTxLimit: number;
        allowedActions: string[];
        riskProfile: string;
        createdAt?: number;
    };
}

interface SidebarProps {
    agents: Agent[];
    selectedAgent: string | null;
    onSelectAgent: (id: string) => void;
    onDeleteAgent: (id: string) => void;
    onNewAgent: () => void;
    walletAddress?: string;
    onDisconnect: () => void;
}

const roleIcon: Record<string, string> = {
    trader: "⚡",
    monitor: "◉",
    recovery: "⟲",
    custom: "◆",
};

export default function Sidebar({
    agents, selectedAgent, onSelectAgent, onDeleteAgent, onNewAgent, walletAddress, onDisconnect,
}: SidebarProps) {
    const selected = agents.find(a => a.id === selectedAgent);

    return (
        <div className="
      w-full md:w-56 lg:w-60
      bg-panel/95 backdrop-blur-sm flex
      h-auto md:h-full
      flex-row md:flex-col
      border-b md:border-b-0 md:border-r border-border
      overflow-x-auto md:overflow-x-hidden md:overflow-y-auto
    ">
            <div className="hidden md:block px-5 pt-6 pb-4 border-b border-border">
                <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-accent shadow-[0_0_8px_rgba(0,224,255,0.4)]" />
                    <h1 className="text-[15px] font-semibold tracking-tight text-text">SolAegis</h1>
                    <span className="text-[7px] text-warning-text border border-warning/30 rounded-sm px-1 py-px tracking-[0.1em] uppercase font-semibold">
                        Devnet
                    </span>
                </div>
                <p className="text-[9px] text-dim mt-1.5 tracking-[0.2em] uppercase pl-4">
                    Execution Core
                </p>
            </div>

            {/* Wallet */}
            {walletAddress && (
                <div className="hidden md:flex px-5 py-2.5 border-b border-border items-center justify-between">
                    <div className="flex items-center gap-1.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-success" />
                        <span className="text-[10px] font-mono text-muted">
                            {walletAddress.slice(0, 4)}···{walletAddress.slice(-4)}
                        </span>
                    </div>
                    <button
                        onClick={onDisconnect}
                        className="text-[9px] text-dim hover:text-danger-text uppercase tracking-wider cursor-pointer bg-transparent border-none transition-colors"
                    >
                        ×
                    </button>
                </div>
            )}

            {/* Agent List */}
            <div className="flex-1 p-2 md:p-3 flex md:block gap-2 md:gap-0">
                <div className="hidden md:flex items-center justify-between px-2 mb-2">
                    <span className="text-[9px] text-dim tracking-[0.15em] uppercase">Agents</span>
                    <button
                        onClick={onNewAgent}
                        className="text-[10px] text-accent hover:text-accent-hover cursor-pointer bg-transparent border-none font-semibold transition-colors"
                    >
                        + New
                    </button>
                </div>

                {/* Mobile: + button */}
                <button
                    onClick={onNewAgent}
                    className="md:hidden flex-shrink-0 w-9 h-9 border border-accent/30 rounded-sm text-accent text-sm font-semibold cursor-pointer bg-transparent flex items-center justify-center"
                >
                    +
                </button>

                <div className="flex md:flex-col gap-1 md:space-y-0.5">
                    {agents.map(agent => (
                        <div
                            key={agent.id}
                            onClick={() => onSelectAgent(agent.id)}
                            className={`
                card-hover flex items-center gap-2 md:gap-2.5 px-2.5 md:px-3 py-2 md:py-2 rounded-sm cursor-pointer
                flex-shrink-0 min-w-[100px] md:min-w-0 transition-all duration-200
                ${selectedAgent === agent.id
                                    ? "bg-elevated border border-accent/15 shadow-[0_0_12px_rgba(0,224,255,0.04)]"
                                    : "border border-transparent"
                                }
              `}
                        >
                            <span className="text-sm opacity-60">{roleIcon[agent.config?.role] || "◆"}</span>
                            <div className="flex-1 min-w-0">
                                <div className="text-[11px] font-medium text-text truncate">{agent.id}</div>
                                <div className="text-[9px] font-mono text-dim tabular-nums">
                                    {agent.balance?.toFixed(3) || "0.000"} SOL
                                </div>
                            </div>
                            <span className={`status-dot ${agent.balance > 0 ? "online" : "idle"}`} />
                        </div>
                    ))}
                </div>
            </div>

            {/* Footer */}
            {selected && (
                <div className="hidden md:block border-t border-border p-4 space-y-3">
                    <div>
                        <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[9px] text-dim tracking-[0.15em] uppercase">Usage</span>
                            <span className="text-[9px] font-mono text-muted tabular-nums">
                                — / {selected.config?.dailyTxLimit || 0}
                            </span>
                        </div>
                        <div className="h-1 bg-border rounded-full overflow-hidden">
                            <div className="h-full bg-accent/40 rounded-full transition-all duration-500" style={{ width: "0%" }} />
                        </div>
                    </div>
                    <button
                        onClick={() => onDeleteAgent(selected.id)}
                        className="w-full py-1.5 text-[9px] text-dim hover:text-danger-text border border-transparent hover:border-danger/15 rounded-sm cursor-pointer transition-all bg-transparent uppercase tracking-wider"
                    >
                        Remove
                    </button>
                </div>
            )}
        </div>
    );
}

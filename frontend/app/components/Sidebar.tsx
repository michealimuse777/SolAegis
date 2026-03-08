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
            <div className="hidden md:block px-5 pt-5 pb-4 border-b border-border">
                <div className="flex items-center gap-2.5 mb-1">
                    {/* Shield Logo */}
                    <svg width="22" height="26" viewBox="0 0 48 56" fill="none" style={{ flexShrink: 0, filter: "drop-shadow(0 0 6px rgba(0,224,255,0.35))" }}>
                        <path d="M24 2L4 12v16c0 14.4 8.5 24.2 20 28 11.5-3.8 20-13.6 20-28V12L24 2z" stroke="url(#sbGrad)" strokeWidth="3" fill="rgba(0,224,255,0.08)" />
                        <circle cx="24" cy="26" r="5" fill="#00e0ff" opacity="0.8" />
                        <defs>
                            <linearGradient id="sbGrad" x1="4" y1="2" x2="44" y2="56">
                                <stop offset="0%" stopColor="#00e0ff" />
                                <stop offset="100%" stopColor="#0060ff" />
                            </linearGradient>
                        </defs>
                    </svg>
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                            <h1 className="text-[15px] font-bold tracking-tight text-text" style={{ letterSpacing: "-0.01em" }}>
                                Sol<span style={{ color: "#00e0ff" }}>Aegis</span>
                            </h1>
                            <span style={{
                                fontSize: "7px",
                                padding: "1.5px 5px",
                                borderRadius: "3px",
                                background: "rgba(0,255,200,0.08)",
                                border: "1px solid rgba(0,255,200,0.35)",
                                color: "rgba(0,255,200,0.85)",
                                letterSpacing: "0.12em",
                                textTransform: "uppercase" as const,
                                fontWeight: 700,
                                boxShadow: "0 0 8px rgba(0,255,200,0.1)",
                            }}>
                                Devnet
                            </span>
                        </div>
                        <p className="text-[9px] text-dim tracking-[0.15em] uppercase" style={{ opacity: 0.5, marginTop: "2px" }}>
                            Agent Execution Core
                        </p>
                    </div>
                </div>
            </div>

            {/* Wallet */}
            {walletAddress && (
                <div className="hidden md:flex px-5 py-2.5 border-b border-border items-center justify-between">
                    <div className="flex flex-col gap-0.5">
                        <span className="text-[8px] text-dim tracking-[0.15em] uppercase" style={{ opacity: 0.5 }}>Connected</span>
                        <div className="flex items-center gap-1.5">
                            <div className="w-1.5 h-1.5 rounded-full bg-success" style={{ boxShadow: "0 0 6px rgba(34,197,94,0.4)" }} />
                            <span className="text-[10px] font-mono text-muted">
                                {walletAddress.slice(0, 4)}···{walletAddress.slice(-4)}
                            </span>
                        </div>
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

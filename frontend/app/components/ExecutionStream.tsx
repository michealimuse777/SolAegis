"use client";
import { useRef, useEffect, useState } from "react";
import ExecutionBlock, { type ExecutionBlockData } from "./ExecutionBlock";

interface ExecutionStreamProps {
    blocks: ExecutionBlockData[];
    agentName?: string;
    agentRole?: string;
    allowedActions?: string[];
    maxSolPerTx?: number;
    dailyTxLimit?: number;
    parsing?: boolean;
    parsingStep?: "analyzing" | "processing" | null;
    onTogglePanel?: () => void;
    showPanel?: boolean;
}

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

const ACTION_ICONS: Record<string, string> = {
    transfer: "↗", swap: "⇄", recover: "♻", scam_check: "🔍",
    scan_airdrops: "📡", airdrop: "💧", balance: "💰",
};

export default function ExecutionStream({ blocks, agentName, agentRole, allowedActions, maxSolPerTx, dailyTxLimit, parsing, parsingStep, onTogglePanel, showPanel }: ExecutionStreamProps) {
    const endRef = useRef<HTMLDivElement>(null);
    const [solPrice, setSolPrice] = useState<{ price: number; change: number; trend: string } | null>(null);

    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [blocks, parsing]);

    // Fetch SOL price
    useEffect(() => {
        const fetchPrice = async () => {
            try {
                const res = await fetch(`${API}/api/price/sol`);
                const data = await res.json();
                if (data.sol_price) setSolPrice({ price: data.sol_price, change: data.change_24h, trend: data.trend });
            } catch { }
        };
        fetchPrice();
        const interval = setInterval(fetchPrice, 60_000); // refresh every 60s
        return () => clearInterval(interval);
    }, []);

    return (
        <div className="flex-1 flex flex-col min-h-0">
            {/* Top bar */}
            <div className="px-4 md:px-6 py-3 border-b border-border flex items-center justify-between bg-panel/95 backdrop-blur-sm">
                <div className="flex items-center gap-2 md:gap-3">
                    <span className="text-[13px] md:text-sm font-semibold text-text truncate max-w-[140px] md:max-w-none">{agentName || "No Agent"}</span>
                    {agentRole && (
                        <span className="text-[9px] md:text-[10px] text-accent tracking-wider uppercase px-1.5 md:px-2 py-0.5 border border-accent/20 rounded-sm font-semibold">
                            {agentRole}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2 md:gap-4 text-[9px] md:text-[10px] text-dim tracking-wider uppercase">
                    {/* SOL Price ticker */}
                    {solPrice && solPrice.price > 0 && (
                        <span className="hidden md:flex items-center gap-1.5 font-mono tabular-nums">
                            <span className="text-muted">SOL</span>
                            <span className="text-text font-semibold">${solPrice.price}</span>
                            <span className={`text-[8px] ${solPrice.change >= 0 ? "text-success-text" : "text-danger-text"}`}>
                                {solPrice.change >= 0 ? "↑" : "↓"}{Math.abs(solPrice.change).toFixed(1)}%
                            </span>
                        </span>
                    )}
                    <span className="hidden md:inline text-border">·</span>
                    <span className="flex items-center gap-1.5">
                        <span className="status-dot online" /> Live
                    </span>
                    {onTogglePanel && (
                        <>
                            <span className="hidden md:inline text-border">·</span>
                            <button
                                onClick={onTogglePanel}
                                className="hidden md:inline text-[10px] text-dim hover:text-accent cursor-pointer bg-transparent border-none uppercase tracking-wider transition-colors"
                            >
                                {showPanel ? "◁ Panel" : "▷ Panel"}
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* Stream */}
            <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-5 md:space-y-6 grid-bg">
                {blocks.length === 0 && !parsing && (
                    <div className="flex items-center justify-center h-full">
                        <div className="text-center max-w-sm slide-up">
                            <p className="text-[15px] text-text font-semibold mb-0.5">
                                {agentName ? `${agentName}` : "Your Agent"}
                            </p>
                            <p className="text-[10px] text-accent uppercase tracking-[0.2em] font-medium mb-5">
                                {agentRole || "Agent"} • Ready
                            </p>

                            {/* Capabilities grid */}
                            {allowedActions && allowedActions.length > 0 && (
                                <div className="mb-4">
                                    <p className="text-[9px] text-dim uppercase tracking-[0.15em] mb-2 text-left">Capabilities</p>
                                    <div className="grid grid-cols-2 gap-1.5">
                                        {allowedActions.map(action => (
                                            <div key={action} className="flex items-center gap-2 text-[10px] px-3 py-2 border border-border rounded-sm text-left hover:border-accent/20 transition-colors">
                                                <span className="text-[12px]">{ACTION_ICONS[action] || "◆"}</span>
                                                <span className="text-muted capitalize">{action.replace(/_/g, " ")}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Risk limits */}
                            <div className="space-y-1.5 mb-4">
                                <p className="text-[9px] text-dim uppercase tracking-[0.15em] mb-2 text-left">Risk Limits</p>
                                <div className="flex items-center justify-between text-[10px] px-3 py-2 border border-border rounded-sm">
                                    <span className="text-muted">Max per Tx</span>
                                    <span className="text-accent font-mono text-[9px]">{maxSolPerTx ?? "?"} SOL</span>
                                </div>
                                <div className="flex items-center justify-between text-[10px] px-3 py-2 border border-border rounded-sm">
                                    <span className="text-muted">Daily Limit</span>
                                    <span className="text-accent font-mono text-[9px]">{dailyTxLimit ?? "?"} txs</span>
                                </div>
                            </div>

                            {/* Security status */}
                            <div className="space-y-1.5">
                                <p className="text-[9px] text-dim uppercase tracking-[0.15em] mb-2 text-left">Security</p>
                                <div className="flex items-center justify-between text-[10px] px-3 py-2 border border-border rounded-sm">
                                    <span className="text-muted">Policy Engine</span>
                                    <span className="text-success-text font-mono text-[9px]">Active</span>
                                </div>
                                <div className="flex items-center justify-between text-[10px] px-3 py-2 border border-border rounded-sm">
                                    <span className="text-muted">Injection Guard</span>
                                    <span className="text-success-text font-mono text-[9px]">Active</span>
                                </div>
                            </div>

                            <p className="text-[10px] text-dim mt-5 italic">Type a command or click ⚡ for quick actions</p>
                        </div>
                    </div>
                )}

                {blocks.map(block => (
                    <ExecutionBlock key={block.id} block={block} />
                ))}

                {parsing && (
                    <div className="flex items-center gap-3 px-4 py-3 block-enter">
                        {parsingStep === "processing" ? (
                            <>
                                <span className="w-2 h-2 rounded-full bg-[#16C784] animate-pulse" />
                                <span className="text-[13px] text-[#16C784]/80 animate-pulse" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
                                    Processing response...
                                </span>
                            </>
                        ) : (
                            <>
                                <svg className="animate-spin h-4 w-4 text-[#00E0FF]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                <span className="text-[13px] text-[#00E0FF]/70 animate-pulse" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
                                    Analyzing request...
                                </span>
                            </>
                        )}
                    </div>
                )}

                <div ref={endRef} />
            </div>
        </div>
    );
}

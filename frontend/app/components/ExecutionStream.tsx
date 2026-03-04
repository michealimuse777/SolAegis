"use client";
import { useRef, useEffect, useState } from "react";
import ExecutionBlock, { type ExecutionBlockData } from "./ExecutionBlock";

interface ExecutionStreamProps {
    blocks: ExecutionBlockData[];
    agentName?: string;
    agentRole?: string;
    parsing?: boolean;
    parsingStep?: "analyzing" | "processing" | null;
    onTogglePanel?: () => void;
    showPanel?: boolean;
}

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export default function ExecutionStream({ blocks, agentName, agentRole, parsing, parsingStep, onTogglePanel, showPanel }: ExecutionStreamProps) {
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
                        <div className="text-center max-w-xs slide-up">
                            <p className="text-[14px] text-text font-medium mb-1">Ask your agent to do something</p>
                            <p className="text-[11px] text-dim mb-6">Swap tokens, transfer SOL or SPL tokens, scan for scams, and more.</p>

                            <div className="space-y-2 text-left">
                                <div className="flex items-center justify-between text-[10px] px-3 py-2 border border-border rounded-sm">
                                    <span className="text-muted">Simulation Guard</span>
                                    <span className="text-success-text font-mono text-[9px]">Active</span>
                                </div>
                                <div className="flex items-center justify-between text-[10px] px-3 py-2 border border-border rounded-sm">
                                    <span className="text-muted">Supports</span>
                                    <span className="text-accent font-mono text-[9px]">SOL + SPL Tokens</span>
                                </div>
                                <div className="flex items-center justify-between text-[10px] px-3 py-2 border border-border rounded-sm">
                                    <span className="text-muted">Injection Guard</span>
                                    <span className="text-success-text font-mono text-[9px]">Active</span>
                                </div>
                            </div>
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

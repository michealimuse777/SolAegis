"use client";
import { useState, useEffect } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

interface MobileSettingsDrawerProps {
    open: boolean;
    onClose: () => void;
    agentName?: string;
    agentAddress?: string;
    config?: any;
    schedules?: any[];
    history?: any[];
    onScheduleCmd?: (cmd: string) => void;
}

type Section = "risk" | "schedule" | "history" | "memory" | "info";

export default function MobileSettingsDrawer({ open, onClose, agentName, agentAddress, config, schedules, history, onScheduleCmd }: MobileSettingsDrawerProps) {
    const [expanded, setExpanded] = useState<Section | null>(null);
    const [memory, setMemory] = useState<any>(null);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        if (expanded === "memory" && agentName) {
            const token = typeof window !== "undefined" ? localStorage.getItem("solaegis_token") : null;
            const headers: Record<string, string> = {};
            if (token) headers.Authorization = `Bearer ${token}`;
            fetch(`${API}/api/agents/${encodeURIComponent(agentName)}/memory`, { headers })
                .then(r => r.json())
                .then(d => setMemory(d))
                .catch(() => { });
        }
    }, [expanded, agentName]);

    if (!open) return null;

    const toggle = (s: Section) => setExpanded(expanded === s ? null : s);

    return (
        <div className="fixed inset-0 z-50 fade-in" onClick={onClose}>
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
            <div
                className="absolute bottom-0 left-0 right-0 bg-panel border-t border-border rounded-t-xl slide-up max-h-[75vh] overflow-y-auto"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex justify-center py-2.5">
                    <div className="w-8 h-1 rounded-full bg-border" />
                </div>

                <p className="px-5 pb-2 text-[9px] text-dim tracking-[0.15em] uppercase">Agent Controls</p>

                <div className="px-4 pb-6 space-y-0.5">
                    {/* ── Risk ── */}
                    <button onClick={() => toggle("risk")} className="w-full flex items-center justify-between px-4 py-3 rounded-sm bg-transparent border-none cursor-pointer text-left">
                        <span className="text-[13px] text-text font-medium">{expanded === "risk" ? "▼" : "▶"} Risk</span>
                        <span className="text-[10px] text-accent font-mono capitalize">{config?.riskProfile || "medium"}</span>
                    </button>
                    {expanded === "risk" && config && (
                        <div className="px-4 pb-3 space-y-2 fade-in">
                            <div className="flex justify-between text-[11px]"><span className="text-muted">Max SOL/tx</span><span className="text-accent font-mono">{config.maxSolPerTx}</span></div>
                            <div className="flex justify-between text-[11px]"><span className="text-muted">Daily Cap</span><span className="text-text font-mono">{config.dailyTxLimit} tx</span></div>
                            <div className="flex justify-between text-[11px]"><span className="text-muted">Role</span><span className="text-text capitalize">{config.role}</span></div>
                            <div className="flex flex-wrap gap-1 mt-1">
                                {config.allowedActions?.map((a: string) => (
                                    <span key={a} className="text-[8px] font-mono text-dim border border-border px-1.5 py-0.5 rounded-sm">{a}</span>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* ── Schedule ── */}
                    <button onClick={() => toggle("schedule")} className="w-full flex items-center justify-between px-4 py-3 rounded-sm bg-transparent border-none cursor-pointer text-left">
                        <span className="text-[13px] text-text font-medium">{expanded === "schedule" ? "▼" : "▶"} Schedule</span>
                        <span className="text-[10px] text-dim">{schedules?.length || 0} active</span>
                    </button>
                    {expanded === "schedule" && (
                        <div className="px-4 pb-3 space-y-1.5 fade-in">
                            {["scan scams every 6 hours", "check airdrops every hour", "recover rent daily"].map(cmd => (
                                <button
                                    key={cmd}
                                    onClick={() => { onScheduleCmd?.(cmd); onClose(); }}
                                    className="w-full text-left text-[11px] text-muted px-3 py-2 border border-border rounded-sm cursor-pointer bg-transparent active:bg-elevated/50"
                                >
                                    {cmd}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* ── History ── */}
                    <button onClick={() => toggle("history")} className="w-full flex items-center justify-between px-4 py-3 rounded-sm bg-transparent border-none cursor-pointer text-left">
                        <span className="text-[13px] text-text font-medium">{expanded === "history" ? "▼" : "▶"} History</span>
                    </button>
                    {expanded === "history" && (
                        <div className="px-4 pb-3 space-y-1 fade-in">
                            {(!history || history.length === 0) ? (
                                <p className="text-[11px] text-dim italic">No history yet.</p>
                            ) : history.slice(-10).reverse().map((h: any, i: number) => (
                                <div key={i} className="text-[11px] text-muted font-mono px-3 py-1.5 border-l-2 border-accent/20">
                                    <span className="text-accent">{h.action || h.type}</span> — {h.detail || "completed"}
                                </div>
                            ))}
                        </div>
                    )}

                    {/* ── Memory ── */}
                    <button onClick={() => toggle("memory")} className="w-full flex items-center justify-between px-4 py-3 rounded-sm bg-transparent border-none cursor-pointer text-left">
                        <span className="text-[13px] text-text font-medium">{expanded === "memory" ? "▼" : "▶"} Memory</span>
                    </button>
                    {expanded === "memory" && (
                        <div className="px-4 pb-3 space-y-2 fade-in">
                            {!memory ? (
                                <div className="space-y-1.5"><div className="skeleton h-3 w-3/4" /><div className="skeleton h-3 w-1/2" /></div>
                            ) : (
                                <>
                                    <p className="text-[9px] text-dim uppercase tracking-wider">Preferences</p>
                                    {Object.keys(memory.preferences || {}).length === 0
                                        ? <p className="text-[10px] text-dim italic">None set</p>
                                        : Object.entries(memory.preferences).map(([k, v]) => (
                                            <div key={k} className="flex justify-between text-[10px]">
                                                <span className="text-muted capitalize">{k}</span>
                                                <span className="text-text font-mono">{String(v)}</span>
                                            </div>
                                        ))
                                    }
                                    <p className="text-[9px] text-dim uppercase tracking-wider mt-2">Notes</p>
                                    {(!memory.notes || memory.notes.length === 0)
                                        ? <p className="text-[10px] text-dim italic">None</p>
                                        : memory.notes.map((n: string, i: number) => (
                                            <p key={i} className="text-[10px] text-muted border-l-2 border-accent/20 pl-2">{n}</p>
                                        ))
                                    }
                                </>
                            )}
                        </div>
                    )}

                    {/* ── Info ── */}
                    <button onClick={() => toggle("info")} className="w-full flex items-center justify-between px-4 py-3 rounded-sm bg-transparent border-none cursor-pointer text-left">
                        <span className="text-[13px] text-text font-medium">{expanded === "info" ? "▼" : "▶"} Info</span>
                    </button>
                    {expanded === "info" && (
                        <div className="px-4 pb-3 space-y-2 fade-in">
                            <p className="text-[9px] text-dim uppercase tracking-wider">Agent Wallet</p>
                            <p className="text-[10px] font-mono text-muted break-all">{agentAddress || "—"}</p>
                            <p className="text-[9px] text-dim italic">Send SOL or any SPL token to fund.</p>
                            <button
                                onClick={() => {
                                    if (agentAddress) {
                                        navigator.clipboard.writeText(agentAddress);
                                        setCopied(true);
                                        setTimeout(() => setCopied(false), 2000);
                                    }
                                }}
                                className="w-full py-2 bg-accent/10 border border-accent/20 rounded-sm text-[10px] text-accent font-semibold cursor-pointer uppercase tracking-wider"
                            >
                                {copied ? "✓ Address Copied!" : "Copy Agent Address"}
                            </button>
                            <div className="space-y-1 mt-2 text-[11px]">
                                <div className="flex justify-between"><span className="text-muted">Cluster</span><span className="text-warning-text font-mono">Devnet</span></div>
                                <div className="flex justify-between"><span className="text-muted">DEX</span><span className="text-text font-mono">Orca</span></div>
                                <div className="flex justify-between"><span className="text-muted">Tokens</span><span className="text-accent font-mono">SOL + SPL</span></div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

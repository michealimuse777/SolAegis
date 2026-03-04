"use client";
import { useState, useEffect } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

interface RiskPanelProps {
    config?: any;
    agentName?: string;
    agentAddress?: string;
    schedules?: any[];
    history?: any[];
    onScheduleCmd?: (cmd: string) => void;
}

type Tab = "risk" | "schedule" | "history" | "memory" | "info";

const SCHEDULE_CMDS = [
    "scan scams every 6 hours",
    "check airdrops every hour",
    "recover rent daily",
    "transfer 0.01 SOL to <address> in 6 hours",
    "send tokens every 12 hours",
];

export default function RiskPanel({ config, agentName, agentAddress, schedules: _schedules, history: _history, onScheduleCmd }: RiskPanelProps) {
    const [tab, setTab] = useState<Tab>("risk");
    const [memory, setMemory] = useState<any>(null);
    const [loadingMem, setLoadingMem] = useState(false);
    const [copied, setCopied] = useState(false);
    const [liveSchedules, setLiveSchedules] = useState<any[]>([]);
    const [liveHistory, setLiveHistory] = useState<any[]>([]);

    // Auth helper
    const authHeaders = (): Record<string, string> => {
        const t = typeof window !== "undefined" ? localStorage.getItem("solaegis_token") : null;
        const h: Record<string, string> = { "Content-Type": "application/json" };
        if (t) h.Authorization = `Bearer ${t}`;
        return h;
    };

    // Fetch memory when tab switches
    useEffect(() => {
        if (tab === "memory" && agentName) {
            setLoadingMem(true);
            fetch(`${API}/api/agents/${encodeURIComponent(agentName)}/memory`, { headers: authHeaders() })
                .then(r => r.json())
                .then(d => { setMemory(d); setLoadingMem(false); })
                .catch(() => setLoadingMem(false));
        }
    }, [tab, agentName]);

    // Fetch schedules when tab switches
    useEffect(() => {
        if (tab === "schedule" && agentName) {
            fetch(`${API}/api/agents/${encodeURIComponent(agentName)}/schedules`, { headers: authHeaders() })
                .then(r => r.json())
                .then(d => { if (Array.isArray(d)) setLiveSchedules(d); })
                .catch(() => { });
        }
    }, [tab, agentName]);

    // Fetch history when tab switches
    useEffect(() => {
        if (tab === "history" && agentName) {
            fetch(`${API}/api/agents/${encodeURIComponent(agentName)}/history`, { headers: authHeaders() })
                .then(r => r.json())
                .then(d => { if (Array.isArray(d)) setLiveHistory(d); })
                .catch(() => { });
        }
    }, [tab, agentName]);

    const wipeMemory = async () => {
        if (!agentName || !confirm("Wipe all agent memory? This cannot be undone.")) return;
        await fetch(`${API}/api/agents/${encodeURIComponent(agentName)}/memory`, { method: "DELETE", headers: authHeaders() });
        setMemory({ preferences: {}, notes: [], successfulActions: [], lastFailures: [] });
    };

    const TABS: { key: Tab; label: string }[] = [
        { key: "risk", label: "Risk" },
        { key: "schedule", label: "Sched" },
        { key: "history", label: "History" },
        { key: "memory", label: "Memory" },
        { key: "info", label: "Info" },
    ];

    return (
        <div className="w-64 lg:w-72 bg-panel/95 backdrop-blur-sm border-l border-border h-full flex flex-col overflow-hidden">
            {/* Agent Header */}
            <div className="px-4 py-3 border-b border-border">
                <div className="flex items-center gap-2">
                    <span className="text-[10px] text-dim tracking-[0.15em] uppercase">Agent</span>
                    <span className="text-[11px] text-text font-medium truncate flex-1">{agentName || "—"}</span>
                </div>
                {agentAddress && (
                    <p className="text-[9px] font-mono text-dim mt-1 truncate">{agentAddress}</p>
                )}
            </div>

            {/* Tabs */}
            <div className="flex border-b border-border">
                {TABS.map(t => (
                    <button
                        key={t.key}
                        onClick={() => setTab(t.key)}
                        className={`flex-1 py-2 text-[9px] tracking-wider uppercase cursor-pointer border-none transition-all relative ${tab === t.key
                            ? "text-accent font-semibold bg-transparent tab-active"
                            : "text-dim hover:text-muted bg-transparent"
                            }`}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {/* Tab Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">

                {/* ─── RISK TAB ─── */}
                {tab === "risk" && config && (
                    <>
                        <div>
                            <p className="text-[9px] text-dim tracking-[0.15em] uppercase mb-2">Risk Mode</p>
                            <div className="flex items-center justify-between bg-bg/50 border border-border rounded-sm p-3">
                                <span className="text-[13px] text-text font-semibold capitalize">{config.riskProfile || "Medium"}</span>
                                <span className="text-[9px] text-accent border border-accent/20 px-1.5 py-0.5 rounded-sm font-semibold uppercase">Guarded</span>
                            </div>
                        </div>

                        <div>
                            <p className="text-[9px] text-dim tracking-[0.15em] uppercase mb-2">Limits</p>
                            <div className="space-y-3">
                                <div className="flex justify-between items-baseline">
                                    <span className="text-[10px] text-muted">Max SOL / tx</span>
                                    <span className="value-primary text-[15px]">{config.maxSolPerTx}</span>
                                </div>
                                <div className="flex justify-between items-baseline">
                                    <span className="text-[10px] text-muted">Daily Cap</span>
                                    <span className="text-[15px] font-mono font-semibold text-text">{config.dailyTxLimit} <span className="text-[9px] text-dim font-normal">tx</span></span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-[10px] text-muted">Role</span>
                                    <span className="text-[9px] font-semibold text-bg bg-accent px-2 py-0.5 rounded-sm capitalize">{config.role}</span>
                                </div>
                            </div>
                        </div>

                        <div>
                            <p className="text-[9px] text-dim tracking-[0.15em] uppercase mb-2">Actions</p>
                            <div className="flex flex-wrap gap-1.5">
                                {config.allowedActions?.map((a: string) => (
                                    <span key={a} className="text-[9px] font-mono text-muted border border-border px-2 py-1 rounded-sm">{a}</span>
                                ))}
                            </div>
                        </div>

                        <div>
                            <p className="text-[9px] text-dim tracking-[0.15em] uppercase mb-2">Security</p>
                            <div className="space-y-1.5 text-[10px]">
                                {["AES-GCM Encryption", "Simulation Guard", "Spend Cap", "Injection Guard"].map(s => (
                                    <div key={s} className="flex items-center gap-2">
                                        <span className="text-success-text text-[9px]">✓</span>
                                        <span className="text-muted">{s}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </>
                )}

                {/* ─── SCHEDULE TAB ─── */}
                {tab === "schedule" && (
                    <>
                        <div>
                            <p className="text-[9px] text-dim tracking-[0.15em] uppercase mb-2">Quick Schedule</p>
                            <div className="space-y-1.5">
                                {SCHEDULE_CMDS.map(cmd => (
                                    <button
                                        key={cmd}
                                        onClick={() => onScheduleCmd?.(cmd)}
                                        className="w-full text-left text-[10px] text-muted hover:text-accent px-3 py-2 border border-border rounded-sm cursor-pointer bg-transparent hover:border-accent/20 transition-all"
                                    >
                                        {cmd}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {liveSchedules.length > 0 && (
                            <div>
                                <p className="text-[9px] text-dim tracking-[0.15em] uppercase mb-2">Active Schedules</p>
                                <div className="space-y-1.5">
                                    {liveSchedules.map((s: any, i: number) => {
                                        const name = s.name || s.key || "";
                                        const action = s.data?.action || name.split("-")[1] || name;
                                        const cron = s.pattern || s.cron || s.opts?.repeat?.pattern || "";
                                        return (
                                            <div key={i} className="text-[10px] font-mono text-muted px-3 py-2 border border-border rounded-sm">
                                                <span className="text-accent">{action}</span> — <span className="text-dim">{cron}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </>
                )}

                {/* ─── HISTORY TAB ─── */}
                {tab === "history" && (
                    <div>
                        <p className="text-[9px] text-dim tracking-[0.15em] uppercase mb-2">Execution Audit</p>
                        {liveHistory.length === 0 ? (
                            <p className="text-[10px] text-dim italic">No execution history yet.</p>
                        ) : (
                            <div className="space-y-1.5">
                                {liveHistory.map((h: any, i: number) => (
                                    <div key={i} className="text-[10px] font-mono px-3 py-2 border border-border rounded-sm">
                                        <div className="flex justify-between">
                                            <span className={h.type === "success" ? "text-[#16C784]" : h.type === "failure" ? "text-[#FF6B6B]" : "text-accent"}>{h.action || h.type}</span>
                                            <span className="text-dim text-[8px]">
                                                {h.timestamp ? new Date(h.timestamp).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "—"}
                                            </span>
                                        </div>
                                        {h.detail && <p className="text-muted text-[9px] mt-0.5 truncate">{h.detail}</p>}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* ─── MEMORY TAB ─── */}
                {tab === "memory" && (
                    <div className="space-y-4">
                        {loadingMem ? (
                            <div className="space-y-2">
                                <div className="skeleton h-4 w-3/4" />
                                <div className="skeleton h-4 w-1/2" />
                                <div className="skeleton h-4 w-2/3" />
                            </div>
                        ) : memory ? (
                            <>
                                {/* Preferences */}
                                <div>
                                    <p className="text-[9px] text-dim tracking-[0.15em] uppercase mb-2">Preferences</p>
                                    {Object.keys(memory.preferences || {}).length === 0 ? (
                                        <p className="text-[10px] text-dim italic">No preferences set. Try: &quot;I prefer conservative strategies&quot;</p>
                                    ) : (
                                        <div className="space-y-1.5">
                                            {Object.entries(memory.preferences).map(([k, v]) => (
                                                <div key={k} className="flex justify-between text-[10px] px-3 py-2 border border-border rounded-sm">
                                                    <span className="text-muted capitalize">{k}</span>
                                                    <span className="text-text font-mono">{String(v)}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Notes */}
                                <div>
                                    <p className="text-[9px] text-dim tracking-[0.15em] uppercase mb-2">Notes</p>
                                    {(!memory.notes || memory.notes.length === 0) ? (
                                        <p className="text-[10px] text-dim italic">No notes. Try: &quot;Remember I don&#39;t like risky trades&quot;</p>
                                    ) : (
                                        <div className="space-y-1">
                                            {memory.notes.map((n: string, i: number) => (
                                                <div key={i} className="text-[10px] text-muted px-3 py-1.5 border-l-2 border-accent/20">
                                                    {n}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Recent Actions */}
                                <div>
                                    <p className="text-[9px] text-dim tracking-[0.15em] uppercase mb-2">Recent Actions</p>
                                    {(!memory.successfulActions || memory.successfulActions.length === 0) ? (
                                        <p className="text-[10px] text-dim italic">No action history.</p>
                                    ) : (
                                        <div className="space-y-1">
                                            {memory.successfulActions.slice(-5).reverse().map((a: any, i: number) => (
                                                <div key={i} className="flex items-center gap-2 text-[10px] px-3 py-1.5">
                                                    <span className="text-success-text text-[8px]">✓</span>
                                                    <span className="text-muted font-mono">{a.action}</span>
                                                    {a.detail && <span className="text-dim text-[9px] truncate flex-1">— {a.detail}</span>}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Wipe button */}
                                <button
                                    onClick={wipeMemory}
                                    className="w-full py-2 text-[9px] text-dim hover:text-danger-text border border-transparent hover:border-danger/15 rounded-sm cursor-pointer transition-all bg-transparent uppercase tracking-wider"
                                >
                                    Wipe Memory
                                </button>
                            </>
                        ) : (
                            <p className="text-[10px] text-dim italic">Select an agent to view memory.</p>
                        )}
                    </div>
                )}

                {/* ─── INFO TAB ─── */}
                {tab === "info" && (
                    <>
                        <div>
                            <p className="text-[9px] text-dim tracking-[0.15em] uppercase mb-2">Agent Wallet</p>
                            <div className="bg-bg/50 border border-border rounded-sm p-3 space-y-2">
                                <p className="text-[10px] font-mono text-muted break-all leading-relaxed">
                                    {agentAddress || "—"}
                                </p>
                                <p className="text-[9px] text-dim italic">Send SOL or any SPL token to this address to fund the agent.</p>
                                <button
                                    onClick={() => {
                                        if (agentAddress) {
                                            navigator.clipboard.writeText(agentAddress);
                                            setCopied(true);
                                            setTimeout(() => setCopied(false), 2000);
                                        }
                                    }}
                                    className="btn-execute w-full py-2 bg-accent/10 border border-accent/20 rounded-sm text-[10px] text-accent font-semibold cursor-pointer hover:bg-accent/15 transition-all uppercase tracking-wider"
                                >
                                    {copied ? "✓ Address Copied!" : "Copy Agent Address"}
                                </button>
                            </div>
                        </div>

                        <div>
                            <p className="text-[9px] text-dim tracking-[0.15em] uppercase mb-2">Network</p>
                            <div className="space-y-1.5 text-[10px]">
                                <div className="flex justify-between">
                                    <span className="text-muted">Cluster</span>
                                    <span className="text-warning-text font-mono">Devnet</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted">DEX</span>
                                    <span className="text-text font-mono">Orca Whirlpools</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted">Engine</span>
                                    <span className="text-text font-mono">DerMercist v1</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted">Tokens</span>
                                    <span className="text-accent font-mono">SOL + SPL</span>
                                </div>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

"use client";
import { useState } from "react";

interface AgentCreateModalProps {
    onClose: () => void;
    onCreate: (data: {
        id: string;
        role: string;
        maxSolPerTx: number;
        dailyTxLimit: number;
        allowedActions: string[];
    }) => void;
}

function TraderIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00e0ff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
        </svg>
    );
}

const ROLES = [
    { key: "trader", icon: "⚡", label: "Trader", desc: "Swap, transfer & scam detection", svgIcon: true },
    { key: "monitor", icon: "◉", label: "Monitor", desc: "Read-only scanning & safety checks" },
    { key: "recovery", icon: "⟲", label: "Recovery", desc: "Reclaim rent from empty accounts" },
    { key: "custom", icon: "◆", label: "Custom", desc: "Fully configurable" },
] as { key: string; icon: string; label: string; desc: string; svgIcon?: boolean }[];

const ROLE_DEFAULTS: Record<string, { maxSol: number; daily: number; actions: string[] }> = {
    trader: { maxSol: 0.5, daily: 10, actions: ["transfer", "swap", "scan_airdrops", "scam_check", "recover"] },
    monitor: { maxSol: 0, daily: 0, actions: ["scan_airdrops", "scam_check"] },
    recovery: { maxSol: 0.1, daily: 20, actions: ["recover", "transfer", "swap", "scam_check"] },
    custom: { maxSol: 1.0, daily: 5, actions: ["transfer", "swap", "recover", "scan_airdrops", "scam_check"] },
};

export default function AgentCreateModal({ onClose, onCreate }: AgentCreateModalProps) {
    const [name, setName] = useState("");
    const [role, setRole] = useState("trader");
    const defaults = ROLE_DEFAULTS[role];

    const handleCreate = () => {
        if (!name.trim()) return;
        onCreate({
            id: name.trim(),
            role,
            maxSolPerTx: defaults.maxSol,
            dailyTxLimit: defaults.daily,
            allowedActions: defaults.actions,
        });
    };

    return (
        <div
            className="modal-backdrop fixed inset-0 bg-black/60 flex items-center justify-center z-50 fade-in"
            onClick={onClose}
        >
            <div
                onClick={e => e.stopPropagation()}
                className="bg-panel border border-border rounded-lg w-[400px] max-w-[90vw] max-h-[85vh] overflow-auto shadow-2xl slide-up"
            >
                {/* Header */}
                <div className="p-5 border-b border-border">
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-accent shadow-[0_0_6px_rgba(0,224,255,0.4)]" />
                        <h3 className="text-sm font-semibold text-text">Deploy Agent</h3>
                    </div>
                    <p className="text-[10px] text-dim mt-1.5 pl-4">Configure role and execution parameters</p>
                </div>

                <div className="p-5 space-y-5">
                    {/* Name */}
                    <div>
                        <label className="text-[9px] text-dim tracking-[0.15em] uppercase block mb-2">Agent ID</label>
                        <input
                            value={name}
                            onChange={e => setName(e.target.value)}
                            onKeyDown={e => e.key === "Enter" && handleCreate()}
                            placeholder="e.g. TraderOne, Scout"
                            autoFocus
                            className="w-full bg-bg/80 border border-border rounded-sm px-4 py-2.5 text-[16px] md:text-[12px] font-mono text-text placeholder:text-dim focus:outline-none focus:border-accent/40 focus:shadow-[0_0_8px_rgba(0,224,255,0.06)] transition-all"
                        />
                    </div>

                    {/* Roles */}
                    <div>
                        <label className="text-[9px] text-dim tracking-[0.15em] uppercase block mb-2">Role</label>
                        <div className="grid grid-cols-2 gap-2">
                            {ROLES.map(r => (
                                <button
                                    key={r.key}
                                    onClick={() => setRole(r.key)}
                                    className={`card-hover p-3 rounded-sm border text-left cursor-pointer bg-transparent transition-all duration-200 ${role === r.key
                                        ? "border-accent/30 bg-accent/5 shadow-[0_0_12px_rgba(0,224,255,0.04)]"
                                        : "border-border"
                                        }`}
                                >
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm">{r.svgIcon ? <TraderIcon /> : r.icon}</span>
                                        <span className={`text-[11px] font-semibold ${role === r.key ? "text-accent" : "text-muted"}`}>
                                            {r.label}
                                        </span>
                                    </div>
                                </button>
                            ))}
                        </div>
                        <p className="text-[10px] text-dim mt-2 pl-1">
                            {ROLES.find(r => r.key === role)?.desc}
                        </p>
                    </div>

                    {/* Parameters */}
                    <div>
                        <label className="text-[9px] text-dim tracking-[0.15em] uppercase block mb-2">Parameters</label>
                        <div className="bg-bg/50 border border-border rounded-sm p-3 space-y-2">
                            <div className="flex justify-between items-baseline">
                                <span className="text-[10px] text-muted">Max SOL / tx</span>
                                <span className="value-primary text-[14px]">{defaults.maxSol}</span>
                            </div>
                            <div className="flex justify-between items-baseline">
                                <span className="text-[10px] text-muted">Daily limit</span>
                                <span className="text-[14px] font-mono font-semibold text-text">{defaults.daily} <span className="text-[10px] text-dim font-normal">tx</span></span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-[10px] text-muted">Actions</span>
                                <span className="text-[10px] font-mono text-muted">{defaults.actions.length} enabled</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="p-5 border-t border-border flex gap-3 justify-end">
                    <button
                        onClick={onClose}
                        className="px-5 py-2 text-[10px] text-dim border border-border rounded-sm hover:border-accent/20 hover:text-muted cursor-pointer bg-transparent transition-all uppercase tracking-wider"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleCreate}
                        disabled={!name.trim()}
                        className="btn-execute px-5 py-2 text-[10px] font-semibold bg-accent text-bg rounded-sm hover:bg-accent-hover cursor-pointer disabled:opacity-30 border-none uppercase tracking-wider"
                    >
                        Deploy Agent
                    </button>
                </div>
            </div>
        </div>
    );
}

"use client";
import { useState, useEffect, useRef } from "react";

interface CommandInputProps {
    onSend: (message: string) => void;
    loading?: boolean;
    allowedActions?: string[];
    pendingInput?: string;
    onPendingClear?: () => void;
}

const QUICK_ACTIONS = [
    { label: "Swap", cmd: "swap 0.05 SOL to devUSDC" },
    { label: "Transfer", cmd: "send 0.01 SOL to " },
    { label: "Airdrops", cmd: "scan airdrops" },
    { label: "Scam Check", cmd: "scam check all tokens" },
    { label: "Recover", cmd: "recover rent from empty accounts" },
    { label: "Balance", cmd: "what is my balance?" },
];

const PLACEHOLDERS = [
    'Try: "Swap 1 SOL for USDC and scan for scams"',
    'Try: "Airdrop me SOL and check my balance"',
    'Try: "Schedule scam check every 6 hours"',
    'Try: "Transfer 0.5 SOL to my hardware wallet"',
    'Try: "What can you do?"',
];

export default function CommandInput({ onSend, loading, allowedActions, pendingInput, onPendingClear }: CommandInputProps) {
    const [value, setValue] = useState("");
    const [placeholderIdx, setPlaceholderIdx] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (pendingInput) {
            setValue(pendingInput);
            onPendingClear?.();
            inputRef.current?.focus();
        }
    }, [pendingInput, onPendingClear]);

    // Rotate placeholder every 5 seconds
    useEffect(() => {
        const interval = setInterval(() => {
            setPlaceholderIdx(i => (i + 1) % PLACEHOLDERS.length);
        }, 5000);
        return () => clearInterval(interval);
    }, []);

    const handleSend = () => {
        if (!value.trim() || loading) return;
        onSend(value.trim());
        setValue("");
    };

    return (
        <div className="border-t border-border p-3 md:p-4 lg:p-5 bg-panel/90 backdrop-blur-sm">
            <div className="flex gap-2 md:gap-3">
                <div className="flex-1 relative">
                    <input
                        ref={inputRef}
                        value={value}
                        onChange={e => setValue(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && handleSend()}
                        placeholder={PLACEHOLDERS[placeholderIdx]}
                        disabled={loading}
                        className="w-full bg-bg/80 border border-border rounded-sm px-4 py-3 text-[12px] md:text-[13px] font-mono text-text placeholder:text-dim/60 placeholder:italic focus:outline-none focus:border-accent/40 focus:shadow-[0_0_12px_rgba(0,224,255,0.06)] transition-all duration-200 disabled:opacity-50"
                    />
                    {loading && (
                        <div className="absolute right-3 top-1/2 -translate-y-1/2">
                            <div className="w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
                        </div>
                    )}
                </div>
                <button
                    onClick={handleSend}
                    disabled={loading || !value.trim()}
                    className="btn-execute px-5 md:px-6 py-3 bg-accent rounded-sm text-[11px] md:text-[12px] font-semibold text-bg uppercase tracking-wider hover:bg-accent-hover transition-all disabled:opacity-30 disabled:shadow-none cursor-pointer border-none"
                >
                    {loading ? "···" : "Execute"}
                </button>
            </div>

            {/* Quick action chips — desktop only */}
            <div className="hidden md:flex flex-wrap gap-1.5 md:gap-2 mt-2.5 md:mt-3">
                {QUICK_ACTIONS.map(qa => (
                    <button
                        key={qa.label}
                        className="chip"
                        onClick={() => { setValue(qa.cmd); inputRef.current?.focus(); }}
                    >
                        {qa.label}
                    </button>
                ))}
            </div>
        </div>
    );
}

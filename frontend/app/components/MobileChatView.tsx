"use client";
import { useRef, useEffect, useState } from "react";
import ExecutionBlock, { type ExecutionBlockData } from "./ExecutionBlock";
import MobileActionSheet from "./MobileActionSheet";
import MobileSettingsDrawer from "./MobileSettingsDrawer";

interface MobileChatViewProps {
    agentName: string;
    agentAddress?: string;
    agentBalance?: number;
    agentConfig?: any;
    blocks: ExecutionBlockData[];
    parsing: boolean;
    parsingStep?: "analyzing" | "processing" | null;
    schedules?: any[];
    history?: any[];
    onBack: () => void;
    onSend: (cmd: string) => void;
    onScheduleCmd?: (cmd: string) => void;
}

const PLACEHOLDERS = [
    'Try: "Swap 1 SOL for USDC"',
    'Try: "What is my balance?"',
    'Try: "Scan for scams"',
    'Try: "Airdrop me SOL"',
];

export default function MobileChatView({
    agentName, agentAddress, agentBalance, agentConfig, blocks, parsing, parsingStep,
    schedules, history, onBack, onSend, onScheduleCmd,
}: MobileChatViewProps) {
    const endRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const [value, setValue] = useState("");
    const [showActions, setShowActions] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [placeholderIdx, setPlaceholderIdx] = useState(0);

    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [blocks, parsing]);

    useEffect(() => {
        const interval = setInterval(() => setPlaceholderIdx(i => (i + 1) % PLACEHOLDERS.length), 5000);
        return () => clearInterval(interval);
    }, []);

    const handleSend = () => {
        if (!value.trim() || parsing) return;
        onSend(value.trim());
        setValue("");
    };

    const handleAction = (cmd: string) => {
        setValue(cmd);
        inputRef.current?.focus();
    };

    return (
        <div className="h-screen bg-bg flex flex-col">
            {/* Header */}
            <div className="px-4 py-3 border-b border-border bg-panel/95 backdrop-blur-sm flex items-center gap-3">
                <button onClick={onBack} className="text-[16px] text-muted hover:text-text cursor-pointer bg-transparent border-none px-1">
                    ←
                </button>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="text-[14px] font-semibold text-text truncate">{agentName}</span>
                        <span className="status-dot online" style={{ width: 5, height: 5 }} />
                    </div>
                    <p className="text-[9px] text-dim font-mono truncate">{agentAddress?.slice(0, 12)}···</p>
                </div>
                <button
                    onClick={() => setShowSettings(true)}
                    className="text-[18px] text-dim hover:text-text cursor-pointer bg-transparent border-none px-1"
                >
                    ⚙
                </button>
            </div>

            {/* Chat Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-5 grid-bg">
                {blocks.length === 0 && !parsing && (
                    <div className="flex items-center justify-center h-full">
                        <div className="text-center slide-up">
                            <p className="text-[14px] text-text font-medium mb-1">Ask your agent to do something</p>
                            <p className="text-[11px] text-dim">Swap tokens, transfer SOL or SPL tokens, scan for scams, and more.</p>
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

            {/* Actions + Input */}
            <div className="border-t border-border bg-panel/95 backdrop-blur-sm">
                {/* Action trigger */}
                <div className="px-4 pt-2.5 pb-1">
                    <button
                        onClick={() => setShowActions(true)}
                        className="text-[10px] text-accent font-semibold border border-accent/20 rounded-sm px-3 py-1.5 cursor-pointer bg-transparent uppercase tracking-wider active:bg-accent/5 transition-colors"
                    >
                        + Actions
                    </button>
                </div>

                {/* Input */}
                <div className="flex gap-2 px-4 pb-3 pt-1">
                    <input
                        ref={inputRef}
                        value={value}
                        onChange={e => setValue(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && handleSend()}
                        placeholder={PLACEHOLDERS[placeholderIdx]}
                        disabled={parsing}
                        className="flex-1 bg-bg/80 border border-border rounded-sm px-3 py-2.5 text-[16px] font-mono text-text placeholder:text-dim/60 placeholder:italic focus:outline-none focus:border-accent/40 transition-all disabled:opacity-50"
                    />
                    <button
                        onClick={handleSend}
                        disabled={parsing || !value.trim()}
                        className="btn-execute px-4 py-2.5 bg-accent rounded-sm text-[11px] font-semibold text-bg uppercase tracking-wider hover:bg-accent-hover transition-all disabled:opacity-30 cursor-pointer border-none"
                    >
                        {parsing ? "···" : "▶"}
                    </button>
                </div>
            </div>

            {/* Action Sheet */}
            <MobileActionSheet open={showActions} onClose={() => setShowActions(false)} onAction={handleAction} />

            {/* Settings Drawer */}
            <MobileSettingsDrawer
                open={showSettings}
                onClose={() => setShowSettings(false)}
                agentName={agentName}
                agentAddress={agentAddress}
                config={agentConfig}
                schedules={schedules}
                history={history}
                onScheduleCmd={onScheduleCmd}
            />
        </div>
    );
}

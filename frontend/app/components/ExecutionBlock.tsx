"use client";
import { useState } from "react";

type BlockType = "intent" | "parsed" | "simulation" | "warning" | "success" | "error" | "system";

// Subtle background shifts instead of hard borders
const blockBg: Record<BlockType, string> = {
    intent: "bg-transparent",                           // User messages: no bg
    parsed: "bg-white/[0.03]",                          // Agent parsed: barely visible
    simulation: "bg-white/[0.02]",
    warning: "bg-[#F5A524]/[0.04]",                     // Warm subtle glow
    success: "bg-[#16C784]/[0.04]",                     // Green subtle glow
    error: "bg-[#FF6B6B]/[0.04]",                       // Red subtle glow
    system: "bg-white/[0.03]",                          // Agent response
};

// Thin left accent — only 2px, subtle
const accentBorder: Record<BlockType, string> = {
    intent: "",                                          // No border on user messages
    parsed: "border-l-2 border-[#00E0FF]/40",
    simulation: "border-l-2 border-[#8B949E]/30",
    warning: "border-l-2 border-[#F5A524]/40",
    success: "border-l-2 border-[#16C784]/40",
    error: "border-l-2 border-[#FF6B6B]/40",
    system: "border-l-2 border-[#484F58]/30",
};

// Dimmed header colors — metadata, not the main event
const labelColor: Record<BlockType, string> = {
    intent: "text-[#484F58]",
    parsed: "text-[#00E0FF]/50",
    simulation: "text-[#8B949E]/50",
    warning: "text-[#F5A524]/60",
    success: "text-[#16C784]/60",
    error: "text-[#FF6B6B]/60",
    system: "text-[#484F58]",
};

// Small inline icons — whisper, not shout
const typeIcons: Record<BlockType, string> = {
    intent: "→",
    parsed: "⎔",
    simulation: "◇",
    warning: "△",
    success: "✓",
    error: "✕",
    system: "◌",
};

export interface ExecutionBlockData {
    id: string;
    type: BlockType;
    label: string;
    content: string;
    timestamp: number;
    details?: string;
    confidence?: number;
    badge?: string;
}

// Detect if text is "data" (addresses, hashes, JSON) vs conversational
function isDataText(text: string): boolean {
    // Solana addresses, tx hashes, hex, JSON-like
    return /^[A-HJ-NP-Za-km-z1-9]{32,}$/.test(text.trim()) ||
        text.includes("Tx:") ||
        text.includes("Pool:") ||
        text.includes("Route:") ||
        text.startsWith("{") ||
        text.startsWith("[");
}

export default function ExecutionBlock({ block }: { block: ExecutionBlockData }) {
    const [expanded, setExpanded] = useState(false);

    const isUser = block.type === "intent";

    // User messages: right-aligned bubble
    if (isUser) {
        return (
            <div className="flex justify-end block-enter">
                <div className="max-w-[80%] bg-[#00E0FF]/[0.07] rounded-2xl rounded-br-sm px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1.5 mb-1">
                        <span className="text-[8px] text-[#484F58] font-mono tabular-nums">
                            {new Date(block.timestamp).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                        </span>
                    </div>
                    <p className="text-[13px] leading-relaxed text-[#E6EDF3] font-medium m-0"
                        style={{ fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif" }}>
                        {block.content}
                    </p>
                </div>
            </div>
        );
    }

    // Agent / system messages: left-aligned
    // Detect Solana addresses/tx hashes and render as clickable explorer links
    function renderContent(text: string) {
        const parts = text.split(/([1-9A-HJ-NP-Za-km-z]{32,88})/g);
        if (parts.length === 1) return text;

        return parts.map((part, i) => {
            if (/^[1-9A-HJ-NP-Za-km-z]{32,88}$/.test(part)) {
                const isLikelyTx = part.length > 60;
                const url = isLikelyTx
                    ? `https://explorer.solana.com/tx/${part}?cluster=devnet`
                    : `https://explorer.solana.com/address/${part}?cluster=devnet`;
                const display = `${part.slice(0, 8)}···${part.slice(-4)}`;
                return (
                    <a
                        key={i}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#00E0FF] hover:underline font-mono text-[11px] inline-flex items-center gap-0.5"
                        title={part}
                    >
                        {display} <span className="text-[9px] opacity-60">↗</span>
                    </a>
                );
            }
            return part;
        });
    }

    return (
        <div className={`${blockBg[block.type]} ${accentBorder[block.type]} rounded-md px-4 py-3 block-enter`}>
            {/* Header: small icon + dimmed label + time — metadata row */}
            <div className="flex items-center gap-1.5 mb-1.5">
                <span className={`text-[9px] ${labelColor[block.type]}`}>{typeIcons[block.type]}</span>
                <span className={`text-[9px] tracking-[0.12em] uppercase ${labelColor[block.type]}`}>
                    {block.label}
                </span>
                <span className="flex-1" />
                <span className="text-[8px] text-[#484F58] font-mono tabular-nums">
                    {new Date(block.timestamp).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </span>
            </div>

            {/* Badge — subtle pill */}
            {block.badge && (
                <div className="mb-2 inline-flex items-center gap-1.5 px-2 py-0.5 bg-[#00E0FF]/[0.06] border border-[#00E0FF]/10 rounded-full">
                    <span className="w-1 h-1 rounded-full bg-[#00E0FF]" />
                    <span className="text-[9px] text-[#00E0FF]/80 font-mono">{block.badge}</span>
                </div>
            )}

            {/* Content — sans-serif for conversation, mono only for data */}
            <div className={`text-[13px] leading-relaxed text-[#E6EDF3]/90 whitespace-pre-wrap break-all ${isUser ? "font-medium" : ""}`}
                style={{ fontFamily: isDataText(block.content) ? "'JetBrains Mono', 'Fira Code', monospace" : "'Inter', 'Segoe UI', system-ui, sans-serif" }}>
                {renderContent(block.content)}
            </div>

            {/* Confidence bar — slimmer */}
            {block.confidence !== undefined && (
                <div className="mt-3">
                    <div className="flex items-center justify-between mb-1">
                        <span className="text-[8px] text-[#484F58] tracking-wider uppercase">Confidence</span>
                        <span className={`text-[10px] font-mono font-semibold ${block.confidence >= 80 ? "text-[#16C784]" :
                            block.confidence >= 50 ? "text-[#F5A524]" : "text-[#FF6B6B]"
                            }`}>{block.confidence}%</span>
                    </div>
                    <div className="h-[3px] bg-[#1F2732] rounded-full overflow-hidden">
                        <div
                            className="h-full rounded-full transition-all duration-1000 ease-out"
                            style={{
                                width: `${block.confidence}%`,
                                background: block.confidence >= 80
                                    ? "linear-gradient(90deg, #16C784, #4ADE80)"
                                    : block.confidence >= 50
                                        ? "linear-gradient(90deg, #F5A524, #FBBF24)"
                                        : "linear-gradient(90deg, #B91C1C, #FF6B6B)",
                            }}
                        />
                    </div>
                </div>
            )}

            {/* Details expand — cleaner */}
            {block.details && (
                <div className="mt-2">
                    <button
                        onClick={() => setExpanded(!expanded)}
                        className="text-[9px] text-[#8B949E]/60 hover:text-[#8B949E] cursor-pointer bg-transparent border-none transition-colors uppercase tracking-wider"
                    >
                        {expanded ? "▾ Hide details" : "▸ Details"}
                    </button>
                    {expanded && (
                        <pre className="mt-1.5 text-[10px] font-mono text-[#8B949E] leading-relaxed whitespace-pre-wrap m-0">
                            {block.details}
                        </pre>
                    )}
                </div>
            )}
        </div>
    );
}

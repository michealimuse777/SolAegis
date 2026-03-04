"use client";

interface MobileActionSheetProps {
    open: boolean;
    onClose: () => void;
    onAction: (cmd: string) => void;
}

const ACTIONS = [
    { icon: "⇄", label: "Swap", cmd: "swap 0.05 SOL to devUSDC", desc: "Trade tokens via Orca" },
    { icon: "→", label: "Transfer", cmd: "send 0.01 SOL to ", desc: "Send SOL to address" },
    { icon: "◎", label: "Airdrop", cmd: "airdrop", desc: "Request Devnet SOL" },
    { icon: "◇", label: "Scan Airdrops", cmd: "scan airdrops", desc: "Check for claimable tokens" },
    { icon: "△", label: "Scam Check", cmd: "scam check all tokens", desc: "Safety scan your portfolio" },
    { icon: "⟲", label: "Recover", cmd: "recover rent from empty accounts", desc: "Reclaim rent SOL" },
    { icon: "◉", label: "Balance", cmd: "what is my balance?", desc: "Check wallet status" },
];

export default function MobileActionSheet({ open, onClose, onAction }: MobileActionSheetProps) {
    if (!open) return null;

    return (
        <div className="fixed inset-0 z-50 fade-in" onClick={onClose}>
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

            {/* Sheet */}
            <div
                className="absolute bottom-0 left-0 right-0 bg-panel border-t border-border rounded-t-xl slide-up"
                onClick={e => e.stopPropagation()}
            >
                {/* Handle */}
                <div className="flex justify-center py-2.5">
                    <div className="w-8 h-1 rounded-full bg-border" />
                </div>

                <p className="px-5 pb-2 text-[9px] text-dim tracking-[0.15em] uppercase">Quick Actions</p>

                <div className="px-4 pb-6 space-y-0.5">
                    {ACTIONS.map(a => (
                        <button
                            key={a.label}
                            onClick={() => { onAction(a.cmd); onClose(); }}
                            className="w-full flex items-center gap-3.5 px-4 py-3.5 rounded-sm cursor-pointer bg-transparent border-none text-left active:bg-elevated/50 transition-colors"
                        >
                            <span className="w-8 h-8 rounded-sm bg-elevated flex items-center justify-center text-[14px] text-accent flex-shrink-0">
                                {a.icon}
                            </span>
                            <div className="flex-1">
                                <span className="text-[13px] text-text font-medium block">{a.label}</span>
                                <span className="text-[10px] text-dim">{a.desc}</span>
                            </div>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}

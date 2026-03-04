"use client";
import { useState, useEffect, useCallback } from "react";
import Sidebar from "./components/Sidebar";
import ExecutionStream from "./components/ExecutionStream";
import RiskPanel from "./components/RiskPanel";
import CommandInput from "./components/CommandInput";
import AgentCreateModal from "./components/AgentCreateModal";
import MobileAgentList from "./components/MobileAgentList";
import MobileChatView from "./components/MobileChatView";
import type { ExecutionBlockData } from "./components/ExecutionBlock";

const API = "http://localhost:4000";

// ─────────── Types ───────────

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

// ─────────── Helpers ───────────

function makeHeader(token: string | null): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

let blockCounter = 0;
function newBlock(
  type: ExecutionBlockData["type"],
  label: string,
  content: string,
  extras?: Partial<ExecutionBlockData>,
): ExecutionBlockData {
  return {
    id: `b-${++blockCounter}-${Date.now()}`,
    type,
    label,
    content,
    timestamp: Date.now(),
    ...extras,
  };
}

// ─────────── Main Page ───────────

export default function Home() {
  // Auth state
  const [token, setToken] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState<string>("");
  const [connecting, setConnecting] = useState(false);

  // Agent state
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Execution stream state — per-agent
  const [agentBlocks, setAgentBlocks] = useState<Record<string, ExecutionBlockData[]>>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("solaegis_blocks");
        return saved ? JSON.parse(saved) : {};
      } catch { return {}; }
    }
    return {};
  });
  const [parsing, setParsing] = useState(false);
  const [parsingStep, setParsingStep] = useState<"analyzing" | "processing" | null>(null);
  const [pendingInput, setPendingInput] = useState("");
  const [showPanel, setShowPanel] = useState(true);      // Desktop right panel
  const [showMobilePanel, setShowMobilePanel] = useState(false); // Mobile bottom sheet
  const [isMobile, setIsMobile] = useState(false);

  // Viewport detection
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Schedule + history state
  const [schedules, setSchedules] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);

  // Persist blocks to localStorage
  useEffect(() => {
    try { localStorage.setItem("solaegis_blocks", JSON.stringify(agentBlocks)); } catch { }
  }, [agentBlocks]);

  // ─── Init: restore session ───
  useEffect(() => {
    const t = localStorage.getItem("solaegis_token");
    const w = localStorage.getItem("solaegis_wallet");
    if (t) { setToken(t); setWalletAddress(w || ""); }
  }, []);

  // ─── Fetch agents when authed ───
  const fetchAgents = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API}/api/agents`, { headers: makeHeader(token) });
      if (res.ok) {
        const data = await res.json();
        setAgents(Array.isArray(data) ? data : []);
      }
    } catch { /* silent */ }
  }, [token]);

  useEffect(() => {
    if (token) fetchAgents();
  }, [token, fetchAgents]);

  // ─── Fetch schedules for selected agent ───
  const fetchSchedules = useCallback(async () => {
    if (!token || !selectedAgent) return;
    try {
      const res = await fetch(`${API}/api/cron/jobs`, { headers: makeHeader(token) });
      if (res.ok) {
        const data = await res.json();
        const agentJobs = (Array.isArray(data) ? data : []).filter(
          (j: any) => j.name?.startsWith(selectedAgent)
        );
        setSchedules(agentJobs);
      }
    } catch { setSchedules([]); }
  }, [token, selectedAgent]);

  useEffect(() => {
    if (selectedAgent) {
      fetchSchedules();
      fetchHistory();
    }
  }, [selectedAgent, fetchSchedules]);

  // ─── Fetch audit history for selected agent ───
  const fetchHistory = useCallback(async () => {
    if (!token || !selectedAgent) return;
    try {
      const res = await fetch(`${API}/api/audit?agentId=${selectedAgent}&limit=20`, { headers: makeHeader(token) });
      if (res.ok) {
        const data = await res.json();
        setHistory(Array.isArray(data) ? data : []);
      }
    } catch { setHistory([]); }
  }, [token, selectedAgent]);

  // ─── Wallet Connect ───
  const connectWallet = async () => {
    const solana = (window as any).solana;
    if (!solana?.isPhantom) {
      alert("Phantom wallet not found. Please install it.");
      return;
    }
    setConnecting(true);
    try {
      const resp = await solana.connect();
      const pubkey = resp.publicKey.toString();

      // 1. Request nonce
      const nonceRes = await fetch(`${API}/api/auth/wallet/nonce`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: pubkey }),
      });
      const nonceData = await nonceRes.json();
      const nonce = nonceData.nonce;
      const nonceMessage = nonceData.message || nonce;

      // 2. Sign the nonce message
      const encoded = new TextEncoder().encode(nonceMessage);
      const signResult = await solana.signMessage(encoded, "utf8");
      const sigBytes = signResult.signature;

      // Convert signature bytes to base58 string
      const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
      function toBase58(bytes: Uint8Array): string {
        const digits = [0];
        for (const byte of bytes) {
          let carry = byte;
          for (let i = 0; i < digits.length; i++) {
            carry += digits[i] << 8;
            digits[i] = carry % 58;
            carry = (carry / 58) | 0;
          }
          while (carry > 0) { digits.push(carry % 58); carry = (carry / 58) | 0; }
        }
        let str = "";
        for (const byte of bytes) { if (byte === 0) str += ALPHABET[0]; else break; }
        for (let i = digits.length - 1; i >= 0; i--) str += ALPHABET[digits[i]];
        return str;
      }
      const sigBase58 = toBase58(new Uint8Array(sigBytes));

      // 3. Verify with backend
      const verifyRes = await fetch(`${API}/api/auth/wallet/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: pubkey, signature: sigBase58, message: nonceMessage }),
      });
      const data = await verifyRes.json();

      if (data.token) {
        setToken(data.token);
        setWalletAddress(pubkey);
        localStorage.setItem("solaegis_token", data.token);
        localStorage.setItem("solaegis_wallet", pubkey);
        localStorage.setItem("solaegis_userId", data.userId || pubkey);
      }
    } catch (err: any) {
      console.error("Wallet connect failed:", err);
    }
    setConnecting(false);
  };

  const disconnect = () => {
    try { (window as any).solana?.disconnect(); } catch { /* ok */ }
    setToken(null);
    setWalletAddress("");
    setAgents([]);
    setSelectedAgent(null);
    // Don't clear agentBlocks — they persist in localStorage
    localStorage.removeItem("solaegis_token");
    localStorage.removeItem("solaegis_wallet");
    localStorage.removeItem("solaegis_userId");
  };

  // ─── Agent operations ───
  const createAgent = async (data: {
    id: string; role: string; maxSolPerTx: number; dailyTxLimit: number; allowedActions: string[];
  }) => {
    try {
      const res = await fetch(`${API}/api/agents`, {
        method: "POST",
        headers: makeHeader(token),
        body: JSON.stringify(data),
      });
      if (res.ok) {
        setShowCreateModal(false);
        // Add deploy block directly to new agent's stream (not stale selectedAgent)
        setAgentBlocks(prev => ({
          ...prev,
          [data.id]: [newBlock("success", "AGENT DEPLOYED", `Agent "${data.id}" created with role: ${data.role}`)],
        }));
        setSelectedAgent(data.id);
        fetchAgents();
      } else {
        const err = await res.json();
        addBlock("error", "DEPLOY FAILED", err.error || "Failed to create agent");
      }
    } catch { /* silent */ }
  };

  const deleteAgent = async (id: string) => {
    if (!confirm(`Remove agent "${id}"? This cannot be undone.`)) return;
    try {
      await fetch(`${API}/api/agents/${id}`, {
        method: "DELETE",
        headers: makeHeader(token),
      });
      if (selectedAgent === id) setSelectedAgent(null);
      fetchAgents();
      addBlock("system", "AGENT REMOVED", `Agent "${id}" has been permanently deleted.`);
    } catch { /* silent */ }
  };

  // ─── Add block helper (per-agent) ───
  const addBlock = (
    type: ExecutionBlockData["type"],
    label: string,
    content: string,
    extras?: Partial<ExecutionBlockData>,
  ) => {
    if (!selectedAgent) return;
    const agentId = selectedAgent;
    setAgentBlocks(prev => ({
      ...prev,
      [agentId]: [...(prev[agentId] || []), newBlock(type, label, content, extras)],
    }));
  };

  // ─── Send command ───
  const sendCommand = async (message: string) => {
    if (!selectedAgent || !token) return;

    addBlock("intent", "USER INTENT", message);
    setParsing(true);
    setParsingStep("analyzing");

    try {
      const res = await fetch(`${API}/api/agents/${selectedAgent}/chat`, {
        method: "POST",
        headers: makeHeader(token),
        body: JSON.stringify({ message }),
      });

      // Transition to "processing" step — hold for 800ms so user sees it
      setParsingStep("processing");
      const data = await res.json();
      await new Promise(r => setTimeout(r, 800));

      setParsing(false);
      setParsingStep(null);

      const intent = data.intent || data.intents?.[0];
      const rawReply = data.reply || data.error || "";

      // Helper: turn any reply into clean text (strip JSON & markdown)
      const formatReply = (r: string): string => {
        if (!r) return "No response";
        try {
          const parsed = JSON.parse(r);
          if (parsed.action === "hold") return parsed.reason || "System is on hold — LLM keys may be exhausted.";
          if (parsed.reason) return parsed.reason;
          if (parsed.error) return parsed.error;
          if (parsed.message) return parsed.message;
          return Object.entries(parsed)
            .filter(([, v]) => v !== null && v !== undefined)
            .map(([k, v]) => `${k}: ${v}`)
            .join("\n");
        } catch {
          // Strip markdown bold markers and unescape newlines
          return r
            .replace(/\*\*/g, "")
            .replace(/\\n/g, "\n")
            .replace(/^\s*-\s/gm, "• ")
            .trim();
        }
      };

      const reply = formatReply(rawReply);

      // Refresh agent data (non-blocking — don't delay response)
      fetch(`${API}/api/agents`, { headers: makeHeader(token) })
        .then(r => r.json())
        .then(list => { if (Array.isArray(list)) setAgents(list); })
        .catch(() => { });

      // Check for hold/fallback first
      if (rawReply.includes('"action":"hold"') || rawReply.includes('"action": "hold"')) {
        addBlock("warning", "SYSTEM HOLD", "LLM keys exhausted. Deterministic fallback active.\n\nTry explicit commands like:\n• swap 0.05 SOL to devUSDC\n• send 0.01 SOL to <address>\n• scan airdrops\n• what is my balance?");
        return;
      }

      if (intent?.type === "execute_action" && intent.action) {
        addBlock("parsed", "INTENT PARSED", [
          `Action: ${intent.action}`,
          intent.params ? Object.entries(intent.params).map(([k, v]) => `${k}: ${v}`).join(", ") : null,
          `Risk: ${agents.find(a => a.id === selectedAgent)?.config?.riskProfile || "—"}`,
        ].filter(Boolean).join("\n"), {
          badge: `${intent.action}${intent.action === "swap" ? " → Orca" : ""}`,
        });

        if (data.executionResult?.success) {
          const er = data.executionResult;
          const details = [
            er.signature ? `Tx: ${er.signature}` : null,
            er.pool ? `Pool: ${er.pool}` : null,
            er.route ? `Route: ${er.route}` : null,
          ].filter(Boolean).join("\n");

          addBlock("success", "EXECUTION CONFIRMED", reply, {
            details: details || undefined,
            confidence: 92,
          });
        } else if (reply.includes("denied") || reply.includes("⛔")) {
          addBlock("error", "BLOCKED", reply);
        } else {
          addBlock("success", "RESULT", reply, { confidence: 88 });
        }
      } else if (intent?.type === "schedule" || intent?.type === "unschedule") {
        addBlock("parsed", "SCHEDULE", `Action: ${intent.action}\nInterval: ${intent.interval || "—"}`, {
          badge: intent.type,
        });
        addBlock("success", "SCHEDULE UPDATED", reply);
      } else if (intent?.type === "unschedule") {
        addBlock("success", "SCHEDULE REMOVED", reply);
      } else if (intent?.type === "query_balance") {
        addBlock("system", "WALLET BALANCE", reply);
      } else if (intent?.type === "query_status") {
        addBlock("system", "AGENT STATUS", reply);
      } else if (intent?.type === "explain") {
        addBlock("system", "CAPABILITIES", reply);
      } else if (intent?.type === "update_config") {
        addBlock("success", "CONFIG UPDATED", reply);
      } else if (reply.includes("denied") || reply.includes("⛔")) {
        addBlock("error", "BLOCKED", reply);
      } else {
        addBlock("system", "RESPONSE", reply);
      }
    } catch (err: any) {
      setParsing(false);
      addBlock("error", "FAILED", err.message || "Network error");
    }
  };

  // ─── Derived state ───
  const selectedAgentData = agents.find(a => a.id === selectedAgent);
  const currentBlocks = selectedAgent ? (agentBlocks[selectedAgent] || []) : [];

  // ═══════════════════════════════════════
  //  RENDER: Login Screen
  // ═══════════════════════════════════════
  if (!token) {
    return (
      <div className="h-screen bg-bg grid-bg flex items-center justify-center">
        <div className="text-center space-y-8 slide-up">
          {/* Branding */}
          <div>
            <div className="flex items-center justify-center gap-2.5 mb-2">
              <div className="w-2.5 h-2.5 rounded-full bg-accent shadow-[0_0_12px_rgba(0,224,255,0.5)]" />
              <h1 className="text-2xl font-semibold text-text tracking-tight">SolAegis</h1>
            </div>
            <p className="text-[10px] text-dim tracking-[0.25em] uppercase">
              Autonomous Execution Infrastructure
            </p>
          </div>

          {/* Divider */}
          <div className="w-8 h-px bg-gradient-to-r from-transparent via-accent/30 to-transparent mx-auto" />

          {/* Connect */}
          <button
            onClick={connectWallet}
            disabled={connecting}
            className="btn-execute px-10 py-3.5 bg-accent text-bg text-[12px] font-semibold rounded-sm hover:bg-accent-hover transition-all uppercase tracking-wider disabled:opacity-50 cursor-pointer border-none"
          >
            {connecting ? (
              <span className="flex items-center gap-2">
                <div className="w-3.5 h-3.5 border-2 border-bg/30 border-t-bg rounded-full animate-spin" />
                Connecting
              </span>
            ) : "Connect Wallet"}
          </button>

          {/* Trust badges */}
          <div className="flex items-center justify-center gap-4 text-[9px] text-dim tracking-wider uppercase">
            <span>Ed25519 Auth</span>
            <span className="text-border">·</span>
            <span>Policy Guarded</span>
            <span className="text-border">·</span>
            <span>No Passwords</span>
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════
  //  RENDER: Mobile Layout
  // ═══════════════════════════════════════
  if (isMobile) {
    // Mobile: Agent List (no agent selected) or Chat View (agent selected)
    if (!selectedAgent) {
      return (
        <>
          <MobileAgentList
            agents={agents}
            agentBlocks={agentBlocks}
            onSelectAgent={setSelectedAgent}
            onNewAgent={() => setShowCreateModal(true)}
            walletAddress={walletAddress}
            onDisconnect={disconnect}
          />
          {showCreateModal && (
            <AgentCreateModal
              onClose={() => setShowCreateModal(false)}
              onCreate={createAgent}
            />
          )}
        </>
      );
    }

    return (
      <>
        <MobileChatView
          agentName={selectedAgentData?.id || selectedAgent}
          agentAddress={selectedAgentData?.publicKey}
          agentBalance={selectedAgentData?.balance}
          agentConfig={selectedAgentData?.config}
          blocks={currentBlocks}
          parsing={parsing}
          parsingStep={parsingStep}
          schedules={schedules}
          history={history}
          onBack={() => setSelectedAgent(null)}
          onSend={sendCommand}
          onScheduleCmd={(cmd: string) => sendCommand(cmd)}
        />
        {showCreateModal && (
          <AgentCreateModal
            onClose={() => setShowCreateModal(false)}
            onCreate={createAgent}
          />
        )}
      </>
    );
  }

  // ═══════════════════════════════════════
  //  RENDER: Desktop Execution Console
  // ═══════════════════════════════════════
  return (
    <div className="flex flex-row h-screen bg-bg">
      {/* LEFT: Sidebar */}
      <Sidebar
        agents={agents}
        selectedAgent={selectedAgent}
        onSelectAgent={setSelectedAgent}
        onDeleteAgent={deleteAgent}
        onNewAgent={() => setShowCreateModal(true)}
        walletAddress={walletAddress}
        onDisconnect={disconnect}
      />

      {/* CENTER: Execution Stream + Command Input */}
      <div className="flex flex-col flex-1 min-w-0">
        <ExecutionStream
          blocks={currentBlocks}
          agentName={selectedAgentData?.id}
          agentRole={selectedAgentData?.config?.role}
          parsing={parsing}
          parsingStep={parsingStep}
          onTogglePanel={() => setShowPanel(p => !p)}
          showPanel={showPanel}
        />
        <CommandInput
          onSend={sendCommand}
          loading={parsing}
          allowedActions={selectedAgentData?.config?.allowedActions}
          pendingInput={pendingInput}
          onPendingClear={() => setPendingInput("")}
        />
      </div>

      {/* RIGHT: Risk Panel */}
      {showPanel && (
        <RiskPanel
          config={selectedAgentData?.config}
          agentName={selectedAgentData?.id}
          agentAddress={selectedAgentData?.publicKey}
          schedules={schedules}
          history={history}
          onScheduleCmd={(cmd: string) => setPendingInput(cmd)}
        />
      )}

      {/* Modal */}
      {showCreateModal && (
        <AgentCreateModal
          onClose={() => setShowCreateModal(false)}
          onCreate={createAgent}
        />
      )}
    </div>
  );
}

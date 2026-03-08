"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import Sidebar from "./components/Sidebar";
import ExecutionStream from "./components/ExecutionStream";
import RiskPanel from "./components/RiskPanel";
import CommandInput from "./components/CommandInput";
import AgentCreateModal from "./components/AgentCreateModal";
import MobileAgentList from "./components/MobileAgentList";
import MobileChatView from "./components/MobileChatView";
import MultiAgentDemo from "./components/MultiAgentDemo";
import type { ExecutionBlockData } from "./components/ExecutionBlock";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

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
          (j: any) => j.name?.includes(selectedAgent) || j.key?.includes(selectedAgent)
        );
        setSchedules(agentJobs);
      }
    } catch { setSchedules([]); }
  }, [token, selectedAgent]);

  // ─── Fetch audit history for selected agent ───
  const fetchHistory = useCallback(async () => {
    if (!token || !selectedAgent) return;
    try {
      const res = await fetch(`${API}/api/agents/${encodeURIComponent(selectedAgent)}/audit`, { headers: makeHeader(token) });
      if (res.ok) {
        const data = await res.json();
        setHistory(Array.isArray(data) ? data.map((e: any) => ({
          type: e.status === "success" ? "success" : e.status === "denied" ? "denied" : "failure",
          action: e.action,
          detail: e.txSignature ? `Tx: ${e.txSignature.slice(0, 12)}...` : e.reason || "completed",
          timestamp: e.timestamp || Date.now(),
        })) : []);
      }
    } catch { setHistory([]); }
  }, [token, selectedAgent]);

  // Fetch on agent selection + auto-poll every 10s
  useEffect(() => {
    if (!selectedAgent) return;
    fetchSchedules();
    fetchHistory();
    const interval = setInterval(() => {
      fetchSchedules();
      fetchHistory();
    }, 10_000);
    return () => clearInterval(interval);
  }, [selectedAgent, fetchSchedules, fetchHistory]);

  // ─── Wallet Connect ───
  const connectWallet = async () => {
    // Detect available Solana wallets
    const win = window as any;
    const wallets: { name: string; provider: any }[] = [];

    if (win.phantom?.solana) wallets.push({ name: "Phantom", provider: win.phantom.solana });
    else if (win.solana?.isPhantom) wallets.push({ name: "Phantom", provider: win.solana });

    if (win.solflare?.isSolflare) wallets.push({ name: "Solflare", provider: win.solflare });
    if (win.backpack?.isBackpack) wallets.push({ name: "Backpack", provider: win.backpack });
    // Generic fallback: any wallet injecting window.solana (Slope, Coin98, etc.)
    if (win.solana && !win.solana.isPhantom && wallets.length === 0) {
      wallets.push({ name: "Solana Wallet", provider: win.solana });
    }

    if (wallets.length === 0) {
      alert("No Solana wallet found. Please install Phantom, Solflare, or Backpack.");
      return;
    }

    // If multiple wallets, let user pick; otherwise use the only one
    let wallet = wallets[0];
    if (wallets.length > 1) {
      const choice = prompt(
        `Multiple wallets detected. Enter number to connect:\n${wallets.map((w, i) => `${i + 1}. ${w.name}`).join("\n")}`
      );
      const idx = parseInt(choice || "1", 10) - 1;
      if (idx >= 0 && idx < wallets.length) wallet = wallets[idx];
    }

    setConnecting(true);
    try {
      const resp = await wallet.provider.connect();
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
      const signResult = await wallet.provider.signMessage(encoded, "utf8");
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
      } else {
        console.error("Auth failed — no token in response:", data);
        alert(data.error || "Authentication failed. Please try again.");
      }
    } catch (err: any) {
      console.error("Wallet connect failed:", err);
      alert("Connection error: " + (err.message || "Network request failed. Check console for details."));
    }
    setConnecting(false);
  };

  const disconnect = () => {
    try {
      const win = window as any;
      win.phantom?.solana?.disconnect();
      win.solflare?.disconnect();
      win.backpack?.disconnect();
      win.solana?.disconnect();
    } catch { /* ok */ }
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

        // Build welcome message — natural, conversational tone
        const actionDescriptions: Record<string, string> = {
          transfer: "send SOL to any wallet address",
          swap: "trade tokens via Orca Whirlpools (SOL ↔ devUSDC)",
          recover: "scan and close empty token accounts to reclaim rent",
          scan_airdrops: "scan your wallet for airdropped tokens",
          scam_check: "analyze tokens for scam indicators like freeze authority, supply concentration, and metadata",
          airdrop: "request SOL from the devnet faucet",
        };
        const capabilities = data.allowedActions
          .map(a => `• ${a.replace(/_/g, " ")}: ${actionDescriptions[a] || "custom action"}`)
          .join("\n");

        const welcomeMsg =
          `🤖 Hey! I'm ${data.id}, your ${data.role} agent on Solana devnet.\n\n` +
          `Here's what I can do for you:\n${capabilities}\n\n` +
          `My current limits are set to ${data.maxSolPerTx} SOL per transaction and ${data.dailyTxLimit} transactions per day, with a medium risk profile.\n\n` +
          `You can also configure me anytime — just say things like "change risk to high", "set max SOL to 2", or "set daily limit to 20" and I'll update myself.\n\n` +
          `I can schedule tasks for you too (like "scan scams every 6 hours"), check market prices, and remember your preferences. Just ask!`;

        // Add deploy block + welcome message to new agent's stream
        setAgentBlocks(prev => ({
          ...prev,
          [data.id]: [
            newBlock("success", "AGENT DEPLOYED", `Agent "${data.id}" created with role: ${data.role}`),
            newBlock("system", "AGENT INTRO", welcomeMsg),
          ],
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

  // ─── WebSocket connection for streaming ───
  const wsRef = useRef<WebSocket | null>(null);
  const streamResolverRef = useRef<((data: any) => void) | null>(null);
  const streamTextRef = useRef("");

  useEffect(() => {
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || API.replace("https://", "wss://").replace("http://", "ws://");
    let ws: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    const connect = () => {
      ws = new WebSocket(wsUrl);
      ws.onopen = () => { wsRef.current = ws; };
      ws.onclose = () => {
        wsRef.current = null;
        reconnectTimer = setTimeout(connect, 3000);
      };
      ws.onerror = () => { ws.close(); };
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          if (msg.type === "chat:chunk") {
            streamTextRef.current += msg.text;
            // Update the last block in-place for streaming effect
            if (selectedAgentRef.current) {
              const agentId = selectedAgentRef.current;
              setAgentBlocks(prev => {
                const blocks = [...(prev[agentId] || [])];
                const lastIdx = blocks.length - 1;
                if (lastIdx >= 0 && blocks[lastIdx].label === "STREAMING") {
                  blocks[lastIdx] = { ...blocks[lastIdx], content: streamTextRef.current };
                }
                return { ...prev, [agentId]: blocks };
              });
            }
          }

          if (msg.type === "chat:done" && streamResolverRef.current) {
            streamResolverRef.current(msg);
            streamResolverRef.current = null;
          }

          if (msg.type === "chat:error" && streamResolverRef.current) {
            streamResolverRef.current({ error: msg.error });
            streamResolverRef.current = null;
          }

          // ─── Cron job execution notifications ───
          if (msg.type === "cron:executed" && msg.agentId) {
            const result = msg.result || {};
            const action = msg.action || result.action || msg.name || "scheduled task";
            const detail = result.success !== false
              ? `✅ Scheduled job completed: ${action}`
              : `⚠️ Scheduled job finished with issues: ${action}`;
            setAgentBlocks(prev => {
              const blocks = [...(prev[msg.agentId] || [])];
              blocks.push({
                id: `cron-${Date.now()}`,
                type: "system" as const,
                label: "SCHEDULED TASK",
                content: detail,
                timestamp: Date.now(),
                badge: "cron",
              });
              return { ...prev, [msg.agentId]: blocks };
            });
          }

          if (msg.type === "cron:failed" && msg.agentId) {
            setAgentBlocks(prev => {
              const blocks = [...(prev[msg.agentId] || [])];
              blocks.push({
                id: `cron-err-${Date.now()}`,
                type: "error" as const,
                label: "SCHEDULED TASK FAILED",
                content: `❌ ${msg.action || "task"} failed: ${msg.error || "unknown error"}`,
                timestamp: Date.now(),
              });
              return { ...prev, [msg.agentId]: blocks };
            });
          }
        } catch { }
      };
    };

    connect();
    return () => {
      clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, []);

  // Keep a ref to selectedAgent for WS callback
  const selectedAgentRef = useRef(selectedAgent);
  useEffect(() => { selectedAgentRef.current = selectedAgent; }, [selectedAgent]);

  // ─── Send command (WS streaming with HTTP fallback) ───
  const sendCommand = async (message: string) => {
    if (!selectedAgent || !token) return;

    addBlock("intent", "USER INTENT", message);
    setParsing(true);
    setParsingStep("analyzing");

    // Try WebSocket streaming first
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      try {
        setParsingStep("processing");
        streamTextRef.current = "";

        // Add an empty streaming block that will be updated in real-time
        const agentId = selectedAgent;
        setAgentBlocks(prev => ({
          ...prev,
          [agentId]: [...(prev[agentId] || []), newBlock("system", "STREAMING", "")],
        }));

        // Send via WS and wait for completion
        wsRef.current.send(JSON.stringify({
          type: "chat:stream",
          agentId: selectedAgent,
          message,
        }));

        const data: any = await new Promise((resolve) => {
          streamResolverRef.current = resolve;
          // Timeout after 45 seconds
          setTimeout(() => {
            if (streamResolverRef.current) {
              streamResolverRef.current({ error: "Request timed out" });
              streamResolverRef.current = null;
            }
          }, 45_000);
        });

        setParsing(false);
        setParsingStep(null);

        // Remove the streaming block and add the final one
        setAgentBlocks(prev => {
          const blocks = [...(prev[agentId] || [])];
          const streamIdx = blocks.findIndex(b => b.label === "STREAMING");
          if (streamIdx >= 0) blocks.splice(streamIdx, 1);
          return { ...prev, [agentId]: blocks };
        });

        if (data.error) {
          addBlock("error", "FAILED", data.error);
          return;
        }

        const intent = data.intents?.[0];
        const rawReply = data.reply || "";
        const reply = formatReplyText(rawReply);

        routeIntentToBlock(intent, reply, rawReply, data);
        refreshAgentList();
        return;

      } catch {
        // Fall through to HTTP
      }
    }

    // ─── HTTP Fallback ───
    try {
      const res = await fetch(`${API}/api/agents/${selectedAgent}/chat`, {
        method: "POST",
        headers: makeHeader(token),
        body: JSON.stringify({ message }),
      });

      setParsingStep("processing");
      const data = await res.json();
      await new Promise(r => setTimeout(r, 800));

      setParsing(false);
      setParsingStep(null);

      const intent = data.intent || data.intents?.[0];
      const rawReply = data.reply || data.error || "";
      const reply = formatReplyText(rawReply);

      routeIntentToBlock(intent, reply, rawReply, data);
      refreshAgentList();
    } catch (err: any) {
      setParsing(false);
      addBlock("error", "FAILED", err.message || "Network error");
    }
  };

  // ─── Helper: format reply text ───
  const formatReplyText = (r: string): string => {
    try {
      const obj = typeof r === "string" ? JSON.parse(r) : r;
      if (typeof obj === "object") {
        if (obj.reply) return obj.reply;
        if (obj.reason) return obj.reason;
        return Object.entries(obj)
          .filter(([, v]) => v !== null && v !== undefined)
          .map(([k, v]) => `${k}: ${v}`)
          .join("\n");
      }
    } catch { }
    return r.replace(/\*\*/g, "").replace(/\\n/g, "\n").replace(/^\s*-\s/gm, "• ").trim();
  };

  // ─── Helper: refresh agent list non-blocking ───
  const refreshAgentList = () => {
    fetch(`${API}/api/agents`, { headers: makeHeader(token) })
      .then(r => r.json())
      .then(list => { if (Array.isArray(list)) setAgents(list); })
      .catch(() => { });
    fetchSchedules();
    fetchHistory();
  };

  // ─── Helper: route intent to appropriate display block ───
  const routeIntentToBlock = (intent: any, reply: string, rawReply: string, data: any) => {
    // Check for hold/fallback
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
        addBlock("success", "EXECUTION CONFIRMED", reply, { details: details || undefined, confidence: 92 });
      } else if (reply.includes("denied") || reply.includes("⛔")) {
        addBlock("error", "BLOCKED", reply);
      } else {
        addBlock("success", "RESULT", reply, { confidence: 88 });
      }
    } else if (intent?.type === "schedule") {
      addBlock("parsed", "SCHEDULE", `Action: ${intent.action}\nInterval: ${intent.interval || "—"}`, { badge: intent.type });
      addBlock("success", "SCHEDULE UPDATED", reply);
    } else if (intent?.type === "unschedule") {
      addBlock("success", "SCHEDULE REMOVED", reply);
    } else if (intent?.type === "query_balance") {
      addBlock("system", "WALLET BALANCE", reply);
    } else if (intent?.type === "market_query") {
      addBlock("system", "MARKET DATA", reply);
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
          {agents.length >= 2 && (
            <div style={{ padding: "12px 16px", background: "#0a0a0a" }}>
              <MultiAgentDemo agents={agents} token={token} apiUrl={API} />
            </div>
          )}
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
        {selectedAgent ? (
          <>
            <ExecutionStream
              blocks={currentBlocks}
              agentName={selectedAgentData?.id}
              agentRole={selectedAgentData?.config?.role}
              allowedActions={selectedAgentData?.config?.allowedActions}
              maxSolPerTx={selectedAgentData?.config?.maxSolPerTx}
              dailyTxLimit={selectedAgentData?.config?.dailyTxLimit}
              parsing={parsing}
              parsingStep={parsingStep}
              onTogglePanel={() => setShowPanel(p => !p)}
              onBackToDashboard={() => setSelectedAgent(null)}
              showPanel={showPanel}
            />
            <CommandInput
              onSend={sendCommand}
              loading={parsing}
              allowedActions={selectedAgentData?.config?.allowedActions}
              pendingInput={pendingInput}
              onPendingClear={() => setPendingInput("")}
            />
          </>
        ) : (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: "40px 32px", overflowY: "auto" }}>
            <div style={{ textAlign: "center", marginBottom: "40px" }}>
              {/* Shield Logo */}
              <div style={{ marginBottom: "16px" }}>
                <svg width="48" height="56" viewBox="0 0 48 56" fill="none" style={{ margin: "0 auto", display: "block", filter: "drop-shadow(0 0 20px rgba(0,224,255,0.3))" }}>
                  <path d="M24 2L4 12v16c0 14.4 8.5 24.2 20 28 11.5-3.8 20-13.6 20-28V12L24 2z" stroke="url(#shieldGrad)" strokeWidth="2.5" fill="rgba(0,224,255,0.06)" />
                  <path d="M24 14l-10 5v8c0 7.2 4.25 12.1 10 14 5.75-1.9 10-6.8 10-14v-8L24 14z" fill="rgba(0,224,255,0.1)" stroke="rgba(0,224,255,0.3)" strokeWidth="1" />
                  <circle cx="24" cy="28" r="4" fill="#00e0ff" opacity="0.9" />
                  <circle cx="24" cy="28" r="7" fill="none" stroke="rgba(0,224,255,0.25)" strokeWidth="1" strokeDasharray="3 3">
                    <animateTransform attributeName="transform" type="rotate" from="0 24 28" to="360 24 28" dur="8s" repeatCount="indefinite" />
                  </circle>
                  <defs>
                    <linearGradient id="shieldGrad" x1="4" y1="2" x2="44" y2="56">
                      <stop offset="0%" stopColor="#00e0ff" />
                      <stop offset="100%" stopColor="#0060ff" />
                    </linearGradient>
                  </defs>
                </svg>
              </div>
              {/* Title */}
              <h1 style={{ fontSize: "32px", fontWeight: 700, color: "#e8e8e8", margin: "0 0 6px", letterSpacing: "-0.02em" }}>
                Sol<span style={{ color: "#00e0ff" }}>Aegis</span>
              </h1>
              {/* Subtitle */}
              <p style={{ fontSize: "13px", color: "rgba(255,255,255,0.4)", margin: "0 0 24px", letterSpacing: "0.15em", textTransform: "uppercase", fontWeight: 500 }}>
                AI Agent Execution Dashboard
              </p>
              {/* Divider */}
              <div style={{ width: "60px", height: "1px", background: "linear-gradient(90deg, transparent, rgba(0,224,255,0.3), transparent)", margin: "0 auto 16px" }} />
              {/* Hint */}
              <p style={{ fontSize: "12px", color: "#555", margin: 0 }}>
                Select an agent to chat · or run the multi-agent demo below
              </p>
            </div>
            {agents.length >= 2 ? (
              <MultiAgentDemo agents={agents} token={token} apiUrl={API} />
            ) : (
              <div style={{ textAlign: "center", color: "#555", fontSize: "13px" }}>
                <p>Create at least 2 agents to unlock the Multi-Agent Demo</p>
                <button
                  onClick={() => setShowCreateModal(true)}
                  style={{ padding: "8px 24px", background: "#00e0ff", color: "#0a0a0a", border: "none", borderRadius: "6px", fontSize: "12px", fontWeight: 600, cursor: "pointer", marginTop: "12px" }}
                >
                  + Create Agent
                </button>
              </div>
            )}
          </div>
        )}
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
          onRefresh={() => fetchAgents()}
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

"use client";

import { useState, useEffect, useRef, useCallback } from "react";

const API = "http://localhost:4000";

type TabType = "dashboard" | "agent" | "portfolio" | "decisions" | "scamcheck" | "recovery" | "scheduler";

interface Agent {
  id: string;
  publicKey: string;
  balance: number;
  pendingTx: number;
  lastAction?: string;
  skills: string[];
  config?: {
    role: string;
    maxSolPerTx: number;
    dailyTxLimit: number;
    allowedActions: string[];
    riskProfile: string;
    createdAt: number;
  };
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

interface WSEvent {
  event: string;
  data: any;
  timestamp: number;
}

interface PortfolioData {
  solBalance: number;
  tokens: { mint: string; balance: number; costBasis: number; totalInvested: number }[];
  totalValueSOL: number;
  unrealizedPnL: number;
}

interface AnalyticsData {
  totalDecisions: number;
  successRate: number;
  avgRiskScore: number;
  riskTrend: string;
  mostSuccessfulAction: string | null;
  mostFailedAction: string | null;
  recentDecisions: DecisionRecord[];
}

interface DecisionRecord {
  timestamp: number;
  action: string;
  source: string;
  result: string;
  reason?: string;
  riskScore: number;
  confidence: number;
  executionTimeMs?: number;
}

interface ScamResult {
  safe: boolean;
  riskScore: number;
  reasons: string[];
  details: {
    hasFreezeAuthority: boolean;
    hasMintAuthority: boolean;
    supply: string;
    decimals: number;
    mintAge?: string;
    hasMetadata: boolean;
    liquidityDetected: boolean;
    isBlocklisted: boolean;
    honeypotRisk: boolean;
  };
}

interface RecoverySummary {
  totalAccounts: number;
  emptyAccounts: number;
  dustAccounts: number;
  totalRecoverableSOL: number;
  recovered: { address: string; mint: string; balance: number; type: string }[];
}

export default function Dashboard() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [events, setEvents] = useState<WSEvent[]>([]);
  const [tab, setTab] = useState<TabType>("dashboard");
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [newAgentId, setNewAgentId] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(false);

  // Portfolio & Analytics
  const [portfolio, setPortfolio] = useState<PortfolioData | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [decisions, setDecisions] = useState<DecisionRecord[]>([]);

  // Scam checker
  const [scamMint, setScamMint] = useState("");
  const [scamResult, setScamResult] = useState<ScamResult | null>(null);
  const [scamLoading, setScamLoading] = useState(false);

  // Recovery
  const [recovery, setRecovery] = useState<RecoverySummary | null>(null);

  // Scheduler
  const [cronJobs, setCronJobs] = useState<any[]>([]);
  const [cronForm, setCronForm] = useState({ name: "", pattern: "*/10 * * * *", agentId: "", action: "scan_airdrops" });
  const [cronLoading, setCronLoading] = useState(false);
  const [cronResult, setCronResult] = useState<any>(null);

  // Action modal
  const [actionModal, setActionModal] = useState<{ open: boolean; agentId: string; type: string }>({ open: false, agentId: "", type: "" });
  const [actionParams, setActionParams] = useState<Record<string, string>>({});
  const [actionResult, setActionResult] = useState<any>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [transferMode, setTransferMode] = useState<"sol" | "spl">("sol");

  // Chat state
  const [chatOpen, setChatOpen] = useState(false);
  const [chatAgentId, setChatAgentId] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

  // Agent creation form
  const [newRole, setNewRole] = useState<string>("custom");
  const [newMaxSol, setNewMaxSol] = useState(1.0);
  const [newDailyLimit, setNewDailyLimit] = useState(5);
  const [newAllowedActions, setNewAllowedActions] = useState<string[]>(["transfer", "recover", "scan_airdrops", "scam_check"]);

  const wsRef = useRef<WebSocket | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // Fetch agents
  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/agents`);
      const data = await res.json();
      setAgents(Array.isArray(data) ? data : data.value || []);
      if (!selectedAgent && data.length > 0) {
        setSelectedAgent((Array.isArray(data) ? data : data.value)?.[0]?.id);
      }
    } catch { }
  }, [selectedAgent]);

  // WebSocket
  useEffect(() => {
    fetchAgents();
    const ws = new WebSocket("ws://localhost:4001");
    wsRef.current = ws;
    ws.onmessage = (msg) => {
      try {
        const evt = JSON.parse(msg.data);
        setEvents((prev) => [evt, ...prev].slice(0, 50));
        if (evt.event === "agent:created" || evt.event === "task:executed" || evt.event === "dermercist:cycle") {
          fetchAgents();
        }
      } catch { }
    };
    return () => ws.close();
  }, []);

  // Auto scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  // Create agent with role + config
  const createAgent = async () => {
    if (!newAgentId.trim()) return;
    setLoading(true);
    try {
      await fetch(`${API}/api/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: newAgentId,
          role: newRole,
          maxSolPerTx: newMaxSol,
          dailyTxLimit: newDailyLimit,
          allowedActions: newAllowedActions,
        }),
      });
      setNewAgentId("");
      setShowModal(false);
      fetchAgents();
    } catch { }
    setLoading(false);
  };

  // Send chat message
  const sendChat = async () => {
    if (!chatInput.trim() || !chatAgentId) return;
    const userMsg: ChatMessage = { role: "user", content: chatInput, timestamp: Date.now() };
    setChatMessages(prev => [...prev, userMsg]);
    setChatInput("");
    setChatLoading(true);
    try {
      const res = await fetch(`${API}/api/agents/${chatAgentId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMsg.content }),
      });
      const data = await res.json();
      const botMsg: ChatMessage = { role: "assistant", content: data.reply || data.error || "No response", timestamp: Date.now() };
      setChatMessages(prev => [...prev, botMsg]);
      // Refresh agents if action was executed
      if (data.executionResult) fetchAgents();
    } catch (err: any) {
      setChatMessages(prev => [...prev, { role: "assistant", content: `Error: ${err.message}`, timestamp: Date.now() }]);
    }
    setChatLoading(false);
  };

  // Open chat for agent
  const openChat = (agentId: string) => {
    setChatAgentId(agentId);
    setChatMessages([]);
    setChatOpen(true);
  };

  // Run DerMercist
  const runDerMercist = async () => {
    setLoading(true);
    try {
      await fetch(`${API}/api/dermercist/run`, { method: "POST" });
      fetchAgents();
    } catch { }
    setLoading(false);
  };

  // Remove agent
  const removeAgent = async (agentId: string) => {
    if (!confirm(`Delete agent "${agentId}"? This cannot be undone.`)) return;
    try {
      await fetch(`${API}/api/agents/${agentId}`, { method: "DELETE" });
      if (selectedAgent === agentId) setSelectedAgent(null);
      fetchAgents();
    } catch { }
  };

  // Execute action (no params)
  const executeAction = async (agentId: string, action: string) => {
    try {
      const res = await fetch(`${API}/api/agents/${agentId}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, params: {} }),
      });
      fetchAgents();
    } catch { }
  };

  // Execute action with params (from modal)
  const executeWithParams = async () => {
    if (!actionModal.agentId) return;
    setActionLoading(true);
    setActionResult(null);
    try {
      let url = `${API}/api/agents/${actionModal.agentId}/execute`;
      let body: any = { action: actionModal.type, params: actionParams };

      // SOL transfer uses dedicated endpoint
      if (actionModal.type === "transfer" && transferMode === "sol") {
        url = `${API}/api/agents/${actionModal.agentId}/transfer-sol`;
        body = { to: actionParams.to, amount: actionParams.amount };
      }

      // Swap uses dedicated endpoint
      if (actionModal.type === "swap") {
        url = `${API}/api/agents/${actionModal.agentId}/swap`;
        body = { inputMint: actionParams.inputMint, outputMint: actionParams.outputMint, amount: actionParams.amount };
      }

      // Add liquidity uses dedicated endpoint
      if (actionModal.type === "liquidity") {
        url = `${API}/api/agents/${actionModal.agentId}/liquidity/add`;
        body = { poolId: actionParams.poolId, amountA: actionParams.amountA, amountB: actionParams.amountB };
      }

      // Auto-recover uses dedicated endpoint
      if (actionModal.type === "recover") {
        url = `${API}/api/agents/${actionModal.agentId}/auto-recover`;
        body = {};
      }

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setActionResult(data);
      fetchAgents();
    } catch (err: any) {
      setActionResult({ success: false, error: err.message });
    }
    setActionLoading(false);
  };

  // Request devnet airdrop
  const requestAirdrop = async (agentId: string) => {
    setActionLoading(true);
    setActionModal({ open: true, agentId, type: "airdrop" });
    setActionResult(null);
    try {
      const res = await fetch(`${API}/api/agents/${agentId}/airdrop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: 1 }),
      });
      const data = await res.json();
      setActionResult(data);
      fetchAgents();
    } catch (err: any) {
      setActionResult({ success: false, error: err.message });
    }
    setActionLoading(false);
  };

  // Open action form
  const openActionForm = (agentId: string, type: string) => {
    setActionModal({ open: true, agentId, type });
    setActionParams({});
    setActionResult(null);
    setTransferMode("sol");
  };

  // Fetch portfolio
  const fetchPortfolio = async (agentId: string) => {
    try {
      const [pRes, aRes, dRes] = await Promise.all([
        fetch(`${API}/api/agents/${agentId}/portfolio`),
        fetch(`${API}/api/agents/${agentId}/analytics`),
        fetch(`${API}/api/agents/${agentId}/decisions`),
      ]);
      setPortfolio(await pRes.json());
      setAnalytics(await aRes.json());
      setDecisions(await dRes.json());
    } catch { }
  };

  // Fetch recovery
  const fetchRecovery = async (agentId: string) => {
    try {
      const res = await fetch(`${API}/api/agents/${agentId}/recovery`);
      setRecovery(await res.json());
    } catch { }
  };

  // Fetch cron jobs
  const fetchCronJobs = async () => {
    try {
      const res = await fetch(`${API}/api/cron/jobs`);
      const data = await res.json();
      setCronJobs(Array.isArray(data) ? data : data.value || []);
    } catch { }
  };

  // Schedule cron job
  const scheduleCron = async () => {
    if (!cronForm.name || !cronForm.agentId) return;
    setCronLoading(true);
    setCronResult(null);
    try {
      const res = await fetch(`${API}/api/cron/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cronForm),
      });
      const data = await res.json();
      setCronResult(data);
      fetchCronJobs();
    } catch (err: any) {
      setCronResult({ success: false, error: err.message });
    }
    setCronLoading(false);
  };

  // Remove cron job
  const removeCronJob = async (name: string, pattern: string) => {
    try {
      await fetch(`${API}/api/cron/jobs/${encodeURIComponent(name)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pattern }),
      });
      fetchCronJobs();
    } catch { }
  };

  // Scam check
  const checkScam = async () => {
    if (!scamMint.trim()) return;
    setScamLoading(true);
    try {
      const res = await fetch(`${API}/api/tokens/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mint: scamMint }),
      });
      setScamResult(await res.json());
    } catch { }
    setScamLoading(false);
  };

  // Tab change effects
  useEffect(() => {
    if (selectedAgent) {
      if (tab === "portfolio" || tab === "decisions") fetchPortfolio(selectedAgent);
      if (tab === "recovery") fetchRecovery(selectedAgent);
    }
    if (tab === "scheduler") fetchCronJobs();
  }, [tab, selectedAgent]);

  const activeAgent = agents.find(a => a.id === selectedAgent);

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #0a0a1a 0%, #0d1117 50%, #0a0a2e 100%)", color: "#e0e0e0", fontFamily: "'Inter', -apple-system, sans-serif" }}>

      {/* Header */}
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 24px", borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(10,10,26,0.8)", backdropFilter: "blur(20px)", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ width: 36, height: 36, borderRadius: "10px", background: "linear-gradient(135deg, #3b82f6, #8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 16, color: "#fff" }}>S</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 18, color: "#fff" }}>SolAegis</div>
            <div style={{ fontSize: 11, color: "#666", letterSpacing: "0.5px" }}>Autonomous DeFi Infrastructure</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          <button onClick={runDerMercist} disabled={loading} style={{ padding: "8px 18px", borderRadius: "8px", border: "1px solid rgba(168,85,247,0.3)", background: "rgba(168,85,247,0.1)", color: "#a855f7", cursor: "pointer", fontSize: 13, fontWeight: 600, transition: "all 0.2s" }}>
            DerMercist
          </button>
          <button onClick={() => setShowModal(true)} style={{ padding: "8px 18px", borderRadius: "8px", border: "none", background: "linear-gradient(135deg, #3b82f6, #8b5cf6)", color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
            + New Agent
          </button>
        </div>
      </header>

      {/* Tab Navigation */}
      <nav style={{ display: "flex", gap: "4px", padding: "12px 24px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
        {(["dashboard", "agent", "portfolio", "decisions", "scamcheck", "recovery", "scheduler"] as TabType[]).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "8px 16px", borderRadius: "6px", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 500,
            background: tab === t ? "rgba(59,130,246,0.15)" : "transparent",
            color: tab === t ? "#60a5fa" : "#888",
            transition: "all 0.2s",
          }}>
            {{ dashboard: "Dashboard", agent: "Agent", portfolio: "Portfolio", decisions: "Decisions", scamcheck: "Scam Checker", recovery: "Recovery", scheduler: "Scheduler" }[t]}
          </button>
        ))}
      </nav>

      {/* Agent Selector */}
      {agents.length > 0 && tab !== "scamcheck" && (
        <div style={{ padding: "8px 24px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {agents.map(a => (
            <button key={a.id} onClick={() => setSelectedAgent(a.id)} style={{
              padding: "6px 14px", borderRadius: "20px", border: "1px solid", fontSize: 12, cursor: "pointer",
              borderColor: selectedAgent === a.id ? "rgba(59,130,246,0.5)" : "rgba(255,255,255,0.08)",
              background: selectedAgent === a.id ? "rgba(59,130,246,0.1)" : "rgba(255,255,255,0.02)",
              color: selectedAgent === a.id ? "#60a5fa" : "#888",
            }}>
              {a.id} ({a.balance.toFixed(2)} SOL)
            </button>
          ))}
        </div>
      )}

      <main style={{ padding: "20px 24px", maxWidth: 1200, margin: "0 auto" }}>

        {/* ========== DASHBOARD TAB ========== */}
        {tab === "dashboard" && (
          <>
            {/* Stats Row */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px", marginBottom: "20px" }}>
              {[
                { label: "Agents", value: agents.length, color: "#3b82f6" },
                { label: "Total SOL", value: agents.reduce((s, a) => s + a.balance, 0).toFixed(3), color: "#10b981" },
                { label: "Pending TX", value: agents.reduce((s, a) => s + a.pendingTx, 0), color: "#f59e0b" },
                { label: "Events", value: events.length, color: "#8b5cf6" },
              ].map(s => (
                <div key={s.label} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "12px", padding: "16px", backdropFilter: "blur(10px)" }}>
                  <div style={{ fontSize: 11, color: "#666", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>{s.label}</div>
                  <div style={{ fontSize: 24, fontWeight: 700, color: s.color }}>{s.value}</div>
                </div>
              ))}
            </div>

            {/* Agent Cards — Minimal */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "14px", marginBottom: "24px" }}>
              {agents.map(a => (
                <div key={a.id} style={{ background: "rgba(255,255,255,0.03)", border: selectedAgent === a.id ? "1px solid rgba(99,102,241,0.3)" : "1px solid rgba(255,255,255,0.06)", borderRadius: "14px", padding: "18px", backdropFilter: "blur(10px)", transition: "border-color 0.2s", cursor: "pointer" }}
                  onClick={() => { setSelectedAgent(a.id); openChat(a.id); setTab("agent"); }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: "10px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16,
                        background: a.config?.role === "trader" ? "rgba(6,182,212,0.12)" : a.config?.role === "monitor" ? "rgba(168,85,247,0.12)" : a.config?.role === "recovery" ? "rgba(245,158,11,0.12)" : "rgba(59,130,246,0.12)",
                      }}>{a.config?.role === "trader" ? "🤖" : a.config?.role === "monitor" ? "👁" : a.config?.role === "recovery" ? "🔧" : "⚡"}</div>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 15 }}>{a.id}</div>
                        <div style={{ fontSize: 10, color: "#666", textTransform: "uppercase", letterSpacing: "0.5px" }}>{a.config?.role || "agent"}</div>
                      </div>
                    </div>
                    <div style={{ padding: "3px 10px", borderRadius: "12px", fontSize: 10, background: a.pendingTx > 0 ? "rgba(245,158,11,0.15)" : "rgba(16,185,129,0.15)", color: a.pendingTx > 0 ? "#f59e0b" : "#10b981" }}>
                      {a.pendingTx > 0 ? "Busy" : "Ready"}
                    </div>
                  </div>
                  <div style={{ fontSize: 24, fontWeight: 700, color: "#10b981", marginBottom: 8 }}>{a.balance.toFixed(4)} SOL</div>
                  <button onClick={(e) => { e.stopPropagation(); setSelectedAgent(a.id); openChat(a.id); setTab("agent"); }} style={{ width: "100%", padding: "9px", borderRadius: "8px", border: "none", background: "linear-gradient(135deg, rgba(99,102,241,0.15), rgba(139,92,246,0.15))", color: "#a78bfa", cursor: "pointer", fontSize: 13, fontWeight: 600, letterSpacing: "0.3px" }}>Open Agent →</button>
                </div>
              ))}
            </div>

            {/* Live Event Feed */}
            <div>
              <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#10b981", animation: "pulse 2s infinite" }}></span>
                Live Event Feed
                {events.length > 0 && (
                  <button onClick={() => setEvents([])} style={{ marginLeft: "auto", padding: "3px 10px", borderRadius: "6px", border: "1px solid rgba(239,68,68,0.2)", background: "rgba(239,68,68,0.08)", color: "#ef4444", cursor: "pointer", fontSize: 10, fontWeight: 500 }}>Clear</button>
                )}
              </h3>
              <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "12px", maxHeight: 300, overflow: "auto" }}>
                {events.length === 0 ? (
                  <div style={{ padding: 24, textAlign: "center", color: "#555", fontSize: 13 }}>No events yet</div>
                ) : events.map((e, i) => (
                  <div key={i} style={{ display: "flex", gap: "12px", alignItems: "flex-start", padding: "10px 16px", borderBottom: "1px solid rgba(255,255,255,0.03)", fontSize: 12 }}>
                    <span style={{ color: "#555", minWidth: 60, fontFamily: "monospace" }}>{new Date(e.timestamp).toLocaleTimeString()}</span>
                    <span style={{ padding: "2px 8px", borderRadius: "4px", fontSize: 10, fontWeight: 600, minWidth: 90, textAlign: "center", background: eventColor(e.event).bg, color: eventColor(e.event).fg }}>
                      {e.event}
                    </span>
                    <div style={{ color: "#ccc", flex: 1 }}>{formatEventData(e)}</div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ========== AGENT DETAIL TAB ========== */}
        {tab === "agent" && selectedAgent && (() => {
          const ag = agents.find(a => a.id === selectedAgent);
          if (!ag) return <div style={{ color: "#888", textAlign: "center", padding: 40 }}>Select an agent from the Dashboard.</div>;
          return (
            <div>
              {/* Agent Header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: "12px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22,
                    background: ag.config?.role === "trader" ? "rgba(6,182,212,0.12)" : ag.config?.role === "monitor" ? "rgba(168,85,247,0.12)" : ag.config?.role === "recovery" ? "rgba(245,158,11,0.12)" : "rgba(59,130,246,0.12)",
                  }}>{ag.config?.role === "trader" ? "🤖" : ag.config?.role === "monitor" ? "👁" : ag.config?.role === "recovery" ? "🔧" : "⚡"}</div>
                  <div>
                    <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{ag.id}</h2>
                    <div style={{ fontSize: 11, color: "#666", textTransform: "uppercase", letterSpacing: "0.5px" }}>{ag.config?.role || "agent"} • {ag.balance.toFixed(4)} SOL</div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => requestAirdrop(ag.id)} style={{ padding: "8px 16px", borderRadius: "8px", border: "1px solid rgba(16,185,129,0.3)", background: "rgba(16,185,129,0.1)", color: "#10b981", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>Airdrop 1 SOL</button>
                  <button onClick={() => removeAgent(ag.id)} style={{ padding: "8px 16px", borderRadius: "8px", border: "1px solid rgba(239,68,68,0.2)", background: "rgba(239,68,68,0.06)", color: "#ef4444", cursor: "pointer", fontSize: 12, fontWeight: 500 }}>Delete</button>
                </div>
              </div>

              {/* Two Column: Config | Chat */}
              <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: 16, marginBottom: 20 }}>

                {/* LEFT: Config Panel */}
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {/* Wallet */}
                  <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "12px", padding: "16px" }}>
                    <div style={{ fontSize: 11, color: "#666", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>Wallet</div>
                    <div style={{ fontSize: 11, fontFamily: "monospace", color: "#aaa", wordBreak: "break-all" }}>{ag.publicKey}</div>
                  </div>

                  {/* Config */}
                  <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "12px", padding: "16px" }}>
                    <div style={{ fontSize: 11, color: "#666", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 12 }}>Configuration</div>
                    {ag.config ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                          <span style={{ color: "#888" }}>Max SOL/tx</span>
                          <span style={{ color: "#e0e0e0", fontWeight: 600 }}>{ag.config.maxSolPerTx}</span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                          <span style={{ color: "#888" }}>Daily Limit</span>
                          <span style={{ color: "#e0e0e0", fontWeight: 600 }}>{ag.config.dailyTxLimit} txs</span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                          <span style={{ color: "#888" }}>Risk Profile</span>
                          <span style={{ color: ag.config.riskProfile === "low" ? "#10b981" : ag.config.riskProfile === "high" ? "#ef4444" : "#f59e0b", fontWeight: 600 }}>{ag.config.riskProfile}</span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                          <span style={{ color: "#888" }}>Created</span>
                          <span style={{ color: "#aaa", fontSize: 11 }}>{new Date(ag.config.createdAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                    ) : <div style={{ fontSize: 12, color: "#555" }}>No config loaded</div>}
                  </div>

                  {/* Allowed Actions */}
                  <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "12px", padding: "16px" }}>
                    <div style={{ fontSize: 11, color: "#666", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 10 }}>Allowed Actions</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {ag.skills.map(s => (
                        <span key={s} style={{ padding: "4px 10px", borderRadius: "6px", fontSize: 11, fontWeight: 500, background: "rgba(99,102,241,0.1)", color: "#818cf8", border: "1px solid rgba(99,102,241,0.2)" }}>{s}</span>
                      ))}
                    </div>
                  </div>

                  {/* Quick Tip */}
                  <div style={{ background: "rgba(99,102,241,0.05)", border: "1px solid rgba(99,102,241,0.12)", borderRadius: "12px", padding: "14px", fontSize: 11, color: "#888", lineHeight: 1.6 }}>
                    💡 <strong style={{ color: "#a78bfa" }}>Tip:</strong> Use chat to interact with this agent. Try <em>"What can you do?"</em>, <em>"Send 0.1 SOL to..."</em>, or <em>"Switch to low risk mode"</em>.
                  </div>
                </div>

                {/* RIGHT: Inline Chat */}
                <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "14px", display: "flex", flexDirection: "column", minHeight: 480 }}>
                  {/* Chat Header */}
                  <div style={{ padding: "14px 18px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>💬 Chat with {ag.id}</div>
                    <div style={{ fontSize: 10, color: "#666" }}>policy guarded • {ag.config?.role || "agent"}</div>
                  </div>

                  {/* Messages */}
                  <div style={{ flex: 1, overflow: "auto", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
                    {chatMessages.length === 0 && chatAgentId === ag.id && (
                      <div style={{ textAlign: "center", color: "#555", fontSize: 12, padding: 30 }}>
                        Start chatting with <strong>{ag.id}</strong>.<br /><br />
                        <span style={{ color: "#818cf8" }}>"What can you do?"</span><br />
                        <span style={{ color: "#818cf8" }}>"Airdrop me some SOL"</span><br />
                        <span style={{ color: "#818cf8" }}>"Send 0.1 SOL to ..."</span><br />
                        <span style={{ color: "#818cf8" }}>"Switch to low risk mode"</span><br />
                        <span style={{ color: "#818cf8" }}>"Reload your skills"</span>
                      </div>
                    )}
                    {chatAgentId === ag.id && chatMessages.map((m, i) => (
                      <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "80%" }}>
                        <div style={{
                          padding: "10px 14px", borderRadius: m.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                          background: m.role === "user" ? "rgba(99,102,241,0.2)" : "rgba(255,255,255,0.04)",
                          border: `1px solid ${m.role === "user" ? "rgba(99,102,241,0.3)" : "rgba(255,255,255,0.06)"}`,
                          fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap", color: "#ddd",
                        }}>{m.content}</div>
                        <div style={{ fontSize: 9, color: "#555", marginTop: 2, textAlign: m.role === "user" ? "right" : "left" }}>
                          {new Date(m.timestamp).toLocaleTimeString()}
                        </div>
                      </div>
                    ))}
                    {chatLoading && (
                      <div style={{ alignSelf: "flex-start", padding: "10px 14px", borderRadius: "14px", background: "rgba(255,255,255,0.04)", fontSize: 13, color: "#888" }}>
                        Thinking...
                      </div>
                    )}
                    <div ref={chatEndRef} />
                  </div>

                  {/* Input */}
                  <div style={{ padding: "12px 16px", borderTop: "1px solid rgba(255,255,255,0.06)", display: "flex", gap: 8 }}>
                    <input
                      value={chatAgentId === ag.id ? chatInput : ""}
                      onChange={e => { setChatAgentId(ag.id); setChatInput(e.target.value); }}
                      onFocus={() => { if (chatAgentId !== ag.id) { setChatAgentId(ag.id); setChatMessages([]); } }}
                      onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendChat()}
                      placeholder="Type a message..."
                      style={{ flex: 1, padding: "10px 14px", borderRadius: "10px", border: "1px solid rgba(139,92,246,0.2)", background: "rgba(255,255,255,0.03)", color: "#e0e0e0", fontSize: 13, outline: "none" }}
                      disabled={chatLoading}
                    />
                    <button onClick={() => { setChatAgentId(ag.id); sendChat(); }} disabled={chatLoading || !chatInput.trim()} style={{ padding: "10px 18px", borderRadius: "10px", border: "none", background: "linear-gradient(135deg, #6366f1, #8b5cf6)", color: "#fff", cursor: "pointer", fontWeight: 600, fontSize: 13, opacity: !chatInput.trim() ? 0.5 : 1 }}>Send</button>
                  </div>
                </div>
              </div>

              {/* Activity Log */}
              <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "12px", padding: "16px" }}>
                <div style={{ fontSize: 11, color: "#666", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#10b981", animation: "pulse 2s infinite" }}></span>
                  Activity Log
                </div>
                <div style={{ maxHeight: 200, overflow: "auto" }}>
                  {events.filter(e => {
                    const d = e.data as any;
                    return d?.agentId === ag.id || d?.id === ag.id;
                  }).length === 0 ? (
                    <div style={{ fontSize: 12, color: "#555", padding: 12, textAlign: "center" }}>No activity yet for this agent.</div>
                  ) : events.filter(e => { const d = e.data as any; return d?.agentId === ag.id || d?.id === ag.id; }).map((e, i) => (
                    <div key={i} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.03)", fontSize: 12 }}>
                      <span style={{ color: "#555", fontFamily: "monospace", fontSize: 10, minWidth: 55 }}>{new Date(e.timestamp).toLocaleTimeString()}</span>
                      <span style={{ padding: "2px 8px", borderRadius: "4px", fontSize: 10, fontWeight: 600, background: eventColor(e.event).bg, color: eventColor(e.event).fg }}>{e.event}</span>
                      <span style={{ color: "#aaa", flex: 1 }}>{formatEventData(e)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })()}

        {/* ========== PORTFOLIO TAB ========== */}
        {tab === "portfolio" && selectedAgent && (
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>Portfolio -- {selectedAgent}</h2>

            {/* Analytics Summary */}
            {analytics && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "12px", marginBottom: "20px" }}>
                {[
                  { label: "Decisions", value: analytics.totalDecisions, color: "#3b82f6" },
                  { label: "Success Rate", value: `${(analytics.successRate * 100).toFixed(0)}%`, color: analytics.successRate > 0.7 ? "#10b981" : analytics.successRate > 0.4 ? "#f59e0b" : "#ef4444" },
                  { label: "Avg Risk", value: analytics.avgRiskScore.toFixed(0), color: "#8b5cf6" },
                  { label: "Risk Trend", value: analytics.riskTrend, color: analytics.riskTrend === "rising" ? "#ef4444" : analytics.riskTrend === "falling" ? "#10b981" : "#888" },
                  { label: "Best Action", value: analytics.mostSuccessfulAction || "N/A", color: "#10b981" },
                  { label: "Worst Action", value: analytics.mostFailedAction || "N/A", color: "#ef4444" },
                ].map(s => (
                  <div key={s.label} style={cardStyle}>
                    <div style={{ fontSize: 11, color: "#666", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>{s.label}</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: s.color }}>{s.value}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Portfolio Holdings */}
            {portfolio && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "20px" }}>
                  <div style={cardStyle}>
                    <div style={{ fontSize: 11, color: "#666", textTransform: "uppercase", marginBottom: 4 }}>SOL Balance</div>
                    <div style={{ fontSize: 28, fontWeight: 700, color: "#10b981" }}>{portfolio.solBalance.toFixed(4)}</div>
                  </div>
                  <div style={cardStyle}>
                    <div style={{ fontSize: 11, color: "#666", textTransform: "uppercase", marginBottom: 4 }}>Unrealized PnL</div>
                    <div style={{ fontSize: 28, fontWeight: 700, color: portfolio.unrealizedPnL >= 0 ? "#10b981" : "#ef4444" }}>
                      {portfolio.unrealizedPnL >= 0 ? "+" : ""}{portfolio.unrealizedPnL.toFixed(4)} SOL
                    </div>
                  </div>
                </div>

                <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Token Holdings ({portfolio.tokens.length})</h3>
                {portfolio.tokens.length === 0 ? (
                  <div style={{ ...cardStyle, textAlign: "center" as const, color: "#555", padding: "24px" }}>No token holdings</div>
                ) : (
                  <div style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                          <th style={thStyle}>Mint</th>
                          <th style={thStyle}>Balance</th>
                          <th style={thStyle}>Cost Basis</th>
                          <th style={thStyle}>Invested</th>
                        </tr>
                      </thead>
                      <tbody>
                        {portfolio.tokens.map((t, i) => (
                          <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                            <td style={tdStyle}><span style={{ fontFamily: "monospace", fontSize: 11 }}>{t.mint.slice(0, 8)}...{t.mint.slice(-4)}</span></td>
                            <td style={tdStyle}>{t.balance.toLocaleString()}</td>
                            <td style={tdStyle}>{t.costBasis.toFixed(6)} SOL</td>
                            <td style={tdStyle}>{t.totalInvested.toFixed(4)} SOL</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ========== DECISIONS TAB ========== */}
        {tab === "decisions" && selectedAgent && (
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>Decision History -- {selectedAgent}</h2>
            {decisions.length === 0 ? (
              <div style={{ ...cardStyle, textAlign: "center" as const, color: "#555", padding: "32px" }}>No decisions recorded yet. Run DerMercist to generate decisions.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {decisions.slice().reverse().map((d, i) => (
                  <div key={i} style={{ ...cardStyle, display: "flex", gap: "16px", alignItems: "center" }}>
                    <div style={{ minWidth: 80 }}>
                      <span style={{
                        display: "inline-block", padding: "3px 10px", borderRadius: "12px", fontSize: 10, fontWeight: 600,
                        background: d.result === "success" ? "rgba(16,185,129,0.15)" : d.result === "failure" ? "rgba(239,68,68,0.15)" : d.result === "rejected" ? "rgba(245,158,11,0.15)" : "rgba(136,136,136,0.15)",
                        color: d.result === "success" ? "#10b981" : d.result === "failure" ? "#ef4444" : d.result === "rejected" ? "#f59e0b" : "#888",
                      }}>
                        {d.result}
                      </span>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: "#ddd" }}>{d.action}</div>
                      <div style={{ fontSize: 11, color: "#777", marginTop: 2 }}>{d.reason || "No reason"}</div>
                    </div>
                    <div style={{ textAlign: "right" as const, fontSize: 11, color: "#666" }}>
                      <div>Risk: {d.riskScore} | Conf: {d.confidence}%</div>
                      <div>Source: {d.source}</div>
                      {d.executionTimeMs && <div>{d.executionTimeMs}ms</div>}
                      <div>{new Date(d.timestamp).toLocaleTimeString()}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ========== SCAM CHECKER TAB ========== */}
        {tab === "scamcheck" && (
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>Token Safety Checker</h2>
            <div style={{ display: "flex", gap: "10px", marginBottom: "20px" }}>
              <input
                value={scamMint}
                onChange={e => setScamMint(e.target.value)}
                placeholder="Enter token mint address..."
                style={{ flex: 1, padding: "10px 16px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.03)", color: "#e0e0e0", fontSize: 14, fontFamily: "monospace", outline: "none" }}
              />
              <button onClick={checkScam} disabled={scamLoading} style={{ padding: "10px 24px", borderRadius: "8px", border: "none", background: "linear-gradient(135deg, #3b82f6, #8b5cf6)", color: "#fff", cursor: "pointer", fontWeight: 600, fontSize: 14 }}>
                {scamLoading ? "Checking..." : "Check"}
              </button>
            </div>

            {scamResult && (
              <div>
                {/* Risk Score */}
                <div style={{ ...cardStyle, marginBottom: "16px", display: "flex", alignItems: "center", gap: "20px" }}>
                  <div style={{
                    width: 80, height: 80, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                    background: scamResult.riskScore < 30 ? "rgba(16,185,129,0.15)" : scamResult.riskScore < 60 ? "rgba(245,158,11,0.15)" : "rgba(239,68,68,0.15)",
                    border: `3px solid ${scamResult.riskScore < 30 ? "#10b981" : scamResult.riskScore < 60 ? "#f59e0b" : "#ef4444"}`,
                  }}>
                    <div style={{ fontSize: 24, fontWeight: 700, color: scamResult.riskScore < 30 ? "#10b981" : scamResult.riskScore < 60 ? "#f59e0b" : "#ef4444" }}>
                      {scamResult.riskScore}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: scamResult.safe ? "#10b981" : "#ef4444" }}>
                      {scamResult.safe ? "SAFE" : "UNSAFE"}
                    </div>
                    <div style={{ fontSize: 12, color: "#888" }}>Risk Score: {scamResult.riskScore}/100</div>
                  </div>
                </div>

                {/* Details Grid */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "10px", marginBottom: "16px" }}>
                  {[
                    { label: "Freeze Authority", value: scamResult.details.hasFreezeAuthority ? "YES" : "No", bad: scamResult.details.hasFreezeAuthority },
                    { label: "Mint Authority", value: scamResult.details.hasMintAuthority ? "YES" : "No", bad: scamResult.details.hasMintAuthority },
                    { label: "Has Metadata", value: scamResult.details.hasMetadata ? "Yes" : "NO", bad: !scamResult.details.hasMetadata },
                    { label: "Liquidity", value: scamResult.details.liquidityDetected ? "Found" : "NONE", bad: !scamResult.details.liquidityDetected },
                    { label: "Mint Age", value: scamResult.details.mintAge || "Unknown", bad: false },
                    { label: "Honeypot Risk", value: scamResult.details.honeypotRisk ? "HIGH" : "Low", bad: scamResult.details.honeypotRisk },
                    { label: "Blocklisted", value: scamResult.details.isBlocklisted ? "YES" : "No", bad: scamResult.details.isBlocklisted },
                    { label: "Decimals", value: scamResult.details.decimals.toString(), bad: scamResult.details.decimals > 18 },
                  ].map(d => (
                    <div key={d.label} style={cardStyle}>
                      <div style={{ fontSize: 11, color: "#666", textTransform: "uppercase", marginBottom: 4 }}>{d.label}</div>
                      <div style={{ fontSize: 15, fontWeight: 600, color: d.bad ? "#ef4444" : "#10b981" }}>{d.value}</div>
                    </div>
                  ))}
                </div>

                {/* Reasons */}
                {scamResult.reasons.length > 0 && (
                  <div style={cardStyle}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: "#ef4444" }}>Warnings</div>
                    {scamResult.reasons.map((r, i) => (
                      <div key={i} style={{ fontSize: 12, color: "#ccc", padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,0.04)", display: "flex", gap: 8 }}>
                        <span style={{ color: "#ef4444" }}>--</span> {r}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ========== RECOVERY TAB ========== */}
        {tab === "recovery" && selectedAgent && (
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>SOL Recovery -- {selectedAgent}</h2>
            <button onClick={() => fetchRecovery(selectedAgent)} style={{ padding: "8px 18px", borderRadius: "8px", border: "none", background: "linear-gradient(135deg, #f59e0b, #ef4444)", color: "#fff", cursor: "pointer", fontWeight: 600, fontSize: 13, marginBottom: 16 }}>
              Scan for Recoverable SOL
            </button>

            {recovery && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "12px", marginBottom: "20px" }}>
                  {[
                    { label: "Total Accounts", value: recovery.totalAccounts, color: "#3b82f6" },
                    { label: "Empty", value: recovery.emptyAccounts, color: "#10b981" },
                    { label: "Dust", value: recovery.dustAccounts, color: "#f59e0b" },
                    { label: "Recoverable SOL", value: recovery.totalRecoverableSOL.toFixed(6), color: "#8b5cf6" },
                  ].map(s => (
                    <div key={s.label} style={cardStyle}>
                      <div style={{ fontSize: 11, color: "#666", textTransform: "uppercase", marginBottom: 4 }}>{s.label}</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</div>
                    </div>
                  ))}
                </div>

                {recovery.recovered.length > 0 && (
                  <div style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                          <th style={thStyle}>Type</th>
                          <th style={thStyle}>Account</th>
                          <th style={thStyle}>Mint</th>
                          <th style={thStyle}>Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {recovery.recovered.map((r, i) => (
                          <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                            <td style={tdStyle}>
                              <span style={{ padding: "2px 8px", borderRadius: "4px", fontSize: 10, background: r.type === "empty" ? "rgba(16,185,129,0.15)" : "rgba(245,158,11,0.15)", color: r.type === "empty" ? "#10b981" : "#f59e0b" }}>
                                {r.type}
                              </span>
                            </td>
                            <td style={{ ...tdStyle, fontFamily: "monospace", fontSize: 11 }}>{String(r.address).slice(0, 8)}...</td>
                            <td style={{ ...tdStyle, fontFamily: "monospace", fontSize: 11 }}>{r.mint.slice(0, 8)}...</td>
                            <td style={tdStyle}>{r.balance}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        )}
        {/* ========== SCHEDULER TAB ========== */}
        {tab === "scheduler" && (
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>Cron Scheduler</h2>

            {/* Create Job Form */}
            <div style={{ ...cardStyle, marginBottom: 20 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Schedule New Job</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 4 }}>Job Name</label>
                  <input value={cronForm.name} onChange={e => setCronForm({ ...cronForm, name: e.target.value })} placeholder="e.g. auto-scan" style={inputStyle} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 4 }}>Cron Pattern</label>
                  <input value={cronForm.pattern} onChange={e => setCronForm({ ...cronForm, pattern: e.target.value })} placeholder="*/10 * * * *" style={inputStyle} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 4 }}>Agent</label>
                  <select value={cronForm.agentId} onChange={e => setCronForm({ ...cronForm, agentId: e.target.value })} style={{ ...inputStyle, fontFamily: "inherit" }}>
                    <option value="">Select agent...</option>
                    {agents.map(a => <option key={a.id} value={a.id}>{a.id}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 4 }}>Action</label>
                  <select value={cronForm.action} onChange={e => setCronForm({ ...cronForm, action: e.target.value })} style={{ ...inputStyle, fontFamily: "inherit" }}>
                    <option value="scan_airdrops">Scan Airdrops</option>
                    <option value="recover">Recover SOL</option>
                    <option value="transfer">Transfer</option>
                    <option value="scam_check">Scam Check</option>
                  </select>
                </div>
              </div>
              <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
                <button onClick={scheduleCron} disabled={cronLoading} style={{ padding: "10px 24px", borderRadius: "8px", border: "none", background: "linear-gradient(135deg, #3b82f6, #8b5cf6)", color: "#fff", cursor: "pointer", fontWeight: 600, fontSize: 14 }}>
                  {cronLoading ? "Scheduling..." : "Schedule Job"}
                </button>
                <span style={{ fontSize: 11, color: "#666" }}>Pattern guide: */5 = every 5 min, 0 * = every hour, 0 0 = daily</span>
              </div>
              {cronResult && (
                <div style={{ marginTop: 10, fontSize: 12, color: cronResult.success ? "#10b981" : "#ef4444" }}>
                  {cronResult.success ? `✓ Scheduled "${cronResult.name}" on ${cronResult.pattern}` : `✗ ${cronResult.error}`}
                </div>
              )}
            </div>

            {/* Active Jobs */}
            <div style={{ ...cardStyle }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600 }}>Active Scheduled Jobs</h3>
                <button onClick={fetchCronJobs} style={{ padding: "5px 12px", borderRadius: "6px", border: "1px solid rgba(59,130,246,0.3)", background: "rgba(59,130,246,0.1)", color: "#60a5fa", cursor: "pointer", fontSize: 11, fontWeight: 500 }}>Refresh</button>
              </div>
              {cronJobs.length === 0 ? (
                <div style={{ textAlign: "center", color: "#555", padding: 24, fontSize: 13 }}>No scheduled jobs. Create one above.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {cronJobs.map((job, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", background: "rgba(255,255,255,0.02)", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.04)" }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13, color: "#ddd" }}>{job.name}</div>
                        <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>Pattern: <span style={{ color: "#60a5fa", fontFamily: "monospace" }}>{job.pattern || job.every || "—"}</span></div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div style={{ textAlign: "right", fontSize: 11, color: "#666" }}>
                          {job.next && <div>Next: {new Date(job.next).toLocaleString()}</div>}
                        </div>
                        <button onClick={() => removeCronJob(job.name, job.pattern)} style={{ padding: "5px 12px", borderRadius: "6px", border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.1)", color: "#ef4444", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>Stop</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

      </main>

      {/* Create Agent Modal — with Role + Config */}
      {showModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }} onClick={() => setShowModal(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "16px", padding: "28px", width: 460, backdropFilter: "blur(20px)", maxHeight: "85vh", overflow: "auto" }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>Create Agent</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 4 }}>Agent Name</label>
                <input value={newAgentId} onChange={e => setNewAgentId(e.target.value)} placeholder="e.g., TraderOne, Scout" style={inputStyle} onKeyDown={e => e.key === "Enter" && createAgent()} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 6 }}>Role</label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {["trader", "monitor", "recovery", "custom"].map(r => (
                    <button key={r} onClick={() => {
                      setNewRole(r);
                      if (r === "trader") { setNewMaxSol(0.5); setNewDailyLimit(10); setNewAllowedActions(["transfer", "scan_airdrops", "scam_check", "recover"]); }
                      if (r === "monitor") { setNewMaxSol(0); setNewDailyLimit(0); setNewAllowedActions(["scan_airdrops", "scam_check"]); }
                      if (r === "recovery") { setNewMaxSol(0.1); setNewDailyLimit(20); setNewAllowedActions(["recover", "transfer", "scam_check"]); }
                      if (r === "custom") { setNewMaxSol(1.0); setNewDailyLimit(5); setNewAllowedActions(["transfer", "recover", "scan_airdrops", "scam_check"]); }
                    }} style={{
                      padding: "10px", borderRadius: "8px", border: "1px solid", cursor: "pointer", fontSize: 13, fontWeight: 600, textTransform: "capitalize",
                      borderColor: newRole === r ? "rgba(99,102,241,0.5)" : "rgba(255,255,255,0.1)",
                      background: newRole === r ? "rgba(99,102,241,0.15)" : "rgba(255,255,255,0.03)",
                      color: newRole === r ? "#818cf8" : "#888",
                    }}>{r === "trader" ? "🤖 Trader" : r === "monitor" ? "👁 Monitor" : r === "recovery" ? "🔧 Recovery" : "⚡ Custom"}</button>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: "#555", marginTop: 6 }}>
                  {{ trader: "Trading agent with transfer & scam detection capabilities.", monitor: "Read-only agent that scans airdrops & checks token safety.", recovery: "Closes empty accounts to reclaim rent SOL.", custom: "Fully configurable agent with all capabilities." }[newRole]}
                </div>
              </div>
              <div>
                <label style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 4 }}>Max SOL per Transaction: <span style={{ color: "#60a5fa", fontWeight: 600 }}>{newMaxSol}</span></label>
                <input type="range" min="0" max="5" step="0.1" value={newMaxSol} onChange={e => setNewMaxSol(parseFloat(e.target.value))} style={{ width: "100%", accentColor: "#6366f1" }} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 4 }}>Daily Transaction Limit: <span style={{ color: "#60a5fa", fontWeight: 600 }}>{newDailyLimit}</span></label>
                <input type="range" min="0" max="50" step="1" value={newDailyLimit} onChange={e => setNewDailyLimit(parseInt(e.target.value))} style={{ width: "100%", accentColor: "#6366f1" }} />
              </div>
              <div>
                <label style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 6 }}>Allowed Actions</label>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {["transfer", "recover", "scan_airdrops", "scam_check"].map(act => (
                    <button key={act} onClick={() => setNewAllowedActions(prev => prev.includes(act) ? prev.filter(a => a !== act) : [...prev, act])} style={{
                      padding: "5px 12px", borderRadius: "6px", border: "1px solid", cursor: "pointer", fontSize: 12,
                      borderColor: newAllowedActions.includes(act) ? "rgba(16,185,129,0.4)" : "rgba(255,255,255,0.1)",
                      background: newAllowedActions.includes(act) ? "rgba(16,185,129,0.12)" : "rgba(255,255,255,0.03)",
                      color: newAllowedActions.includes(act) ? "#10b981" : "#666",
                    }}>{act}</button>
                  ))}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end", marginTop: 18 }}>
              <button onClick={() => setShowModal(false)} style={{ padding: "8px 18px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "#888", cursor: "pointer", fontSize: 13 }}>Cancel</button>
              <button onClick={createAgent} disabled={loading || !newAgentId.trim()} style={{ padding: "8px 20px", borderRadius: "8px", border: "none", background: "linear-gradient(135deg, #6366f1, #8b5cf6)", color: "#fff", cursor: "pointer", fontWeight: 600, fontSize: 13, opacity: !newAgentId.trim() ? 0.5 : 1 }}>Create Agent</button>
            </div>
          </div>
        </div>
      )}

      {/* Chat Panel */}
      {chatOpen && (
        <div style={{ position: "fixed", bottom: 0, right: 0, width: 420, height: "70vh", background: "#13132b", border: "1px solid rgba(139,92,246,0.2)", borderRadius: "16px 0 0 0", display: "flex", flexDirection: "column", zIndex: 300, boxShadow: "0 -4px 40px rgba(0,0,0,0.5)" }}>
          {/* Chat Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(99,102,241,0.08)" }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>💬 {chatAgentId}</div>
              <div style={{ fontSize: 10, color: "#888" }}>{agents.find(a => a.id === chatAgentId)?.config?.role || "agent"} • policy guarded</div>
            </div>
            <button onClick={() => setChatOpen(false)} style={{ background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 18, padding: 4 }}>✕</button>
          </div>
          {/* Chat Messages */}
          <div style={{ flex: 1, overflow: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
            {chatMessages.length === 0 && (
              <div style={{ textAlign: "center", color: "#555", fontSize: 12, padding: 20 }}>
                Start a conversation. Try:<br />
                <span style={{ color: "#818cf8" }}>"What can you do?"</span><br />
                <span style={{ color: "#818cf8" }}>"Send 0.1 SOL to ..."</span><br />
                <span style={{ color: "#818cf8" }}>"Switch to low risk mode"</span><br />
                <span style={{ color: "#818cf8" }}>"Reload your skills"</span>
              </div>
            )}
            {chatMessages.map((m, i) => (
              <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "85%" }}>
                <div style={{
                  padding: "10px 14px", borderRadius: m.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                  background: m.role === "user" ? "rgba(99,102,241,0.2)" : "rgba(255,255,255,0.05)",
                  border: `1px solid ${m.role === "user" ? "rgba(99,102,241,0.3)" : "rgba(255,255,255,0.06)"}`,
                  fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap", color: "#ddd",
                }}>{m.content}</div>
                <div style={{ fontSize: 9, color: "#555", marginTop: 2, textAlign: m.role === "user" ? "right" : "left" }}>
                  {new Date(m.timestamp).toLocaleTimeString()}
                </div>
              </div>
            ))}
            {chatLoading && (
              <div style={{ alignSelf: "flex-start", padding: "10px 14px", borderRadius: "14px", background: "rgba(255,255,255,0.05)", fontSize: 13, color: "#888" }}>
                Thinking...
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
          {/* Chat Input */}
          <div style={{ padding: "12px 14px", borderTop: "1px solid rgba(255,255,255,0.06)", display: "flex", gap: 8 }}>
            <input
              value={chatInput} onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendChat()}
              placeholder="Type a message..."
              style={{ flex: 1, padding: "10px 14px", borderRadius: "10px", border: "1px solid rgba(139,92,246,0.2)", background: "rgba(255,255,255,0.04)", color: "#e0e0e0", fontSize: 13, outline: "none" }}
              disabled={chatLoading}
            />
            <button onClick={sendChat} disabled={chatLoading || !chatInput.trim()} style={{ padding: "10px 16px", borderRadius: "10px", border: "none", background: "linear-gradient(135deg, #6366f1, #8b5cf6)", color: "#fff", cursor: "pointer", fontWeight: 600, fontSize: 13, opacity: !chatInput.trim() ? 0.5 : 1 }}>Send</button>
          </div>
        </div>
      )}

      {/* Action Modal */}
      {actionModal.open && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }} onClick={() => setActionModal({ open: false, agentId: "", type: "" })}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "16px", padding: "28px", width: 440, backdropFilter: "blur(20px)", maxHeight: "80vh", overflow: "auto" }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4, textTransform: "capitalize" }}>{actionModal.type}</h3>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 16 }}>Agent: {actionModal.agentId}</div>

            {actionModal.type === "airdrop" && (
              <div style={{ fontSize: 13, color: "#888", marginBottom: 16 }}>
                {actionLoading ? "Requesting 1 SOL airdrop from devnet..." : "Airdrop request sent."}
              </div>
            )}

            {actionModal.type === "transfer" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: 16 }}>
                {/* SOL / SPL Toggle */}
                <div style={{ display: "flex", gap: "8px" }}>
                  <button onClick={() => setTransferMode("sol")} style={{
                    flex: 1, padding: "8px", borderRadius: "8px", border: "1px solid",
                    borderColor: transferMode === "sol" ? "rgba(16,185,129,0.5)" : "rgba(255,255,255,0.1)",
                    background: transferMode === "sol" ? "rgba(16,185,129,0.15)" : "rgba(255,255,255,0.03)",
                    color: transferMode === "sol" ? "#10b981" : "#888", cursor: "pointer", fontSize: 13, fontWeight: 600,
                  }}>SOL</button>
                  <button onClick={() => setTransferMode("spl")} style={{
                    flex: 1, padding: "8px", borderRadius: "8px", border: "1px solid",
                    borderColor: transferMode === "spl" ? "rgba(168,85,247,0.5)" : "rgba(255,255,255,0.1)",
                    background: transferMode === "spl" ? "rgba(168,85,247,0.15)" : "rgba(255,255,255,0.03)",
                    color: transferMode === "spl" ? "#a855f7" : "#888", cursor: "pointer", fontSize: 13, fontWeight: 600,
                  }}>SPL Token</button>
                </div>
                {transferMode === "spl" && (
                  <div>
                    <label style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 4 }}>Token Mint Address</label>
                    <input value={actionParams.mint || ""} onChange={e => setActionParams({ ...actionParams, mint: e.target.value })} placeholder="Token mint address" style={inputStyle} />
                  </div>
                )}
                <div>
                  <label style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 4 }}>Recipient Address</label>
                  <input value={actionParams.to || ""} onChange={e => setActionParams({ ...actionParams, to: e.target.value })} placeholder="Any wallet address (agent or external)" style={inputStyle} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 4 }}>Amount ({transferMode === "sol" ? "SOL" : "tokens"})</label>
                  <input value={actionParams.amount || ""} onChange={e => setActionParams({ ...actionParams, amount: e.target.value })} placeholder={transferMode === "sol" ? "e.g. 0.1" : "e.g. 100"} type="number" step="any" style={inputStyle} />
                </div>
                <button onClick={executeWithParams} disabled={actionLoading} style={{ padding: "10px", borderRadius: "8px", border: "none", background: transferMode === "sol" ? "linear-gradient(135deg, #10b981, #059669)" : "linear-gradient(135deg, #a855f7, #7c3aed)", color: "#fff", cursor: "pointer", fontWeight: 600, fontSize: 14 }}>
                  {actionLoading ? "Sending..." : `Send ${transferMode === "sol" ? "SOL" : "SPL Tokens"}`}
                </button>
              </div>
            )}

            {actionModal.type === "recover" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: 16 }}>
                <div style={{ fontSize: 13, color: "#aaa", lineHeight: 1.6 }}>
                  Auto-scans for empty token accounts and closes them to reclaim rent SOL. No input needed.
                </div>
                <button onClick={executeWithParams} disabled={actionLoading} style={{ padding: "12px", borderRadius: "8px", border: "none", background: "linear-gradient(135deg, #f59e0b, #ef4444)", color: "#fff", cursor: "pointer", fontWeight: 600, fontSize: 14 }}>
                  {actionLoading ? "Scanning & Recovering..." : "Auto Scan & Recover SOL"}
                </button>
              </div>
            )}

            {actionModal.type === "swap" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: 16 }}>
                <div style={{ fontSize: 13, color: "#aaa", lineHeight: 1.6 }}>
                  Swap tokens via SPL Token Swap (devnet AMM). A pool must exist for the token pair.
                </div>
                <div>
                  <label style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 4 }}>Input Token (sell)</label>
                  <input value={actionParams.inputMint || ""} onChange={e => setActionParams({ ...actionParams, inputMint: e.target.value })} placeholder="Token mint address or SOL" style={inputStyle} />
                  <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                    <button type="button" onClick={() => setActionParams({ ...actionParams, inputMint: "So11111111111111111111111111111111111111112" })} style={{ padding: "2px 8px", borderRadius: 4, border: "1px solid rgba(59,130,246,0.2)", background: "rgba(59,130,246,0.08)", color: "#60a5fa", cursor: "pointer", fontSize: 10 }}>SOL</button>
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 4 }}>Output Token (buy)</label>
                  <input value={actionParams.outputMint || ""} onChange={e => setActionParams({ ...actionParams, outputMint: e.target.value })} placeholder="Token mint address" style={inputStyle} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 4 }}>Amount (raw token units)</label>
                  <input value={actionParams.amount || ""} onChange={e => setActionParams({ ...actionParams, amount: e.target.value })} placeholder="e.g. 1000000" type="number" step="any" style={inputStyle} />
                </div>
                <button onClick={executeWithParams} disabled={actionLoading} style={{ padding: "10px", borderRadius: "8px", border: "none", background: "linear-gradient(135deg, #06b6d4, #0891b2)", color: "#fff", cursor: "pointer", fontWeight: 600, fontSize: 14 }}>
                  {actionLoading ? "Swapping..." : "Execute Swap"}
                </button>
              </div>
            )}

            {actionModal.type === "liquidity" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: 16 }}>
                <div style={{ fontSize: 13, color: "#aaa", lineHeight: 1.6 }}>
                  Add liquidity to a Raydium CLMM pool on devnet. Enter the pool ID and token amounts.
                </div>
                <div>
                  <label style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 4 }}>Raydium Pool ID</label>
                  <input value={actionParams.poolId || ""} onChange={e => setActionParams({ ...actionParams, poolId: e.target.value })} placeholder="Raydium CLMM pool address" style={inputStyle} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 4 }}>Amount A (raw units)</label>
                  <input value={actionParams.amountA || ""} onChange={e => setActionParams({ ...actionParams, amountA: e.target.value })} placeholder="e.g. 1000000" type="number" step="any" style={inputStyle} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 4 }}>Amount B (raw units)</label>
                  <input value={actionParams.amountB || ""} onChange={e => setActionParams({ ...actionParams, amountB: e.target.value })} placeholder="e.g. 1000000" type="number" step="any" style={inputStyle} />
                </div>
                <button onClick={executeWithParams} disabled={actionLoading} style={{ padding: "10px", borderRadius: "8px", border: "none", background: "linear-gradient(135deg, #8b5cf6, #7c3aed)", color: "#fff", cursor: "pointer", fontWeight: 600, fontSize: 14 }}>
                  {actionLoading ? "Adding Liquidity..." : "Add Liquidity"}
                </button>
              </div>
            )}

            {/* Result */}
            {actionResult && (
              <div style={{ ...cardStyle, marginTop: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: actionResult.success ? "#10b981" : "#ef4444" }}>
                  {actionResult.success ? "Success" : "Failed"}
                </div>
                {actionResult.signature && <div style={{ fontSize: 11, color: "#888", wordBreak: "break-all" }}>Sig: {actionResult.signature}</div>}
                {actionResult.newBalance && <div style={{ fontSize: 13, color: "#10b981", marginTop: 4 }}>New Balance: {actionResult.newBalance.toFixed(4)} SOL</div>}
                {actionResult.error && <div style={{ fontSize: 12, color: "#ef4444", marginTop: 4 }}>{actionResult.error}</div>}
                {actionResult.data && <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>{JSON.stringify(actionResult.data, null, 2)}</div>}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
              <button onClick={() => setActionModal({ open: false, agentId: "", type: "" })} style={{ padding: "8px 18px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "#888", cursor: "pointer", fontSize: 13 }}>Close</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
      `}</style>
    </div>
  );
}

// Format live feed event data for human display
function formatEventData(e: WSEvent): React.ReactNode {
  const d = e.data as any;
  const agentLabel = d?.agentId ? <span style={{ color: "#60a5fa", fontWeight: 600 }}>{d.agentId}</span> : null;
  const r = d?.result;

  // Scan results
  if (r?.action === "scan_airdrops" && Array.isArray(r?.data)) {
    const total = r.data.length;
    const suspicious = r.data.filter((t: any) => t.suspicious).length;
    const safe = total - suspicious;
    return (
      <div>
        <div>{agentLabel} — Scanned {total} token{total !== 1 ? "s" : ""}: <span style={{ color: "#10b981" }}>{safe} safe</span>{suspicious > 0 && <>, <span style={{ color: "#ef4444" }}>{suspicious} suspicious</span></>}</div>
        {r.data.map((t: any, i: number) => (
          <div key={i} style={{ marginTop: 4, padding: "4px 8px", background: t.suspicious ? "rgba(239,68,68,0.08)" : "rgba(16,185,129,0.06)", borderRadius: 4, fontSize: 11 }}>
            <span style={{ color: t.suspicious ? "#f87171" : "#6ee7b7", fontWeight: 600 }}>{t.suspicious ? "⚠" : "✓"}</span>{" "}
            <span style={{ fontFamily: "monospace", fontSize: 10, color: "#888" }}>{t.mint?.slice(0, 8)}...</span>{" "}
            <span style={{ color: "#ddd" }}>{t.amount}</span>
            {t.reason && <span style={{ color: "#f59e0b", marginLeft: 8 }}>— {t.reason}</span>}
          </div>
        ))}
      </div>
    );
  }

  // Transfer results
  if (r?.action === "transfer" || r?.action === "transfer-sol") {
    return <div>{agentLabel} — {r.success ? "✓ Transfer sent" : "✗ Transfer failed"}{r.signature && <span style={{ color: "#666", fontFamily: "monospace", fontSize: 10 }}> tx: {r.signature?.slice(0, 12)}...</span>}</div>;
  }

  // Auto-recover
  if (r?.action === "auto-recover") {
    return <div>{agentLabel} — Recovered {r.recovered} account{r.recovered !== 1 ? "s" : ""}{r.signature && <span style={{ color: "#666", fontFamily: "monospace", fontSize: 10 }}> tx: {r.signature?.slice(0, 12)}...</span>}</div>;
  }

  // DerMercist cycle
  if (e.event === "dermercist:cycle") {
    return <div>DerMercist ran on {Array.isArray(d?.results) ? d.results.length : "?"} agent(s)</div>;
  }

  // Agent created
  if (e.event === "agent:created") {
    return <div>New agent <span style={{ color: "#60a5fa", fontWeight: 600 }}>{d?.id}</span> created</div>;
  }

  // Generic fallback — short summary
  if (r?.success !== undefined) {
    return <div>{agentLabel} — {r.success ? "✓" : "✗"} {r.action || "action"}{r.error ? <span style={{ color: "#f87171" }}> — {r.error}</span> : ""}</div>;
  }

  return <span style={{ color: "#666" }}>{JSON.stringify(d).slice(0, 200)}</span>;
}

// Helper styles
const cardStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: "12px",
  padding: "16px",
  backdropFilter: "blur(10px)",
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 14px",
  color: "#666",
  fontWeight: 600,
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.5px",
};

const tdStyle: React.CSSProperties = {
  padding: "10px 14px",
  color: "#ccc",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 14px",
  borderRadius: "8px",
  border: "1px solid rgba(255,255,255,0.1)",
  background: "rgba(255,255,255,0.05)",
  color: "#e0e0e0",
  fontSize: 13,
  fontFamily: "monospace",
  outline: "none",
  boxSizing: "border-box",
};

function actionBtn(color: string): React.CSSProperties {
  return {
    padding: "5px 12px",
    borderRadius: "6px",
    border: `1px solid ${color}33`,
    background: `${color}15`,
    color: color,
    cursor: "pointer",
    fontSize: 11,
    fontWeight: 500,
  };
}

function eventColor(event: string): { bg: string; fg: string } {
  if (event.includes("dermercist")) return { bg: "rgba(168,85,247,0.15)", fg: "#a855f7" };
  if (event.includes("created")) return { bg: "rgba(59,130,246,0.15)", fg: "#60a5fa" };
  if (event.includes("executed")) return { bg: "rgba(16,185,129,0.15)", fg: "#10b981" };
  if (event.includes("removed")) return { bg: "rgba(239,68,68,0.15)", fg: "#ef4444" };
  return { bg: "rgba(136,136,136,0.15)", fg: "#888" };
}

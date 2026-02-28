"use client";

import { useState, useEffect, useRef, useCallback } from "react";

const API = "http://localhost:4000";

type TabType = "dashboard" | "portfolio" | "decisions" | "scamcheck" | "recovery";

interface Agent {
  id: string;
  publicKey: string;
  balance: number;
  pendingTx: number;
  lastAction?: string;
  skills: string[];
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

  // Action modal
  const [actionModal, setActionModal] = useState<{ open: boolean; agentId: string; type: string }>({ open: false, agentId: "", type: "" });
  const [actionParams, setActionParams] = useState<Record<string, string>>({});
  const [actionResult, setActionResult] = useState<any>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);

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

  // Create agent
  const createAgent = async () => {
    if (!newAgentId.trim()) return;
    setLoading(true);
    try {
      await fetch(`${API}/api/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: newAgentId }),
      });
      setNewAgentId("");
      setShowModal(false);
      fetchAgents();
    } catch { }
    setLoading(false);
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
      const res = await fetch(`${API}/api/agents/${actionModal.agentId}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: actionModal.type, params: actionParams }),
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
        {(["dashboard", "portfolio", "decisions", "scamcheck", "recovery"] as TabType[]).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "8px 16px", borderRadius: "6px", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 500,
            background: tab === t ? "rgba(59,130,246,0.15)" : "transparent",
            color: tab === t ? "#60a5fa" : "#888",
            transition: "all 0.2s",
          }}>
            {t === "dashboard" ? "Dashboard" : t === "portfolio" ? "Portfolio" : t === "decisions" ? "Decision History" : t === "scamcheck" ? "Scam Checker" : "Recovery"}
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

            {/* Agent Cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "16px", marginBottom: "24px" }}>
              {agents.map(a => (
                <div key={a.id} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "14px", padding: "20px", backdropFilter: "blur(10px)", transition: "border-color 0.2s" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>{a.id}</div>
                    <div style={{ padding: "3px 10px", borderRadius: "12px", fontSize: 11, background: a.pendingTx > 0 ? "rgba(245,158,11,0.15)" : "rgba(16,185,129,0.15)", color: a.pendingTx > 0 ? "#f59e0b" : "#10b981" }}>
                      {a.pendingTx > 0 ? "Executing" : "Ready"}
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: "#666", fontFamily: "monospace", marginBottom: 12, wordBreak: "break-all" }}>{a.publicKey}</div>
                  <div style={{ fontSize: 28, fontWeight: 700, color: "#10b981", marginBottom: 12 }}>{a.balance.toFixed(4)} SOL</div>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: 12 }}>
                    {a.skills.map(s => (
                      <span key={s} style={{ padding: "2px 8px", borderRadius: "4px", fontSize: 10, background: "rgba(59,130,246,0.1)", color: "#60a5fa", border: "1px solid rgba(59,130,246,0.2)" }}>{s}</span>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    <button onClick={() => executeAction(a.id, "scan_airdrops")} style={actionBtn("#3b82f6")}>Scan</button>
                    <button onClick={() => requestAirdrop(a.id)} style={actionBtn("#10b981")}>Airdrop</button>
                    <button onClick={() => openActionForm(a.id, "transfer")} style={actionBtn("#f59e0b")}>Transfer</button>
                    <button onClick={() => openActionForm(a.id, "recover")} style={actionBtn("#ef4444")}>Recover</button>
                    <button onClick={() => { setSelectedAgent(a.id); setTab("portfolio"); }} style={actionBtn("#8b5cf6")}>Portfolio</button>
                    <button onClick={() => { setSelectedAgent(a.id); setTab("decisions"); }} style={actionBtn("#a855f7")}>History</button>
                  </div>
                </div>
              ))}
            </div>

            {/* Live Event Feed */}
            <div>
              <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#10b981", animation: "pulse 2s infinite" }}></span>
                Live Event Feed
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
                    <span style={{ color: "#999", flex: 1, wordBreak: "break-all" }}>{JSON.stringify(e.data)}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

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
      </main>

      {/* Create Agent Modal */}
      {showModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }} onClick={() => setShowModal(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "16px", padding: "28px", width: 380, backdropFilter: "blur(20px)" }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>Create Agent</h3>
            <input
              value={newAgentId}
              onChange={e => setNewAgentId(e.target.value)}
              placeholder="Agent ID (e.g., Trader, Scout)"
              style={{ width: "100%", padding: "10px 14px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", color: "#e0e0e0", fontSize: 14, marginBottom: 14, outline: "none", boxSizing: "border-box" }}
              onKeyDown={e => e.key === "Enter" && createAgent()}
            />
            <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
              <button onClick={() => setShowModal(false)} style={{ padding: "8px 18px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "#888", cursor: "pointer", fontSize: 13 }}>Cancel</button>
              <button onClick={createAgent} disabled={loading} style={{ padding: "8px 18px", borderRadius: "8px", border: "none", background: "linear-gradient(135deg, #3b82f6, #8b5cf6)", color: "#fff", cursor: "pointer", fontWeight: 600, fontSize: 13 }}>Create</button>
            </div>
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
                <div>
                  <label style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 4 }}>Token Mint Address</label>
                  <input value={actionParams.mint || ""} onChange={e => setActionParams({ ...actionParams, mint: e.target.value })} placeholder="Token mint address" style={inputStyle} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 4 }}>Recipient Address</label>
                  <input value={actionParams.to || ""} onChange={e => setActionParams({ ...actionParams, to: e.target.value })} placeholder="Recipient wallet address" style={inputStyle} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 4 }}>Amount (tokens)</label>
                  <input value={actionParams.amount || ""} onChange={e => setActionParams({ ...actionParams, amount: e.target.value })} placeholder="Amount" type="number" style={inputStyle} />
                </div>
                <button onClick={executeWithParams} disabled={actionLoading} style={{ padding: "10px", borderRadius: "8px", border: "none", background: "linear-gradient(135deg, #f59e0b, #ef4444)", color: "#fff", cursor: "pointer", fontWeight: 600, fontSize: 14 }}>
                  {actionLoading ? "Executing..." : "Execute Transfer"}
                </button>
              </div>
            )}

            {actionModal.type === "recover" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: 16 }}>
                <div>
                  <label style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 4 }}>Token Account Address (empty account to close)</label>
                  <input value={actionParams.tokenAccount || ""} onChange={e => setActionParams({ ...actionParams, tokenAccount: e.target.value })} placeholder="Token account address" style={inputStyle} />
                </div>
                <button onClick={executeWithParams} disabled={actionLoading} style={{ padding: "10px", borderRadius: "8px", border: "none", background: "linear-gradient(135deg, #ef4444, #dc2626)", color: "#fff", cursor: "pointer", fontWeight: 600, fontSize: 14 }}>
                  {actionLoading ? "Executing..." : "Close Account & Recover SOL"}
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

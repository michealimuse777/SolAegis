"use client";

import { useEffect, useState, useRef } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:4001";

interface AgentState {
  id: string;
  publicKey: string;
  balance: number;
  pendingTx: number;
  lastAction?: string;
  lastResult?: {
    success: boolean;
    action: string;
    signature?: string;
    error?: string;
  };
  skills: string[];
}

interface WsEvent {
  event: string;
  data: any;
  timestamp: number;
}

export default function Dashboard() {
  const [agents, setAgents] = useState<AgentState[]>([]);
  const [events, setEvents] = useState<WsEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [newAgentId, setNewAgentId] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Fetch agents
  const fetchAgents = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/agents`);
      if (res.ok) {
        const data = await res.json();
        setAgents(data);
      }
    } catch {
      // Backend not running — show demo state
    } finally {
      setLoading(false);
    }
  };

  // WebSocket connection
  useEffect(() => {
    fetchAgents();

    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        const data: WsEvent = JSON.parse(event.data);
        setEvents((prev) => [data, ...prev].slice(0, 50));
        // Refresh agents on relevant events
        if (
          data.event.startsWith("agent:") ||
          data.event.startsWith("task:") ||
          data.event.startsWith("dermercist:")
        ) {
          fetchAgents();
        }
      };

      ws.onerror = () => { };
      ws.onclose = () => { };

      return () => ws.close();
    } catch {
      // WS not available
    }
  }, []);

  // Create agent
  const createAgent = async () => {
    if (!newAgentId.trim()) return;
    try {
      const res = await fetch(`${API_BASE}/api/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: newAgentId.trim() }),
      });
      if (res.ok) {
        setNewAgentId("");
        setShowCreateModal(false);
        fetchAgents();
      }
    } catch { }
  };

  // Execute action
  const executeAction = async (agentId: string, action: string) => {
    setActionInProgress(`${agentId}-${action}`);
    try {
      await fetch(`${API_BASE}/api/agents/${agentId}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, params: {} }),
      });
      fetchAgents();
    } catch {
    } finally {
      setActionInProgress(null);
    }
  };

  // Run DerMercist
  const runDerMercist = async () => {
    setActionInProgress("dermercist");
    try {
      await fetch(`${API_BASE}/api/dermercist/run`, { method: "POST" });
      fetchAgents();
    } catch {
    } finally {
      setActionInProgress(null);
    }
  };

  // Get balance color
  const getBalanceColor = (balance: number) => {
    if (balance >= 1) return "text-emerald-400";
    if (balance >= 0.1) return "text-amber-400";
    return "text-rose-400";
  };

  const getStatusDot = (agent: AgentState) => {
    if (agent.pendingTx > 0) return "warning";
    if (agent.balance < 0.01) return "danger";
    return "";
  };

  return (
    <div className="min-h-screen">
      {/* ───── Header ───── */}
      <header className="border-b border-[var(--glass-border)] bg-[var(--glass-bg)] backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-cyan-400 flex items-center justify-center text-white font-bold text-lg shadow-lg shadow-indigo-500/20">
              S
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">
                <span className="gradient-text">SolAegis</span>
              </h1>
              <p className="text-xs text-[var(--text-muted)]">
                Autonomous DeFi Infrastructure
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={runDerMercist}
              disabled={actionInProgress === "dermercist"}
              className="btn-ghost flex items-center gap-2"
            >
              <span>🧠</span>
              {actionInProgress === "dermercist" ? "Running..." : "DerMercist"}
            </button>
            <button
              onClick={() => setShowCreateModal(true)}
              className="btn-primary flex items-center gap-2"
            >
              <span>+</span> New Agent
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* ───── Stats Row ───── */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8 animate-fade-in">
          <StatCard
            label="Total Agents"
            value={agents.length.toString()}
            icon="🤖"
            accent="indigo"
          />
          <StatCard
            label="Total Balance"
            value={`${agents.reduce((s, a) => s + a.balance, 0).toFixed(4)} SOL`}
            icon="💰"
            accent="emerald"
          />
          <StatCard
            label="Pending Txns"
            value={agents.reduce((s, a) => s + a.pendingTx, 0).toString()}
            icon="⏳"
            accent="amber"
          />
          <StatCard
            label="Live Events"
            value={events.length.toString()}
            icon="📡"
            accent="cyan"
          />
        </div>

        {/* ───── Agent Grid ───── */}
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            Active Agents
          </h2>
          <button onClick={fetchAgents} className="btn-ghost text-sm py-2 px-4">
            ↻ Refresh
          </button>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[1, 2, 3].map((i) => (
              <div key={i} className="glass-card p-6 h-48 shimmer" />
            ))}
          </div>
        ) : agents.length === 0 ? (
          <div className="glass-card p-12 text-center animate-fade-in">
            <div className="text-4xl mb-4">🛡️</div>
            <h3 className="text-xl font-semibold mb-2">No Agents Yet</h3>
            <p className="text-[var(--text-secondary)] mb-6">
              Create your first autonomous DeFi agent to get started.
            </p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="btn-primary"
            >
              + Create Agent
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {agents.map((agent, i) => (
              <div
                key={agent.id}
                className="glass-card p-6 animate-slide-up cursor-pointer"
                style={{ animationDelay: `${i * 100}ms` }}
                onClick={() =>
                  setSelectedAgent(
                    selectedAgent === agent.id ? null : agent.id
                  )
                }
              >
                {/* Agent Header */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-600/30 to-cyan-500/20 border border-indigo-500/20 flex items-center justify-center text-lg">
                      🤖
                    </div>
                    <div>
                      <h3 className="font-semibold text-[var(--text-primary)]">
                        {agent.id}
                      </h3>
                      <p className="text-xs text-[var(--text-muted)] font-mono">
                        {agent.publicKey.slice(0, 8)}...
                        {agent.publicKey.slice(-6)}
                      </p>
                    </div>
                  </div>
                  <div className={`pulse-dot ${getStatusDot(agent)}`} />
                </div>

                {/* Balance */}
                <div className="mb-4">
                  <p className="text-xs text-[var(--text-muted)] mb-1 uppercase tracking-wider">
                    Balance
                  </p>
                  <p className={`text-2xl font-bold ${getBalanceColor(agent.balance)}`}>
                    {agent.balance.toFixed(4)}{" "}
                    <span className="text-sm font-normal text-[var(--text-muted)]">
                      SOL
                    </span>
                  </p>
                </div>

                {/* Status Badges */}
                <div className="flex flex-wrap gap-2 mb-4">
                  {agent.pendingTx > 0 && (
                    <span className="stat-badge warning">
                      ⏳ {agent.pendingTx} pending
                    </span>
                  )}
                  {agent.lastAction && (
                    <span className="stat-badge info">
                      Last: {agent.lastAction}
                    </span>
                  )}
                  {agent.lastResult && (
                    <span
                      className={`stat-badge ${agent.lastResult.success ? "success" : "danger"
                        }`}
                    >
                      {agent.lastResult.success ? "✓" : "✗"}
                    </span>
                  )}
                </div>

                {/* Actions (expanded) */}
                {selectedAgent === agent.id && (
                  <div className="mt-4 pt-4 border-t border-[var(--glass-border)]">
                    <p className="text-xs text-[var(--text-muted)] mb-3 uppercase tracking-wider">
                      Quick Actions
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {["scan_airdrops", "recover", "transfer", "swap"].map(
                        (action) => (
                          <button
                            key={action}
                            onClick={(e) => {
                              e.stopPropagation();
                              executeAction(agent.id, action);
                            }}
                            disabled={
                              actionInProgress === `${agent.id}-${action}`
                            }
                            className="btn-ghost text-xs py-2 px-3"
                          >
                            {actionInProgress === `${agent.id}-${action}`
                              ? "..."
                              : action.replace("_", " ")}
                          </button>
                        )
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ───── Event Feed ───── */}
        {events.length > 0 && (
          <div className="mt-10 animate-fade-in">
            <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">
              📡 Live Event Feed
            </h2>
            <div className="glass-card p-4 max-h-64 overflow-y-auto">
              {events.map((ev, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 py-2 border-b border-[var(--glass-border)] last:border-0"
                >
                  <span className="text-xs text-[var(--text-muted)] font-mono min-w-[70px]">
                    {new Date(ev.timestamp).toLocaleTimeString()}
                  </span>
                  <span className="stat-badge info text-xs">{ev.event}</span>
                  <span className="text-xs text-[var(--text-secondary)] truncate flex-1">
                    {JSON.stringify(ev.data).slice(0, 100)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* ───── Create Modal ───── */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="glass-card p-8 w-full max-w-md animate-slide-up">
            <h3 className="text-xl font-bold mb-6">Create New Agent</h3>
            <input
              type="text"
              value={newAgentId}
              onChange={(e) => setNewAgentId(e.target.value)}
              placeholder="Agent name (e.g. Trader)"
              className="w-full px-4 py-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--glass-border)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-indigo)] transition-colors mb-4"
              onKeyDown={(e) => e.key === "Enter" && createAgent()}
              autoFocus
            />
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowCreateModal(false)}
                className="btn-ghost"
              >
                Cancel
              </button>
              <button onClick={createAgent} className="btn-primary">
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ───── Footer ───── */}
      <footer className="border-t border-[var(--glass-border)] mt-16 py-6 text-center text-xs text-[var(--text-muted)]">
        SolAegis — Autonomous Multi-Agent DeFi Infrastructure on Solana Devnet
      </footer>
    </div>
  );
}

/* ─── Stat Card Component ─── */
function StatCard({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: string;
  icon: string;
  accent: string;
}) {
  const gradients: Record<string, string> = {
    indigo: "from-indigo-600/20 to-indigo-600/5",
    emerald: "from-emerald-600/20 to-emerald-600/5",
    amber: "from-amber-600/20 to-amber-600/5",
    cyan: "from-cyan-600/20 to-cyan-600/5",
  };

  return (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-[var(--text-muted)] uppercase tracking-wider font-medium">
          {label}
        </span>
        <div
          className={`w-8 h-8 rounded-lg bg-gradient-to-br ${gradients[accent] || gradients.indigo
            } flex items-center justify-center text-sm`}
        >
          {icon}
        </div>
      </div>
      <p className="text-2xl font-bold text-[var(--text-primary)]">{value}</p>
    </div>
  );
}

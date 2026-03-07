"use client";

import { useState, useEffect, useRef } from "react";

interface Agent {
  id: string;
  publicKey: string;
  balance: number;
  config: { role: string; allowedActions: string[] };
}

interface AgentLog {
  type: "command" | "result" | "error" | "streaming";
  text: string;
  timestamp: number;
}

const PRESET_COMMANDS = [
  { label: "Swap SOL → USDC", value: "swap 0.01 SOL to USDC", icon: "💱" },
  { label: "Scan for Scams", value: "scan for scams", icon: "🔍" },
  { label: "Recover Rent", value: "recover unused accounts", icon: "🧹" },
  { label: "Check Balance", value: "what is my balance?", icon: "💰" },
  { label: "Scan Airdrops", value: "scan airdrops", icon: "📡" },
  { label: "Airdrop SOL", value: "airdrop me some SOL", icon: "💧" },
  { label: "Schedule: Scam Check 6h", value: "scan for scams every 6 hours", icon: "⏰" },
  { label: "Schedule: Balance 1h", value: "check balance every hour", icon: "⏰" },
  { label: "Custom…", value: "__custom__", icon: "✏️" },
];

export default function MultiAgentDemo({
  agents,
  token,
  apiUrl,
}: {
  agents: Agent[];
  token: string | null;
  apiUrl: string;
}) {
  const [selectedAgentIds, setSelectedAgentIds] = useState<Set<string>>(new Set());
  const [agentCommands, setAgentCommands] = useState<Record<string, string>>({});
  const [customInputs, setCustomInputs] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<Record<string, AgentLog[]>>({});
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-select first 3 agents
  useEffect(() => {
    if (selectedAgentIds.size === 0 && agents.length >= 2) {
      setSelectedAgentIds(new Set(agents.slice(0, 3).map(a => a.id)));
    }
  }, [agents]);

  function toggleAgent(id: string) {
    setSelectedAgentIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelectedAgentIds(new Set(agents.map(a => a.id)));
  }

  function deselectAll() {
    setSelectedAgentIds(new Set());
  }

  function setCommand(agentId: string, cmd: string) {
    setAgentCommands(prev => ({ ...prev, [agentId]: cmd }));
  }

  function addLog(agentId: string, type: AgentLog["type"], text: string) {
    setLogs(prev => ({
      ...prev,
      [agentId]: [...(prev[agentId] || []), { type, text, timestamp: Date.now() }],
    }));
  }

  function getCommand(agentId: string): string {
    const cmd = agentCommands[agentId];
    if (cmd === "__custom__") return customInputs[agentId] || "";
    if (cmd) return cmd;
    // Default by role
    const agent = agents.find(a => a.id === agentId);
    const role = (agent?.config?.role || "").toLowerCase();
    if (role.includes("trade")) return "swap 0.01 SOL to USDC";
    if (role.includes("secur") || role.includes("scan")) return "scan for scams";
    if (role.includes("clean") || role.includes("maint")) return "recover unused accounts";
    return "what is my balance?";
  }

  async function runDemo() {
    const demoIds = [...selectedAgentIds];
    if (demoIds.length < 1) return;

    // Validate all have commands
    for (const id of demoIds) {
      const cmd = getCommand(id);
      if (!cmd) {
        addLog(id, "error", "No command set");
        return;
      }
    }

    setLogs({});
    setCompleted(new Set());
    setElapsed(0);
    setRunning(true);

    const startTime = Date.now();
    timerRef.current = setInterval(() => setElapsed(Date.now() - startTime), 100);

    await Promise.allSettled(
      demoIds.map(async (agentId) => {
        const message = getCommand(agentId);
        addLog(agentId, "command", `→ ${message}`);

        try {
          const res = await fetch(`${apiUrl}/api/agents/${encodeURIComponent(agentId)}/chat`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ message }),
          });

          const data = await res.json();
          const intent = data.intents?.[0] || data.intent;

          if (intent?.type) {
            const intentLabel = intent.type === "schedule" ? `⏰ Schedule: ${intent.action} every ${intent.interval}`
              : intent.type === "delay" ? `⏳ Delay: ${intent.action} in ${intent.delay}`
              : `📋 ${intent.type}${intent.action ? ` → ${intent.action}` : ""}`;
            addLog(agentId, "result", intentLabel);
          }

          if (data.executionResult?.success) {
            const sig = data.executionResult.signature;
            addLog(agentId, "result", `✅ Done${sig ? ` · ${sig.slice(0, 12)}…` : ""}`);
          } else {
            const reply = data.reply || "";
            addLog(agentId, "result", reply.length > 100 ? reply.slice(0, 100) + "…" : reply || "✅ OK");
          }

          setCompleted(prev => new Set([...prev, agentId]));
        } catch (err: any) {
          addLog(agentId, "error", `❌ ${err.message || "Failed"}`);
          setCompleted(prev => new Set([...prev, agentId]));
        }
      })
    );

    if (timerRef.current) clearInterval(timerRef.current);
    setElapsed(Date.now() - startTime);
    setRunning(false);
  }

  const demoAgents = agents.filter(a => selectedAgentIds.has(a.id));
  const allDone = completed.size >= demoAgents.length && demoAgents.length > 0;
  const failCount = [...completed].filter(id => (logs[id] || []).some(l => l.type === "error")).length;

  return (
    <div style={{ maxWidth: "900px", margin: "0 auto", width: "100%" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px", flexWrap: "wrap", gap: "8px" }}>
        <div>
          <h2 style={{ fontSize: "15px", fontWeight: 600, color: "#e0e0e0", margin: 0 }}>
            ⚡ Multi-Agent Control Center
          </h2>
          <p style={{ fontSize: "11px", color: "#666", margin: "4px 0 0" }}>
            Select agents, assign commands, and execute simultaneously
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {(running || allDone) && (
            <span style={{ fontSize: "11px", color: allDone ? "#22c55e" : "#00e0ff", fontFamily: "monospace" }}>
              {allDone ? "✅ " : ""}{(elapsed / 1000).toFixed(1)}s
            </span>
          )}
          <button
            onClick={runDemo}
            disabled={running || selectedAgentIds.size < 1}
            style={{
              padding: "8px 20px",
              background: running ? "#333" : selectedAgentIds.size < 1 ? "#222" : "linear-gradient(135deg, #00e0ff 0%, #0090ff 100%)",
              color: running || selectedAgentIds.size < 1 ? "#666" : "#0a0a0a",
              border: "none", borderRadius: "6px", fontSize: "12px", fontWeight: 600,
              cursor: running || selectedAgentIds.size < 1 ? "not-allowed" : "pointer",
              textTransform: "uppercase", letterSpacing: "0.05em",
            }}
          >
            {running ? "Running…" : allDone ? "Run Again" : `Run ${selectedAgentIds.size} Agent${selectedAgentIds.size !== 1 ? "s" : ""}`}
          </button>
        </div>
      </div>

      {/* Agent Selector Bar */}
      <div style={{
        display: "flex", alignItems: "center", gap: "6px", marginBottom: "14px", flexWrap: "wrap",
        padding: "10px 12px", background: "rgba(255,255,255,0.02)", borderRadius: "8px",
        border: "1px solid rgba(255,255,255,0.06)",
      }}>
        <span style={{ fontSize: "10px", color: "#666", textTransform: "uppercase", letterSpacing: "0.08em", marginRight: "4px" }}>Agents:</span>
        {agents.map(a => (
          <button
            key={a.id}
            onClick={() => toggleAgent(a.id)}
            disabled={running}
            style={{
              padding: "4px 10px", borderRadius: "4px", fontSize: "11px", fontWeight: 500,
              border: `1px solid ${selectedAgentIds.has(a.id) ? "rgba(0,224,255,0.4)" : "rgba(255,255,255,0.08)"}`,
              background: selectedAgentIds.has(a.id) ? "rgba(0,224,255,0.1)" : "transparent",
              color: selectedAgentIds.has(a.id) ? "#00e0ff" : "#666",
              cursor: running ? "not-allowed" : "pointer",
              transition: "all 0.15s",
            }}
          >
            {selectedAgentIds.has(a.id) ? "✓ " : ""}{a.id.length > 12 ? a.id.slice(0, 12) + "…" : a.id}
          </button>
        ))}
        <div style={{ marginLeft: "auto", display: "flex", gap: "6px" }}>
          <button onClick={selectAll} disabled={running} style={{ fontSize: "10px", color: "#555", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>All</button>
          <button onClick={deselectAll} disabled={running} style={{ fontSize: "10px", color: "#555", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>None</button>
        </div>
      </div>

      {/* Agent Cards Grid */}
      {demoAgents.length > 0 && (
        <div style={{
          display: "grid",
          gridTemplateColumns: `repeat(auto-fill, minmax(240px, 1fr))`,
          gap: "10px", marginBottom: "12px",
        }}>
          {demoAgents.map(agent => {
            const agentLogs = logs[agent.id] || [];
            const isDone = completed.has(agent.id);
            const hasError = agentLogs.some(l => l.type === "error");
            const currentCmd = agentCommands[agent.id] || "";
            const isCustom = currentCmd === "__custom__";

            return (
              <div key={agent.id} style={{
                background: "rgba(255,255,255,0.02)",
                border: `1px solid ${isDone ? (hasError ? "rgba(239,68,68,0.3)" : "rgba(34,197,94,0.3)") : running ? "rgba(0,224,255,0.2)" : "rgba(255,255,255,0.06)"}`,
                borderRadius: "8px", padding: "10px", transition: "border-color 0.3s",
              }}>
                {/* Agent Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <span style={{ fontSize: "12px", fontWeight: 600, color: "#e0e0e0" }}>
                    {agent.id.length > 16 ? agent.id.slice(0, 16) + "…" : agent.id}
                  </span>
                  <span style={{
                    fontSize: "9px", padding: "2px 6px", borderRadius: "3px",
                    background: isDone ? (hasError ? "rgba(239,68,68,0.12)" : "rgba(34,197,94,0.12)") : running ? "rgba(0,224,255,0.08)" : "rgba(255,255,255,0.04)",
                    color: isDone ? (hasError ? "#ef4444" : "#22c55e") : running ? "#00e0ff" : "#555",
                    fontWeight: 600, textTransform: "uppercase",
                  }}>
                    {isDone ? (hasError ? "failed" : "done") : running ? "exec" : "ready"}
                  </span>
                </div>

                {/* Role + Address */}
                <div style={{ fontSize: "10px", color: "#555", marginBottom: "6px" }}>
                  {agent.config?.role || "agent"} · {agent.publicKey?.slice(0, 6)}… ·{" "}
                  {agent.balance != null ? `${Number(agent.balance).toFixed(3)} SOL` : "?"}
                </div>

                {/* Command Selector */}
                {!running && (
                  <div style={{ marginBottom: "6px" }}>
                    <select
                      value={currentCmd || ""}
                      onChange={e => setCommand(agent.id, e.target.value)}
                      style={{
                        width: "100%", padding: "5px 8px", fontSize: "11px",
                        background: "#1a1a1a", color: "#ccc", border: "1px solid rgba(255,255,255,0.1)",
                        borderRadius: "4px", outline: "none",
                      }}
                    >
                      <option value="">Auto (by role)</option>
                      {PRESET_COMMANDS.map(c => (
                        <option key={c.value} value={c.value}>{c.icon} {c.label}</option>
                      ))}
                    </select>
                    {isCustom && (
                      <input
                        type="text"
                        placeholder="Type custom command…"
                        value={customInputs[agent.id] || ""}
                        onChange={e => setCustomInputs(prev => ({ ...prev, [agent.id]: e.target.value }))}
                        style={{
                          width: "100%", padding: "5px 8px", fontSize: "11px", marginTop: "4px",
                          background: "#111", color: "#e0e0e0", border: "1px solid rgba(0,224,255,0.2)",
                          borderRadius: "4px", outline: "none", boxSizing: "border-box",
                        }}
                      />
                    )}
                  </div>
                )}

                {/* Logs */}
                <div style={{
                  minHeight: "40px", maxHeight: "100px", overflowY: "auto",
                  fontSize: "11px", fontFamily: "monospace", lineHeight: "1.5",
                }}>
                  {agentLogs.length === 0 && !running && (
                    <span style={{ color: "#444" }}>
                      {getCommand(agent.id) ? `Will run: ${getCommand(agent.id).slice(0, 40)}…` : "Select a command"}
                    </span>
                  )}
                  {agentLogs.map((log, i) => (
                    <div key={i} style={{
                      color: log.type === "error" ? "#ef4444" : log.type === "command" ? "#00e0ff" : "#8b8b8b",
                      overflowWrap: "break-word",
                    }}>
                      {log.text}
                    </div>
                  ))}
                  {running && !isDone && (
                    <div style={{ color: "#00e0ff" }}>
                      <span className="demo-pulse">●</span> Processing…
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Summary */}
      {allDone && (
        <div style={{
          padding: "8px 12px", background: "rgba(34,197,94,0.05)",
          border: "1px solid rgba(34,197,94,0.12)", borderRadius: "6px",
          fontSize: "11px", color: "#888", display: "flex", justifyContent: "space-between",
          flexWrap: "wrap", gap: "4px",
        }}>
          <span>✅ {completed.size} agents executed in {(elapsed / 1000).toFixed(1)}s</span>
          <span>
            <span style={{ color: "#22c55e" }}>{completed.size - failCount} passed</span>
            {failCount > 0 && <> · <span style={{ color: "#ef4444" }}>{failCount} failed</span></>}
          </span>
        </div>
      )}

      <style>{`
        @keyframes demoPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
        .demo-pulse { animation: demoPulse 1.5s infinite; }
      `}</style>
    </div>
  );
}

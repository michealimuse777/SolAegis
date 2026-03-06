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

const DEMO_COMMANDS: Record<string, { message: string; icon: string }> = {
  trader: { message: "swap 0.01 SOL to USDC", icon: "💱" },
  scanner: { message: "scan for scams", icon: "🔍" },
  cleaner: { message: "recover unused accounts", icon: "🧹" },
  monitor: { message: "what is my balance?", icon: "💰" },
  default: { message: "what can you do?", icon: "🤖" },
};

function getRoleCommand(agent: Agent): { message: string; icon: string } {
  const role = (agent.config?.role || "").toLowerCase();
  const actions = agent.config?.allowedActions || [];
  if (role.includes("trade") || actions.includes("swap")) return DEMO_COMMANDS.trader;
  if (role.includes("secur") || role.includes("scan") || actions.includes("scam_check")) return DEMO_COMMANDS.scanner;
  if (role.includes("clean") || role.includes("maint") || actions.includes("recover")) return DEMO_COMMANDS.cleaner;
  if (role.includes("monitor") || role.includes("watch")) return DEMO_COMMANDS.monitor;
  return DEMO_COMMANDS.default;
}

export default function MultiAgentDemo({
  agents,
  token,
  apiUrl,
  wsUrl,
}: {
  agents: Agent[];
  token: string | null;
  apiUrl: string;
  wsUrl?: string;
}) {
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<Record<string, AgentLog[]>>({});
  const [activeAgents, setActiveAgents] = useState<Set<string>>(new Set());
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // WebSocket for live streaming
  useEffect(() => {
    const url = wsUrl || apiUrl.replace("https://", "wss://").replace("http://", "ws://");
    const ws = new WebSocket(url);
    ws.onopen = () => { wsRef.current = ws; };
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "agent:action" && msg.agentId) {
          addLog(msg.agentId, "streaming", msg.message || `${msg.action}: ${msg.status}`);
        }
      } catch { }
    };
    ws.onerror = () => ws.close();
    ws.onclose = () => { wsRef.current = null; };
    return () => ws.close();
  }, [apiUrl, wsUrl]);

  function addLog(agentId: string, type: AgentLog["type"], text: string) {
    setLogs((prev) => ({
      ...prev,
      [agentId]: [...(prev[agentId] || []), { type, text, timestamp: Date.now() }],
    }));
  }

  async function runDemo() {
    if (agents.length < 2) {
      alert("Create at least 2 agents to run the multi-agent demo");
      return;
    }

    // Reset state
    setLogs({});
    setCompleted(new Set());
    setElapsed(0);
    setRunning(true);

    const demoAgents = agents.slice(0, 5); // Max 5 at once
    setActiveAgents(new Set(demoAgents.map((a) => a.id)));

    // Start timer
    const startTime = Date.now();
    timerRef.current = setInterval(() => {
      setElapsed(Date.now() - startTime);
    }, 100);

    // Fire all agents simultaneously
    await Promise.allSettled(
      demoAgents.map(async (agent) => {
        const { message, icon } = getRoleCommand(agent);
        addLog(agent.id, "command", `${icon} ${message}`);

        try {
          const res = await fetch(`${apiUrl}/api/agents/${encodeURIComponent(agent.id)}/chat`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ message }),
          });

          const data = await res.json();
          const intent = data.intents?.[0] || data.intent;
          const reply = data.reply || "";

          // Log intent
          if (intent?.type) {
            addLog(agent.id, "result", `📋 Intent: ${intent.type}${intent.action ? ` → ${intent.action}` : ""}`);
          }

          // Log result
          if (data.executionResult?.success) {
            const sig = data.executionResult.signature;
            addLog(agent.id, "result", `✅ Executed${sig ? ` — ${sig.slice(0, 16)}...` : ""}`);
          } else if (reply) {
            const shortReply = reply.length > 120 ? reply.slice(0, 120) + "…" : reply;
            addLog(agent.id, "result", shortReply);
          }

          setCompleted((prev) => new Set([...prev, agent.id]));
        } catch (err: any) {
          addLog(agent.id, "error", `❌ ${err.message || "Failed"}`);
          setCompleted((prev) => new Set([...prev, agent.id]));
        }
      })
    );

    // Stop timer
    if (timerRef.current) clearInterval(timerRef.current);
    setElapsed(Date.now() - startTime);
    setRunning(false);
  }

  const demoAgents = agents.slice(0, 5);
  const allDone = completed.size >= demoAgents.length && demoAgents.length > 0;

  return (
    <div style={{
      background: "linear-gradient(135deg, rgba(0,224,255,0.03) 0%, rgba(0,0,0,0) 50%)",
      border: "1px solid rgba(0,224,255,0.12)",
      borderRadius: "12px",
      padding: "20px",
      marginTop: "16px",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
        <div>
          <h2 style={{ fontSize: "14px", fontWeight: 600, color: "#e0e0e0", margin: 0 }}>
            ⚡ Multi-Agent Autonomous Demo
          </h2>
          <p style={{ fontSize: "11px", color: "#666", margin: "4px 0 0" }}>
            {demoAgents.length} agents will execute simultaneously
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {running && (
            <span style={{ fontSize: "11px", color: "#00e0ff", fontFamily: "monospace" }}>
              {(elapsed / 1000).toFixed(1)}s
            </span>
          )}
          {allDone && !running && (
            <span style={{ fontSize: "11px", color: "#22c55e", fontFamily: "monospace" }}>
              ✅ {(elapsed / 1000).toFixed(1)}s
            </span>
          )}
          <button
            onClick={runDemo}
            disabled={running || agents.length < 2}
            style={{
              padding: "8px 20px",
              background: running ? "#333" : "linear-gradient(135deg, #00e0ff 0%, #0090ff 100%)",
              color: running ? "#888" : "#0a0a0a",
              border: "none",
              borderRadius: "6px",
              fontSize: "12px",
              fontWeight: 600,
              cursor: running ? "not-allowed" : "pointer",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              transition: "all 0.2s",
            }}
          >
            {running ? (
              <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{
                  width: "12px", height: "12px",
                  border: "2px solid #666", borderTopColor: "#00e0ff",
                  borderRadius: "50%",
                  animation: "spin 0.8s linear infinite",
                }} />
                Running…
              </span>
            ) : allDone ? "Run Again" : "Run Autonomous Agents"}
          </button>
        </div>
      </div>

      {/* Agent Grid */}
      <div style={{
        display: "grid",
        gridTemplateColumns: `repeat(${Math.min(demoAgents.length, 3)}, 1fr)`,
        gap: "12px",
      }}>
        {demoAgents.map((agent) => {
          const agentLogs = logs[agent.id] || [];
          const isActive = activeAgents.has(agent.id);
          const isDone = completed.has(agent.id);
          const hasError = agentLogs.some((l) => l.type === "error");
          const { icon } = getRoleCommand(agent);

          return (
            <div
              key={agent.id}
              style={{
                background: "rgba(255,255,255,0.02)",
                border: `1px solid ${isDone ? (hasError ? "rgba(239,68,68,0.3)" : "rgba(34,197,94,0.3)") : isActive && running ? "rgba(0,224,255,0.25)" : "rgba(255,255,255,0.06)"}`,
                borderRadius: "8px",
                padding: "12px",
                transition: "border-color 0.3s",
              }}
            >
              {/* Agent Header */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ fontSize: "14px" }}>{icon}</span>
                  <span style={{ fontSize: "12px", fontWeight: 600, color: "#e0e0e0" }}>
                    {agent.id.length > 14 ? agent.id.slice(0, 14) + "…" : agent.id}
                  </span>
                </div>
                <span style={{
                  fontSize: "9px",
                  padding: "2px 6px",
                  borderRadius: "4px",
                  background: isDone
                    ? (hasError ? "rgba(239,68,68,0.15)" : "rgba(34,197,94,0.15)")
                    : isActive && running ? "rgba(0,224,255,0.1)" : "rgba(255,255,255,0.05)",
                  color: isDone
                    ? (hasError ? "#ef4444" : "#22c55e")
                    : isActive && running ? "#00e0ff" : "#666",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  fontWeight: 600,
                }}>
                  {isDone ? (hasError ? "failed" : "done") : isActive && running ? "executing" : "idle"}
                </span>
              </div>

              {/* Agent Role */}
              <div style={{ fontSize: "10px", color: "#555", marginBottom: "8px" }}>
                {agent.config?.role || "agent"} · {agent.publicKey?.slice(0, 8)}…
              </div>

              {/* Logs */}
              <div style={{
                minHeight: "60px",
                maxHeight: "120px",
                overflowY: "auto",
                fontSize: "11px",
                fontFamily: "monospace",
                lineHeight: "1.6",
              }}>
                {agentLogs.length === 0 && !running && (
                  <span style={{ color: "#444" }}>Waiting…</span>
                )}
                {agentLogs.map((log, i) => (
                  <div
                    key={i}
                    style={{
                      color: log.type === "error" ? "#ef4444" : log.type === "command" ? "#00e0ff" : log.type === "streaming" ? "#a78bfa" : "#8b8b8b",
                      overflowWrap: "break-word",
                    }}
                  >
                    {log.text}
                  </div>
                ))}
                {isActive && running && !isDone && (
                  <div style={{ color: "#00e0ff" }}>
                    <span style={{ animation: "pulse 1.5s infinite" }}>●</span> Processing…
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Summary */}
      {allDone && (
        <div style={{
          marginTop: "12px",
          padding: "8px 12px",
          background: "rgba(34,197,94,0.06)",
          border: "1px solid rgba(34,197,94,0.15)",
          borderRadius: "6px",
          fontSize: "11px",
          color: "#888",
          display: "flex",
          justifyContent: "space-between",
        }}>
          <span>
            ✅ {completed.size} agents executed simultaneously in {(elapsed / 1000).toFixed(1)}s
          </span>
          <span style={{ color: "#22c55e" }}>
            {completed.size - [...completed].filter((id) => (logs[id] || []).some((l) => l.type === "error")).length} passed
            {[...completed].filter((id) => (logs[id] || []).some((l) => l.type === "error")).length > 0 && (
              <> · <span style={{ color: "#ef4444" }}>
                {[...completed].filter((id) => (logs[id] || []).some((l) => l.type === "error")).length} failed
              </span></>
            )}
          </span>
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
      `}</style>
    </div>
  );
}

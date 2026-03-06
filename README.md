# 🛡️ SolAegis

## Autonomous AI Agent Platform for Solana DeFi

SolAegis is a **self-custodial, AI-powered autonomous agent platform** for Solana. Users create intelligent agents that manage, monitor, and execute on-chain operations through **natural language chat**. Every agent has its own isolated encrypted wallet, risk-aware execution engine, and persistent memory.

**Built with:** TypeScript · Next.js · Express · Supabase · BullMQ · Solana Web3.js · Google Gemini · Orca Whirlpools

---

## ⚡ Key Features

### 🤖 Natural Language Chat Interface
- **4-layer architecture:** Chat UI → LLM Intent Parser → Policy Guard → Executor
- **Deterministic parser** handles common commands instantly (no LLM call needed)
- **Multi-command support:** _"swap 0.05 SOL to devUSDC and check my balance"_
- **WebSocket streaming** — responses appear character-by-character in real-time
- HTTP POST fallback when WebSocket disconnects

### ⛓️ On-Chain Actions
| Action | Description |
|--------|-------------|
| **Swap** | Token swaps via Orca Whirlpools (SOL ↔ devUSDC etc) |
| **Transfer** | Send SOL/SPL tokens to any address |
| **Airdrop** | Request devnet SOL airdrops |
| **Scam Check** | Analyze token safety (freeze authority, mint authority, supply) |
| **Recovery** | Close empty/dust token accounts to reclaim SOL rent |
| **Balance** | Real SOL + all SPL token balances |
| **Liquidity** | Open/close LP positions on Orca |
| **Market Data** | Live SOL price from CoinGecko (5-min cache) |

### 🗄️ Supabase Database (NEW)
- **4 tables:** `agents`, `agent_memory`, `audit_log`, `scheduled_jobs`
- **Row Level Security (RLS)** on all tables
- **Dual-write:** All data written to both Supabase and local JSON files
- **Supabase-first reads** with JSON file fallback
- Service role key never exposed to frontend

### 📡 WebSocket Streaming (NEW)
- Real-time streaming of LLM responses via WebSocket
- Auto-reconnect with 3-second backoff
- 45-second client-side timeout
- Streaming block updates character-by-character in the UI
- HTTP POST fallback when WS is disconnected

### 🧠 LLM Resilience (NEW)
- **5-key rotation** with round-robin cycling
- **Exponential backoff** between retries (500ms → 1s → 2s)
- **Per-key blacklisting** after 3 consecutive failures (60s cooldown)
- **30-second request timeout** with AbortController
- Structured error responses: `{ error, fallbackUsed }`
- Differentiated handling: 429 (rate limit) vs 500 (server) vs network errors

### ⏰ Scheduler Reliability (NEW)
- BullMQ cron jobs with **3 retry attempts** and exponential backoff
- **30-second job timeout** to prevent hanging jobs
- Concurrency limit (3) and rate limiter (5 jobs/min)
- Jobs persisted to Supabase `scheduled_jobs` table
- Natural language intervals: _"every 5 minutes"_, _"daily"_, _"every 2 hours"_

### 📊 Live Dashboard
- **RiskPanel** with Config, Memory, Schedule, and History tabs
- Schedule and History tabs **auto-refresh every 10 seconds**
- Agent analytics, portfolio tracking, decision memory
- Dark premium theme with glassmorphism

### 🔐 Security
| Layer | Protection |
|-------|-----------|
| Auth | JWT tokens (password or Phantom wallet signature) |
| API | Rate limiting, CORS, auth middleware on all agent routes |
| Input | Prompt injection detection, input sanitization, max length |
| Policy | PolicyEngine checks every action against agent config before execution |
| Scheduler | Guardrail middleware, max 20 active jobs |
| Database | Supabase Row Level Security — users only access own agents |
| Keys | LLM API keys + wallet keys encrypted at rest (AES-256-CBC) |
| Audit | Every action logged to file AND Supabase (dual-write) |

---

## Architecture

```
Frontend (Next.js)  ←→  Backend (Express + WebSocket)  ←→  Solana Devnet
     ↕                        ↕            ↕                    ↕
  Phantom Wallet           Supabase     BullMQ/Redis        Orca DEX
                              ↕
                         CoinGecko API
```

---

## Project Structure

```
solaegis/
├── backend/
│   ├── core/
│   │   ├── agent.ts              Agent class with state and skills
│   │   ├── agentManager.ts       Agent lifecycle management
│   │   ├── chatHandler.ts        4-layer NLP chat processor
│   │   ├── memory.ts             Agent memory (Supabase + file)
│   │   └── dermercist/           AI decision engine
│   │       ├── index.ts          Orchestration loop
│   │       ├── agentPlanner.ts   LLM + rules task prioritization
│   │       ├── llmInterface.ts   Structured LLM queries
│   │       └── rules.ts          Deterministic safety rules
│   │
│   ├── services/
│   │   ├── supabaseClient.ts     Supabase singleton (service role)
│   │   ├── supabaseStore.ts      Full CRUD for all tables
│   │   ├── marketData.ts         CoinGecko SOL price (5-min cache)
│   │   ├── walletService.ts      Encrypted wallet management
│   │   └── riskEngine.ts         Pre-execution validation
│   │
│   ├── skills/
│   │   ├── defiSkill.ts          Skill orchestrator
│   │   ├── swap.ts               Token swap via Orca
│   │   ├── transferSpl.ts        SPL token transfer
│   │   ├── jupiterClient.ts      Jupiter swap routing
│   │   ├── raydiumLiquidity.ts   Raydium LP operations
│   │   ├── airdropScanner.ts     Token account scanning
│   │   ├── solRecovery.ts        Rent recovery
│   │   └── scamFilter.ts         Token safety analysis
│   │
│   ├── llm/
│   │   ├── keyStore.ts           Encrypted API key storage
│   │   ├── llmManager.ts         Streaming + rotation + blacklisting
│   │   ├── promptTemplates.ts    Structured prompt templates
│   │   └── fallback.ts           Multi-provider fallback
│   │
│   ├── scheduler/
│   │   └── cronEngine.ts         BullMQ cron with retry/timeout
│   │
│   ├── security/
│   │   ├── auth.ts               JWT auth (password + Phantom)
│   │   ├── auditLog.ts           Dual-write audit logging
│   │   └── policyEngine.ts       Action policy enforcement
│   │
│   └── index.ts                  Express + WebSocket entry point
│
├── frontend/                     Next.js web dashboard
│   └── app/
│       ├── page.tsx              Main chat + agent UI
│       └── components/
│           ├── Sidebar.tsx       Agent list
│           ├── ExecutionStream.tsx  Chat message blocks
│           └── RiskPanel.tsx     Config/Memory/Schedule/History
│
├── scripts/
│   └── setupSupabase.ts          DB setup verification
│
├── .env                          Environment variables
├── SKILLS.md                     Agent-readable capability manifest
└── README.md                     This file
```

---

## Prerequisites

- **Node.js** 18+
- **Redis** (optional — scheduler degrades gracefully without it)
- **Supabase** project (free tier works)

---

## Installation

```bash
git clone https://github.com/michealimuse777/SolAegis.git
cd SolAegis
npm install
cd frontend && npm install && cd ..
```

---

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MASTER_KEY` | Yes | 64-char hex string for AES-256-CBC encryption |
| `SOLANA_RPC_URL` | No | Defaults to `https://api.devnet.solana.com` |
| `REDIS_URL` | No | Defaults to `redis://localhost:6379` |
| `SUPABASE_URL` | No | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | No | Supabase service role key (server-side only) |
| `SUPABASE_ANON_KEY` | No | Supabase publishable/anon key |
| `PORT` | No | REST API port (default: 4000) |
| `WS_PORT` | No | WebSocket port (default: 4001) |
| `LLM_KEY_1` – `LLM_KEY_10` | No | Gemini API keys for AI layer |

Generate a master key:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Supabase Setup

Run this SQL in your Supabase Dashboard → SQL Editor:

```sql
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL,
  public_key TEXT, config JSONB DEFAULT '{}'::jsonb,
  skills_doc TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS agent_memory (
  agent_id TEXT PRIMARY KEY, preferences JSONB DEFAULT '{}'::jsonb,
  notes JSONB DEFAULT '[]'::jsonb, successful_actions JSONB DEFAULT '[]'::jsonb,
  last_failures JSONB DEFAULT '[]'::jsonb, updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY, agent_id TEXT NOT NULL, user_id TEXT,
  action TEXT NOT NULL, status TEXT NOT NULL, tx_signature TEXT,
  reason TEXT, params JSONB, ip TEXT, created_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS scheduled_jobs (
  id BIGSERIAL PRIMARY KEY, agent_id TEXT NOT NULL, action TEXT NOT NULL,
  cron_pattern TEXT, interval_text TEXT, status TEXT DEFAULT 'active',
  bullmq_key TEXT, created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_jobs ENABLE ROW LEVEL SECURITY;
```

---

## Running

```bash
# Backend
npx tsx backend/index.ts

# Frontend (separate terminal)
cd frontend && npm run dev
```

Backend starts on `http://localhost:4000` (REST) and `ws://localhost:4001` (WebSocket).
Frontend opens at `http://localhost:3000`.

---

## Chat Commands

| Command | Example | Intent |
|---------|---------|--------|
| Swap tokens | _"swap 0.05 SOL to devUSDC"_ | `execute_action` → swap |
| Transfer | _"send 0.01 SOL to 9xK..."_ | `execute_action` → transfer |
| Check balance | _"what's my balance?"_ | `query_balance` |
| SOL price | _"what's the SOL price?"_ | `market_query` |
| Schedule task | _"scan for scams every 6 hours"_ | `schedule` |
| Stop schedule | _"stop scam check"_ | `unschedule` |
| Scan tokens | _"scan for scams"_ | `execute_action` → scam_check |
| Airdrop | _"airdrop me some SOL"_ | `execute_action` → airdrop |
| Recover SOL | _"recover unused accounts"_ | `execute_action` → recover |
| Agent status | _"what's your status?"_ | `query_status` |
| Multi-command | _"check balance and scan for scams"_ | Multiple intents |

---

## API Reference

### Auth
```
POST /api/auth/register    { username, password }
POST /api/auth/login       { username, password }
POST /api/auth/wallet      { publicKey, signature, message }
```

### Agents
```
GET    /api/agents
POST   /api/agents          { id, role?, riskProfile? }
DELETE /api/agents/:id
POST   /api/agents/:id/chat { message }
GET    /api/agents/:id/schedules
GET    /api/agents/:id/history
GET    /api/agents/:id/memory
DELETE /api/agents/:id/memory
```

### Market Data
```
GET /api/price/sol          → { sol_price, change_24h, trend, volume_24h, market_cap }
```

### Scheduler
```
GET    /api/cron/jobs
POST   /api/cron/schedule   { name, pattern, agentId, action }
DELETE /api/cron/jobs/:name  { pattern }
```

### System
```
GET /api/health
GET /api/skills
GET /api/llm/stats
```

---

## License

MIT

# SolAegis Architecture

A detailed technical breakdown of how SolAegis processes user instructions, from natural language input to on-chain transaction execution.

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         USER INTERFACES                             │
│                                                                     │
│    Web Dashboard (Next.js)     CLI (Commander.js)     WebSocket     │
│         │                           │                     │         │
│         └───────────────┬───────────┘                     │         │
│                         ▼                                 │         │
│              Express REST API ◄───────────────────────────┘         │
└─────────────────────────┬───────────────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────────────┐
│                      SECURITY LAYER                                 │
│                                                                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│  │ JWT Auth │ │ Rate     │ │ Input    │ │ Prompt   │ │ Ownership│ │
│  │          │ │ Limiter  │ │ Sanitize │ │ Inject   │ │ Isolation│ │
│  │          │ │          │ │          │ │ Guard    │ │          │ │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ │
│       └──────┬──────┘──────┬─────┘──────┬─────┘──────┬─────┘       │
│              ▼             ▼            ▼            ▼             │
└──────────────┬─────────────────────────────────────────────────────┘
               │
┌──────────────▼─────────────────────────────────────────────────────┐
│                    INTENT PIPELINE                                  │
│                                                                     │
│  User Message                                                       │
│       │                                                             │
│       ▼                                                             │
│  ┌────────────────────┐    exact match?    ┌──────────────────┐     │
│  │  Deterministic     │ ──── YES ────────► │  Structured      │     │
│  │  Parser (regex)    │                    │  Intent          │     │
│  └────────┬───────────┘                    └────────┬─────────┘     │
│           │ NO                                      │               │
│           ▼                                         │               │
│  ┌────────────────────┐                             │               │
│  │  LLM Intent Parser │ ──────────────────────────► │               │
│  │  (Gemini 2.5 Flash)│                             │               │
│  └────────────────────┘                             │               │
│                                                     ▼               │
│                                            ┌────────────────┐       │
│                                            │  ChatIntent[]  │       │
│                                            │  type, action, │       │
│                                            │  params        │       │
│                                            └───────┬────────┘       │
└────────────────────────────────────────────────────┬───────────────┘
                                                     │
┌────────────────────────────────────────────────────▼───────────────┐
│                     POLICY ENGINE                                   │
│                                                                     │
│  ┌──────────────┐  ┌───────────────┐  ┌────────────────────────┐   │
│  │ Action       │  │ Role          │  │ Transaction Limits     │   │
│  │ Whitelist    │  │ Restrictions  │  │ (per-tx + daily cap)   │   │
│  └──────┬───────┘  └──────┬────────┘  └───────────┬────────────┘   │
│         └────────────┬─────┘────────────┬──────────┘               │
│                      ▼                  ▼                           │
│              ┌──────────────┐  ┌──────────────┐                    │
│              │   ALLOWED    │  │   DENIED     │                    │
│              └──────┬───────┘  └──────┬───────┘                    │
│                     │                 │                              │
│                     ▼                 ▼                              │
│              Execute action    Return denial                        │
│                                with reason                          │
└─────────────────────┬──────────────────────────────────────────────┘
                      │
┌─────────────────────▼──────────────────────────────────────────────┐
│                  EXECUTION ENGINE                                   │
│                                                                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│  │  Swap    │ │ Transfer │ │ Recover  │ │ Scan     │ │ Scam     │ │
│  │  (Orca)  │ │ (SOL)    │ │ (Rent)   │ │ Airdrops │ │ Check    │ │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ │
│       └──────┬──────┘──────┬─────┘──────┬─────┘──────┬─────┘       │
│              ▼                                       ▼             │
│       ┌──────────────┐                    ┌──────────────────┐     │
│       │ Agent Wallet │                    │  Read-Only       │     │
│       │ (signs tx)   │                    │  Operations      │     │
│       └──────┬───────┘                    └──────────────────┘     │
│              │                                                      │
└──────────────┬─────────────────────────────────────────────────────┘
               │
┌──────────────▼─────────────────────────────────────────────────────┐
│                  SOLANA BLOCKCHAIN                                   │
│                                                                     │
│   ┌─────────────────┐    ┌─────────────────┐                       │
│   │  Solana Devnet   │    │  Orca Whirlpools │                      │
│   │  (RPC endpoint)  │    │  (DEX pools)     │                      │
│   └─────────────────┘    └─────────────────┘                       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Component Breakdown

### 1. Chat Interface Layer

```
backend/core/chatHandler.ts
```

The ChatHandler is the entry point for all user messages. It orchestrates the full intent pipeline.

**Responsibilities:**
- Receives raw user messages
- Maintains per-agent conversation history (last 20 messages)
- Delegates to deterministic parser first, then LLM parser
- Routes parsed intents to appropriate handlers
- Supports **multi-command splitting** ("scan scams and check balance" → 2 intents)

**Intent Types:**

| Intent Type | Description | Example |
|------------|-------------|---------|
| `execute_action` | Perform an action now | "Swap 0.1 SOL for USDC" |
| `schedule` | Repeat an action automatically | "Scan scams every 6 hours" |
| `delay` | Execute once after a delay | "Transfer 0.5 SOL in 2 hours" |
| `unschedule` | Stop a scheduled action | "Stop scanning for scams" |
| `update_config` | Change agent settings | "Switch to low risk mode" |
| `query_balance` | Check wallet balance | "What's my balance?" |
| `query_status` | Show agent status | "Show my settings" |
| `market_query` | Get SOL price data | "What's the SOL price?" |
| `remember` | Store a preference or note | "Remember I prefer conservative strategies" |
| `explain` | List capabilities | "What can you do?" |
| `capability_check` | Check unsupported features | "Can you bridge to Ethereum?" |

---

### 2. Deterministic Parser

```
backend/core/chatHandler.ts → parseSingleCommand()
```

Before any LLM call, a **regex-based deterministic parser** handles known command patterns.

**Why deterministic-first?**
- **Speed:** Regex matching is instant vs. 500ms–2s LLM latency
- **Reliability:** No hallucination, no misinterpretation
- **Security:** Reduces the LLM's attack surface
- **Cost:** Avoids unnecessary API calls for common patterns

**Patterns handled:**

| Pattern | Example | Parsed As |
|---------|---------|-----------|
| Swap | "swap 0.1 SOL for USDC" | `execute_action:swap` |
| Transfer | "send 0.5 SOL to ABC123" | `execute_action:transfer` |
| Schedule | "check scams every 6h" | `schedule:scam_check` |
| Delay | "transfer 0.1 SOL in 2h" | `delay:transfer` |
| Balance | "what's my balance" | `query_balance` |
| Scan | "scan airdrops" | `execute_action:scan_airdrops` |
| Stop | "stop scanning" | `unschedule` |

**Multi-command splitting:**
```
"scan scams and check balance"
    ↓ splits on "and"
["scan scams", "check balance"]
    ↓ parsed individually
[scam_check, query_balance]
```

---

### 3. LLM Intent Parser

```
backend/core/chatHandler.ts → parseIntents()
backend/llm/llmManager.ts
```

For **ambiguous messages** that don't match deterministic patterns, the system falls back to **Gemini 2.5 Flash**.

**LLM receives:**
- Agent ID, role, and allowed actions
- Full action mapping with synonyms
- Intent type definitions with examples
- The user's message

**LLM returns:**
- A JSON array of structured `ChatIntent` objects
- The array format supports multi-intent messages

**Key safeguards:**
- The LLM **never** generates cron expressions, transaction data, or private keys
- It only outputs structured intents that are validated before execution
- If LLM output can't be parsed as valid JSON, the system falls back to `unknown` intent

**LLM Manager features:**
- **Key rotation:** Cycles through 5 API keys to avoid rate limits
- **Provider fallback:** Falls back to secondary provider on failure
- **Retry logic:** Exponential backoff with 3 retries

---

### 4. Policy Engine

```
backend/services/policyEngine.ts
backend/core/agentConfig.ts
```

Every action must pass the policy engine before execution. This is the **critical security gate**.

**Checks performed:**

```
Intent arrives
    │
    ├─ Is action in allowedActions? ── NO ──► DENIED
    │
    ├─ Is role "monitor"? ── YES + write action ──► DENIED
    │
    ├─ Does amount exceed maxSolPerTx? ── YES ──► DENIED
    │
    ├─ Has dailyTxLimit been reached? ── YES ──► DENIED
    │
    └─ All checks pass ──► ALLOWED
```

**Per-agent configuration:**
```json
{
  "role": "trader",
  "riskProfile": "medium",
  "maxSolPerTx": 0.5,
  "dailyTxLimit": 10,
  "allowedActions": ["transfer", "swap", "scan_airdrops", "scam_check", "recover"]
}
```

---

### 5. Agent Wallet System

```
backend/core/agentManager.ts
backend/llm/keyStore.ts
```

Each agent gets an **independent Solana keypair** generated at creation time.

**Wallet lifecycle:**
1. `agentManager.create()` generates a new `Keypair`
2. The private key is encrypted with **AES-256-GCM** via KeyStore
3. The keypair is stored in memory for the session
4. On restart, keypairs are loaded from encrypted storage

**Key isolation:**
- Each agent's keypair is independent — no shared keys
- Agents can only sign transactions for their own wallet
- Private keys are decrypted only at transaction signing time

---

### 6. Execution Skills

```
backend/skills/defiSkill.ts
backend/skills/swap.ts
backend/skills/solRecovery.ts
backend/skills/scamFilter.ts
```

| Skill | Module | Description |
|-------|--------|-------------|
| **Swap** | `swap.ts` | Executes token swaps via Orca Whirlpools SDK |
| **Recovery** | `solRecovery.ts` | Finds empty token accounts, closes them, reclaims rent |
| **Scam Filter** | `scamFilter.ts` | Analyzes token mints for freeze/mint authority, metadata |
| **DeFi Skill** | `defiSkill.ts` | Orchestrates all skills, loads SKILLS.md |

**Swap execution flow:**
```
swapTokens(connection, payer, inputMint, outputMint, amount, slippage)
    │
    ├─ Resolve tick arrays for the Whirlpool
    ├─ Calculate swap quote
    ├─ Build swap instruction
    ├─ Sign with agent keypair
    ├─ Submit to Solana
    └─ Return signature + estimated output
```

---

### 7. Memory System

```
backend/core/memory.ts
backend/services/decisionMemory.ts
```

Agents maintain persistent memory across sessions.

**Memory types:**

| Type | Storage | Purpose |
|------|---------|---------|
| **Preferences** | `memory.json` | Key-value pairs (e.g., `strategy: conservative`) |
| **Notes** | `memory.json` | Free-text notes from user |
| **Success/Failure** | `memory.json` | Track which actions work vs. fail |
| **Decision Memory** | `DecisionMemory` | Full execution records with risk scores |
| **Position Tracker** | `PositionTracker` | Token positions and trade history |

**How memory influences behavior:**
```
User: "Remember I prefer conservative strategies"
    → Stored in memory.json: preferences.strategy = "conservative"

User: "What should I do?"
    → LLM receives memory context: "User prefers conservative strategies"
    → Agent recommends lower-risk actions
```

---

### 8. Scheduler

```
backend/scheduler/cronEngine.ts
```

Powered by **BullMQ + Redis**, the scheduler handles:

| Type | Description | Example |
|------|-------------|---------|
| **Cron jobs** | Recurring actions at fixed intervals | "Scan scams every 6h" |
| **Delayed jobs** | One-shot actions after a delay | "Transfer 0.1 SOL in 2h" |

**Safe interval conversion:**
```
User says: "every 6 hours"
Parser extracts: "6h"
System converts: "6h" → "0 */6 * * *"
```

The LLM **never** generates cron expressions. Only a predefined set of safe intervals is accepted.

---

### 9. SKILLS.md Framework

```
data/agents/{id}/SKILLS.md
```

Each agent loads a markdown file that acts as its **operating manual**.

**Contents:**
- Supported actions and when to use them
- Risk parameters per action
- Strategy guidelines
- Safety rules

**Hot reload:**
```
User: "reload skills"
    → System re-reads SKILLS.md
    → Agent immediately has updated capabilities
```

This separates agent behavior from application code — modify SKILLS.md, reload, and the agent adapts without any code deployment.

---

### 10. Real-Time Communication

```
WebSocket Server (port 4001)
```

The backend broadcasts events via WebSocket for real-time UI updates:

| Event | Trigger |
|-------|---------|
| `agent:created` | New agent created |
| `agent:removed` | Agent deleted |
| `agent:funded` | Airdrop received |
| `chat:message` | Chat message + reply |
| `chat:action` | Action executed |
| `task:executed` | Scheduled task completed |
| `config:updated` | Agent config changed |
| `cron:scheduled` | New scheduled job |
| `cron:delayed` | Delayed job queued |

---

## Data Flow — Complete Example

**User types:** `"Swap 0.05 SOL for USDC"`

```
1. [Frontend]    POST /api/agents/TraderBot/chat { message: "Swap 0.05 SOL for USDC" }

2. [Auth]        JWT validated → userId extracted
3. [Rate Limit]  Chat rate: 28/30 remaining → OK
4. [Sanitizer]   Input clean → OK
5. [Ownership]   TraderBot belongs to userId → OK
6. [Injection]   No prompt injection detected → OK

7. [Deterministic Parser]
   Regex match: /swap\s+([\d.]+)\s+(\w+)\s+(?:to|for)\s+(\w+)/
   → { type: "execute_action", action: "swap", params: { amount: "0.05", from: "SOL", to: "USDC" } }
   (LLM not called — deterministic match)

8. [Policy Engine]
   ✓ "swap" in allowedActions
   ✓ role is "trader" (not monitor)
   ✓ 0.05 SOL ≤ 0.5 maxSolPerTx
   ✓ 3/10 daily transactions used
   → ALLOWED

9. [Execution Engine]
   → swapTokens(connection, keypair, "SOL", "USDC", 0.05, 100)
   → Orca Whirlpool swap instruction built
   → Transaction signed by agent keypair
   → Submitted to Solana Devnet
   → Confirmed

10. [Audit]       Log: { action: "swap", status: "success", tx: "5Ky...3aB" }
11. [Memory]      Record success in decision memory
12. [WebSocket]   Broadcast: chat:action, task:executed
13. [Response]    Return reply + execution result + tx signature
```

---

## Technology Dependencies

```
┌─────────────────────────────────────────────┐
│              Application Layer              │
│  Express │ Commander │ Next.js │ React      │
├─────────────────────────────────────────────┤
│               Service Layer                 │
│  Gemini LLM │ BullMQ │ Supabase │ CoinGecko│
├─────────────────────────────────────────────┤
│             Blockchain Layer                │
│  @solana/web3.js │ @solana/spl-token        │
│  @orca-so/whirlpools-sdk │ TweetNaCl       │
├─────────────────────────────────────────────┤
│            Infrastructure Layer             │
│  Redis │ PostgreSQL (Supabase) │ Vercel     │
│  Railway │ Solana Devnet RPC                │
└─────────────────────────────────────────────┘
```

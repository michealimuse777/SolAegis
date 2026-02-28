# SolAegis

## Autonomous Multi-Agent DeFi Wallet Infrastructure on Solana Devnet

SolAegis is an autonomous, multi-agent DeFi wallet system built on the Solana blockchain. It provides encrypted wallet management, programmable DeFi skills, risk-aware transaction execution, and an AI-augmented decision engine. Every agent operates independently with its own isolated wallet, and all private keys are encrypted at rest using AES-256-CBC.

The system is designed for devnet prototyping and demonstration of autonomous agent coordination in decentralized finance scenarios.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [System Components](#system-components)
  - [Wallet Service](#wallet-service)
  - [Risk Engine](#risk-engine)
  - [DeFi Skills](#defi-skills)
  - [Agent Core](#agent-core)
  - [DerMercist Decision Engine](#dermercist-decision-engine)
  - [LLM Integration Layer](#llm-integration-layer)
  - [Cron Scheduler](#cron-scheduler)
  - [REST API and WebSocket Server](#rest-api-and-websocket-server)
  - [CLI Dashboard](#cli-dashboard)
  - [Web Dashboard](#web-dashboard)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running the System](#running-the-system)
- [API Reference](#api-reference)
- [Test Harness](#test-harness)
- [Security Model](#security-model)
- [Skills Manifest](#skills-manifest)
- [License](#license)

---

## Architecture Overview

```
                        +----------------------------+
                        |      Next.js Dashboard     |
                        +-------------+--------------+
                                      |
                               REST + WebSocket
                                      |
+-------------------------------------------------------------+
|                          Backend                            |
|-------------------------------------------------------------|
|                         |                                   |
|  Agent Manager          |  DerMercist Decision Engine       |
|  Wallet Service (AES)   |  LLM Integration (Multi-Key)     |
|  Risk Engine             |  Cron Scheduler (BullMQ)         |
|  DeFi Skills (7 modules) |  WebSocket Event Broadcast      |
|                         |                                   |
+-------------------------------------------------------------+
                                      |
                               Solana Devnet
```

The backend exposes a REST API and WebSocket server. The CLI and web dashboard connect to these endpoints. All agents share a common Risk Engine and DeFi Skill orchestrator, but each agent has its own encrypted wallet with full key isolation.

---

## System Components

### Wallet Service

Location: `backend/services/walletService.ts`

The Wallet Service manages the full lifecycle of Solana keypairs for every agent:

- **Key Generation**: Creates a new `Keypair` using `@solana/web3.js` for each agent.
- **Encryption at Rest**: The secret key is Base64-encoded and encrypted using AES-256-CBC with a master key loaded from the `MASTER_KEY` environment variable. The initialization vector (IV) is randomly generated per encryption and stored alongside the ciphertext.
- **Decryption**: Retrieves the encrypted key from storage, decrypts it, and reconstructs the `Keypair` object.
- **Transaction Signing**: Sets the fee payer, fetches the latest blockhash, signs the transaction, and sends it as a raw serialized transaction.
- **Balance Queries**: Retrieves the SOL balance associated with an agent's public key.
- **Storage**: Currently uses an in-memory `Map<string, string>` keyed by agent ID. This can be swapped for a persistent database in production.

The encryption module (`backend/services/encryption.ts`) implements AES-256-CBC with:
- A 32-byte master key read from the `MASTER_KEY` environment variable (64 hex characters).
- A random 16-byte IV per encryption operation.
- Output format: `iv_hex:ciphertext_hex`.

### Risk Engine

Location: `backend/services/riskEngine.ts`

The Risk Engine performs pre-execution validation on every transaction before it is sent to the network. This prevents failed transactions, which waste SOL on fees and create poor user experience.

Checks performed:

1. **SOL Balance Validation**: Verifies the payer has at least 0.01 SOL to cover transaction fees. If balance is insufficient, the transaction is rejected before simulation.

2. **Transaction Simulation**: Calls `connection.simulateTransaction()` to execute the transaction against current ledger state without committing. If the simulation returns an error, the transaction is rejected with the specific error details.

3. **Compute Budget Validation**: Checks the `unitsConsumed` field from the simulation result. Transactions consuming more than 1,400,000 compute units are rejected to avoid hitting the per-transaction compute limit.

4. **Duplicate Transaction Prevention**: Maintains a set of recent transaction hashes (computed from instruction data). If a transaction with identical instruction data is submitted within 60 seconds, it is rejected. Entries auto-expire after 60 seconds.

The Risk Engine also provides a `checkBalance()` method for quick balance checks used by the DerMercist decision layer.

### DeFi Skills

All skill modules live in `backend/skills/` and return unsigned `Transaction` objects. The orchestrator (`defiSkill.ts`) handles signing and sending.

#### SPL Token Transfer (`transferSpl.ts`)

Transfers SPL tokens from an agent's wallet to any Solana address. Automatically creates associated token accounts for both sender and recipient if they do not exist, using `getOrCreateAssociatedTokenAccount`.

Parameters: connection, payer keypair, token mint address, recipient public key, amount.

#### Token Swap (`swap.ts`)

Simulates a token swap on devnet by transferring token A from the user's account into a pool vault and withdrawing token B from the pool vault to the user's account. This is a simplified representation of AMM swap mechanics suitable for devnet demonstration.

Parameters: payer keypair, user token accounts A and B, pool vault accounts A and B, input amount, output amount.

#### Liquidity Provision (`provideLiquidity.ts`)

Provides dual-sided liquidity by depositing both token A and token B into their respective pool vaults. Both deposits are bundled into a single atomic transaction.

Parameters: payer keypair, user token accounts, pool vault accounts, amounts for both sides.

#### Airdrop Scanner (`airdropScanner.ts`)

Scans all token accounts owned by a wallet using `getParsedTokenAccountsByOwner`. Flags tokens as suspicious based on:
- Dust amounts (greater than 0 but less than 0.0001) — indicates potential airdrop spam.
- Abnormally large balances (greater than 1 billion) — indicates potential scam tokens.

Returns a structured list of all token accounts with their mint address, amount, and suspicion status.

#### SOL Recovery (`solRecovery.ts`)

Recovers rent-exempt SOL from empty token accounts by closing them. When a token account has a zero balance, this skill creates a `closeAccount` instruction that sends the rent lamports back to the agent's wallet.

Also provides `findRecoverableAccounts()` which scans all token accounts and returns those with zero balance.

#### Scam Token Filter (`scamFilter.ts`)

Performs heuristic safety analysis on a token mint address by inspecting on-chain mint data:
- **Freeze Authority**: If the mint has a freeze authority set, the token issuer can freeze any holder's tokens. Flagged as unsafe.
- **Mint Authority**: If the mint authority is still active, the issuer can inflate supply at will. Flagged as unsafe.
- **Supply Check**: If total supply exceeds 1 trillion, flagged as suspicious.
- **Decimals Check**: If decimals exceed 18, flagged as unusual.

Returns a structured result with `safe: boolean`, reason string, and detailed breakdown.

#### DeFi Skill Orchestrator (`defiSkill.ts`)

Central routing layer that:
1. Resolves the agent's keypair from the Wallet Service.
2. Routes the action to the appropriate skill module.
3. For swap operations, runs the scam filter on the input token mint before proceeding.
4. Passes the constructed transaction through the Risk Engine for validation.
5. Signs and sends the transaction via the Wallet Service.
6. Returns a structured result with success status, action name, transaction signature, or error.

The orchestrator also loads and exposes `SKILLS.md` from the project root, so agents can read their own capability manifest at runtime through the `getSkillsDocumentation()` method.

### Agent Core

#### Agent Class (`core/agent.ts`)

Each agent is an autonomous entity with:
- A unique string identifier.
- A reference to the shared Wallet Service (with its own encrypted wallet entry).
- A reference to the shared DeFi Skill orchestrator.
- State tracking: pending transaction count, last action, last result.
- The `readSkills()` method returns the contents of `SKILLS.md`, enabling the agent to introspect its own capabilities.

The `getState()` method returns a complete snapshot of the agent's current status, including public key, SOL balance, pending transactions, and available skill list.

#### Agent Manager (`core/agentManager.ts`)

Manages the lifecycle of all agents:
- `create(agentId)`: Generates a new agent with an auto-created encrypted wallet.
- `get(agentId)`: Retrieves an agent by ID.
- `list()`: Returns all active agents.
- `listStates()`: Returns the full state of all agents (async, includes balance queries).
- `remove(agentId)`: Removes an agent.

The Agent Manager owns the shared instances of Wallet Service, Risk Engine, and DeFi Skill orchestrator, passing them to each agent at creation.

### DerMercist Decision Engine

Location: `backend/core/dermercist/`

DerMercist is the autonomous decision-making brain that combines LLM intelligence with deterministic safety rules. It ensures agents never execute dangerous actions, even if the LLM suggests them.

#### Deterministic Rules (`rules.ts`)

Safety rules that cannot be overridden by the AI layer:

1. **Minimum Balance Rule**: If SOL balance is below 0.01, only recovery and hold actions are permitted.
2. **Pending Transaction Guard**: If any transactions are pending, all new actions are blocked (hold only).
3. **Maximum Swap Rule**: Swap amount cannot exceed 90% of the agent's balance.
4. **Failure Cooldown**: If the last execution of a specific action failed, that same action is blocked on the next cycle to prevent repeated failures.
5. **Liquidity Threshold**: Liquidity provision requires a minimum balance of 0.1 SOL.

Also includes a `prioritizeAction()` scoring function that assigns priority scores (0-100) based on agent state. Recovery actions get boosted when balance is low. Holding gets the lowest priority.

#### Agent Planner (`agentPlanner.ts`)

Combines LLM suggestions with deterministic rules:
1. Receives an LLM-suggested action and the agent's current state.
2. Passes the suggestion through `deterministicRules()`.
3. If rules reject the action, returns a `hold` task with the rejection reason.
4. If rules approve, calculates a priority score and returns the planned task.

Also provides `planMultipleTasks()` for batch planning and sorting by priority.

#### LLM Interface (`llmInterface.ts`)

Wraps LLM queries with structured parsing:
- `suggestAction()`: Asks the LLM what the agent should do next, given the current state.
- `assessRisk()`: Asks the LLM for a risk-level assessment.
- `getTradingAdvice()`: Asks for trading recommendations on a specific asset and strategy.
- All methods include JSON extraction logic that handles both raw JSON and markdown code block responses.
- All methods fall back to `{ action: "hold" }` if the LLM is unavailable or the response cannot be parsed.

#### Orchestrator (`index.ts`)

The main `DerMercist` class runs the full decision loop:
1. Get the agent's current state (balances, pending tx, last action).
2. Query the LLM for a suggested action.
3. Apply deterministic safety rules via the Agent Planner.
4. If the planned action is "hold", log the reason and stop.
5. Otherwise, execute the action through the DeFi Skill orchestrator.
6. Return a structured result with the plan, execution status, and any errors.

The `runAll()` method processes multiple agents sequentially to prevent conflicts such as two agents trying to close the same token account.

### LLM Integration Layer

Location: `backend/llm/`

The LLM layer provides multi-key API management with automatic rotation and provider fallback. The system operates fully without LLM keys configured — agents fall back to deterministic rules in the DerMercist engine.

#### Key Store (`keyStore.ts`)

Stores LLM API keys encrypted at rest using the same AES-256-CBC encryption as wallet keys:
- `addKey(rawKey)`: Encrypts and stores a new API key.
- `getDecryptedKey(index)`: Decrypts and returns a key by index.
- `incrementUsage(index)`: Tracks request counts per key for load balancing.
- `getLeastUsedIndex()`: Returns the index of the key with the fewest requests.
- `loadFromEnv()`: Loads keys from environment variables `LLM_KEY_1` through `LLM_KEY_10`.

#### LLM Manager (`llmManager.ts`)

Handles LLM API calls with automatic key rotation:
- Uses round-robin key cycling.
- On HTTP 429 (rate limit), automatically rotates to the next available key.
- Cycles through all keys up to 3 times before falling back.
- Supports multiple LLM providers with configurable endpoint URLs and request/response formats.
- If all keys are exhausted, returns a deterministic fallback response: `{ action: "hold", reason: "All LLM keys exhausted" }`.

#### Prompt Templates (`promptTemplates.ts`)

Structured prompt templates for agent decision-making:
- `tradingPrompt()`: Requests a trading action recommendation for a given asset and strategy.
- `riskAssessmentPrompt()`: Requests a risk-level evaluation of the agent's current state.
- `airdropAnalysisPrompt()`: Requests analysis of detected token accounts.
- `strategyPrompt()`: Requests a portfolio rebalancing strategy.

All templates instruct the LLM to output structured JSON for deterministic parsing.

#### Fallback (`fallback.ts`)

Multi-provider fallback logic:
- Tries the primary LLM provider first.
- If the primary exhausts all keys, switches to a secondary provider.
- If both fail, returns a deterministic hold response.
- Provides combined usage statistics across both providers.

### Cron Scheduler

Location: `backend/scheduler/cronEngine.ts`

BullMQ-based job scheduler for periodic agent tasks:
- **Graceful Degradation**: If Redis is unavailable, the scheduler logs a warning and the system continues without cron functionality. No crash, no error propagation.
- `initScheduler()`: Connects to Redis and creates the BullMQ queue.
- `scheduleCronJob()`: Adds a repeating job with a cron expression (default: every 10 minutes).
- `createWorker()`: Creates a BullMQ worker that processes jobs by running the DerMercist decision loop for the specified agent.
- `listScheduledJobs()`: Returns all configured repeatable jobs.
- `removeScheduledJob()`: Removes a repeatable job by name and cron expression.
- `shutdownScheduler()`: Gracefully closes the queue and Redis connection.

### REST API and WebSocket Server

Location: `backend/index.ts`

Express server providing:

**REST Endpoints:**
- `GET /api/health` — System status, RPC URL, agent count.
- `GET /api/agents` — List all agents with full state (balances, pending tx, skills).
- `POST /api/agents` — Create a new agent. Body: `{ "id": "AgentName" }`.
- `DELETE /api/agents/:id` — Remove an agent.
- `POST /api/agents/:id/execute` — Execute a task. Body: `{ "action": "...", "params": {...} }`.
- `POST /api/dermercist/run` — Run DerMercist decision loop for all agents.
- `POST /api/dermercist/run/:id` — Run DerMercist for a specific agent.
- `GET /api/skills` — Returns the SKILLS.md content.
- `GET /api/scheduler/jobs` — List all scheduled cron jobs.
- `POST /api/scheduler/schedule` — Schedule a new cron job.
- `GET /api/llm/stats` — LLM key usage statistics.

**WebSocket:**
- Connects on port 4001 (configurable via `WS_PORT`).
- Broadcasts real-time events: `agent:created`, `agent:removed`, `task:executed`, `dermercist:cycle`, `dermercist:result`, `cron:executed`.

### CLI Dashboard

Location: `cli/index.ts`

Interactive terminal interface using Inquirer for prompts and Chalk for styled output:
- List all agents with public key, balance, and status.
- Create new agents interactively.
- Execute DeFi tasks (transfer, swap, liquidity, recover, scan) on selected agents.
- Request SOL airdrops from devnet faucet.
- Scan token accounts for suspicious airdrops.
- Run the DerMercist decision loop.
- View SKILLS.md documentation.

### Web Dashboard

Location: `frontend/`

Next.js application with TailwindCSS providing:
- Header with SolAegis branding, DerMercist run button, and agent creation button.
- Stats row showing total agents, combined balance, pending transactions, and live event count.
- Agent card grid with glassmorphism styling, showing each agent's ID, public key, balance, status indicators, and last action results.
- Expandable quick-action panel on each agent card for triggering tasks.
- Live event feed powered by WebSocket, showing real-time system activity.
- Create agent modal with keyboard shortcut support.
- Dark premium theme with gradient accents, backdrop blur, micro-animations, and custom scrollbar styling.

---

## Project Structure

```
solaegis/
|
|-- backend/
|   |-- core/
|   |   |-- agent.ts                  Agent class with state and skill introspection
|   |   |-- agentManager.ts           Agent lifecycle management
|   |   +-- dermercist/
|   |       |-- index.ts              DerMercist orchestration loop
|   |       |-- agentPlanner.ts       LLM + rules task prioritization
|   |       |-- llmInterface.ts       Structured LLM query interface
|   |       +-- rules.ts              Deterministic safety rules
|   |
|   |-- services/
|   |   |-- encryption.ts             AES-256-CBC encrypt and decrypt
|   |   |-- walletService.ts          Wallet creation, signing, balance
|   |   +-- riskEngine.ts             Pre-execution validation pipeline
|   |
|   |-- skills/
|   |   |-- defiSkill.ts              Skill orchestrator with SKILLS.md loading
|   |   |-- transferSpl.ts            SPL token transfer
|   |   |-- swap.ts                   Token swap via pool vaults
|   |   |-- provideLiquidity.ts       Dual-sided liquidity deposit
|   |   |-- airdropScanner.ts         Token account scanning
|   |   |-- solRecovery.ts            Rent recovery from empty accounts
|   |   +-- scamFilter.ts             Token mint safety analysis
|   |
|   |-- llm/
|   |   |-- keyStore.ts               Encrypted API key storage
|   |   |-- llmManager.ts             Multi-key rotation and queries
|   |   |-- promptTemplates.ts        Structured prompt templates
|   |   +-- fallback.ts               Multi-provider fallback logic
|   |
|   |-- scheduler/
|   |   +-- cronEngine.ts             BullMQ cron with Redis degradation
|   |
|   |-- test/
|   |   +-- harness.ts                Multi-agent integration tests
|   |
|   +-- index.ts                      Express server entry point
|
|-- cli/
|   +-- index.ts                      Interactive CLI dashboard
|
|-- frontend/                         Next.js web dashboard
|
|-- SKILLS.md                         Agent-readable capability manifest
|-- README.md                         This file
|-- package.json
|-- tsconfig.json
|-- .env.example
+-- .gitignore
```

---

## Prerequisites

- **Node.js** 18 or later
- **npm** (included with Node.js)
- **Redis** (optional, required only for the cron scheduler; the system degrades gracefully without it)

---

## Installation

```bash
git clone https://github.com/michealimuse777/SolAegis.git
cd SolAegis
npm install
```

For the web dashboard:

```bash
cd frontend
npm install
cd ..
```

---

## Configuration

Copy the example environment file and fill in the required values:

```bash
cp .env.example .env
```

Generate a master encryption key (32 bytes, 64 hex characters):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Paste the output into your `.env` file as the `MASTER_KEY` value.

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MASTER_KEY` | Yes | 64-character hex string used for AES-256-CBC encryption of wallet keys and LLM API keys |
| `SOLANA_RPC_URL` | No | Solana RPC endpoint. Defaults to `https://api.devnet.solana.com` |
| `REDIS_URL` | No | Redis connection URL. Defaults to `redis://localhost:6379`. Scheduler disabled if unavailable |
| `PORT` | No | REST API port. Defaults to `4000` |
| `WS_PORT` | No | WebSocket port. Defaults to `4001` |
| `LLM_KEY_1` through `LLM_KEY_10` | No | LLM API keys for the AI decision layer. System uses deterministic rules if none provided |
| `LLM_PRIMARY_PROVIDER` | No | Primary LLM provider name. Defaults to `gemini` |
| `LLM_PRIMARY_MODEL` | No | Primary LLM model name |
| `LLM_FALLBACK_PROVIDER` | No | Fallback LLM provider name |
| `LLM_FALLBACK_MODEL` | No | Fallback LLM model name |

---

## Running the System

### Backend API Server

```bash
npm run dev
```

Starts the Express REST API on port 4000 and WebSocket server on port 4001. Attempts to connect to Redis for the cron scheduler; logs a warning and continues if Redis is unavailable.

### CLI Dashboard

```bash
npm run cli
```

Opens an interactive terminal menu for managing agents, executing tasks, requesting airdrops, and scanning tokens.

### Test Harness

```bash
npm test
```

Runs the multi-agent integration test suite. Generates a temporary encryption key if `MASTER_KEY` is not set. Tests cover agent creation, encryption round-trip, state retrieval, SKILLS.md access, risk engine validation, airdrop scanning, and agent manager operations.

### Web Dashboard

```bash
cd frontend
npm run dev
```

Opens the Next.js dashboard at `http://localhost:3000`. Connects to the backend REST API and WebSocket for live updates. Configure `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_WS_URL` environment variables in the frontend if the backend runs on non-default ports.

### TypeScript Type Check

```bash
npm run typecheck
```

Runs the TypeScript compiler in check-only mode with zero expected errors.

---

## API Reference

All endpoints are prefixed with the server base URL (default: `http://localhost:4000`).

### Health

```
GET /api/health
Response: { "status": "ok", "rpc": "<rpc_url>", "agents": <count> }
```

### Agents

```
GET /api/agents
Response: [ { "id": "...", "publicKey": "...", "balance": 0.0, "pendingTx": 0, "skills": [...] } ]

POST /api/agents
Body: { "id": "TraderBot" }
Response: { "id": "TraderBot", "publicKey": "..." }

DELETE /api/agents/:id
Response: { "removed": true }
```

### Task Execution

```
POST /api/agents/:id/execute
Body: { "action": "scan_airdrops", "params": {} }
Response: { "success": true, "action": "scan_airdrops", "data": [...] }
```

Supported actions: `transfer`, `swap`, `liquidity`, `recover`, `scan_airdrops`.

### DerMercist

```
POST /api/dermercist/run
Response: [ { "agentId": "...", "planned": {...}, "executed": true, "signature": "..." } ]

POST /api/dermercist/run/:id
Response: { "agentId": "...", "planned": {...}, "executed": true, "signature": "..." }
```

### Scheduler

```
GET /api/scheduler/jobs
Response: [ { "name": "...", "cron": "...", "next": "..." } ]

POST /api/scheduler/schedule
Body: { "agentId": "TraderBot", "action": "swap", "params": {}, "cron": "*/10 * * * *" }
Response: { "jobId": "..." }
```

### Skills

```
GET /api/skills
Response: { "skills": "<SKILLS.md content>" }
```

### LLM Statistics

```
GET /api/llm/stats
Response: [ { "index": 0, "requests": 5 }, { "index": 1, "requests": 3 } ]
```

---

## Test Harness

The test harness (`backend/test/harness.ts`) runs 7 integration tests:

| Test | Description |
|------|-------------|
| Agent Creation | Creates 3 agents (Trader, LiquidityProvider, AirdropScanner) and verifies unique wallets |
| Encryption Round-trip | Decrypts an agent's key and verifies it matches the original public key |
| Agent State | Verifies state structure: id, publicKey, balance, pendingTx, skills array |
| SKILLS.md Access | Verifies agents can read the SKILLS.md file at runtime |
| Risk Engine | Performs a balance check on a new devnet wallet |
| Airdrop Scan | Executes a read-only token account scan |
| Agent Manager | Verifies the manager correctly reports all created agents |

---

## Security Model

1. **Private Key Encryption**: All Solana keypairs are encrypted using AES-256-CBC with a randomly generated IV per encryption. The master key is never stored in code and must be provided via the `MASTER_KEY` environment variable.

2. **LLM Key Encryption**: LLM API keys are encrypted using the same AES-256-CBC scheme and stored only in encrypted form in memory.

3. **Pre-Execution Simulation**: Every transaction is simulated before signing. Transactions that would fail on-chain are rejected before any SOL is spent on fees.

4. **Scam Token Filtering**: All swap operations are filtered through the scam token filter. Tokens with active freeze authority, active mint authority, or suspicious supply are blocked.

5. **Deterministic Safety Rules**: The DerMercist engine enforces safety rules that cannot be overridden by the LLM. Even if the AI suggests a dangerous action, the rules layer will block it and default to a hold action.

6. **Duplicate Transaction Prevention**: The Risk Engine maintains a 60-second window of recent transaction hashes to prevent duplicate submissions.

7. **Agent Isolation**: Each agent has its own encrypted wallet entry. Agents cannot access each other's private keys.

---

## Skills Manifest

Agents can read the `SKILLS.md` file at runtime to understand their capabilities. The manifest is loaded by the DeFi Skill orchestrator and accessible via:
- `agent.readSkills()` in code.
- `GET /api/skills` via the REST API.
- The "View Skills" option in the CLI.

Category breakdown:

- **Wallet**: create_wallet, encrypted_key_storage, sign_transaction, multi_agent_isolation
- **DeFi**: transfer_spl, swap_tokens, provide_liquidity
- **Protection**: simulate_transaction, compute_budget_validation, balance_validation, scam_token_filter, prevent_failed_transactions, duplicate_tx_prevention
- **Recovery**: rent_recovery, close_empty_token_accounts, sol_reconciliation
- **Discovery**: airdrop_scanner, unclaimed_token_detection, token_safety_analysis
- **Automation**: cron_scheduler, autonomous_execution, scheduled_swaps, scheduled_recovery
- **Intelligence**: dermercist_decision_engine, llm_strategy_advisor, deterministic_safety_rules, risk_assessment, portfolio_strategy, key_rotation

---

## License

MIT

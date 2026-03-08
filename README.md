# SolAegis

**Autonomous Agentic Wallet Platform for Solana AI Agents**

SolAegis is an agentic wallet system for autonomous AI agents on Solana where users create intelligent agents that monitor, analyze, and execute on-chain actions through natural language.

Each AI agent controls its own wallet, manages funds, and executes on-chain actions independently while operating under strict security policies.

Agents interact through natural language and can:
- trade tokens
- transfer funds
- monitor wallets
- schedule actions
- store memory
- coordinate with other agents

All transactions are executed automatically on Solana Devnet through the agent's secure wallet.

---

## Demo Overview

The prototype demonstrates the following capabilities:

### Agent Creation

Agents are created programmatically with:
- unique identity
- encrypted wallet
- assigned role
- configuration and skillset

Each agent immediately receives a Solana wallet address capable of holding SOL and SPL tokens.

---

### Simultaneous Multi-Agent Execution

Multiple agents can execute tasks in parallel.

Example demo scenario:

```
Trader Agent   → check wallet balance
Security Agent → schedule scam scan
Trade Agent    → swap SOL for devUSDC
```

This demonstrates independent autonomous wallets acting simultaneously.

---

### Natural Language Agent Control

Agents understand free-form instructions, not just rigid commands.

Examples:

```
swap 0.05 SOL to USDC
transfer 0.5 SOL to <address> in 6 hours
scan for scams every 6 hours
recover unused accounts
```

The system converts messages into structured execution intents.

---

### Scheduling & Delayed Actions

Agents can schedule actions using natural language.

Examples:

```
transfer 0.5 SOL in 8 hours
scan tokens every 6 hours
recover unused accounts tomorrow
check balance and scan for scams
```

Scheduling is powered by BullMQ with Redis queues.

---

### Persistent Memory

Agents remember user preferences and previous context.

```
User:  I like day trading
Agent: Preference saved

User:  What trading strategy do I like?
Agent: You prefer day trading
```

This allows agents to adapt behavior over time.

---

### Dynamic Agent Configuration

Agents can reconfigure themselves through chat.

```
set my daily transaction cap to 3
```

The configuration updates the agent's execution policy engine.

---

### Agent Operating Manual (SKILLS.md)

Each agent loads a `SKILLS.md` document at runtime.

The file defines:
- agent capabilities
- execution procedures
- JSON intent schema
- safety rules

Agents can dynamically reload their skills using:

```
reload skills
```

This ensures the AI agent always follows a structured operational guide.

---

## Architecture

SolAegis separates AI decision making, wallet execution, and security policies to ensure autonomous agents remain safe and controlled.

```
User / CLI / Frontend
        │
        ▼
   Chat Interface
        │
        ▼
Deterministic Parser
  (Regex Commands)
        │
        ▼
 LLM Intent Parser
(Structured JSON Intents)
        │
        ▼
   Policy Engine
   (Risk + Limits)
        │
        ▼
  Execution Layer
   (Solana Web3.js)
        │
        ▼
   Agent Wallets
 (Isolated per Agent)
        │
        ▼
   Solana Devnet
```

**Supporting Systems:**

| System | Purpose |
|--------|---------|
| Memory System | Stores agent preferences and history |
| Scheduler | Delayed & repeating tasks via BullMQ |
| Market Service | Real-time SOL price data |
| Audit Log | Every action recorded |
| SKILLS.md | Agent operating manual |

### Deterministic Parser

Handles clear commands instantly using regex pattern matching.

### LLM Intent Parser

Converts natural language into structured JSON intents using an LLM.

### Policy Guard

Ensures actions comply with security policies before execution.

### Execution Engine

Constructs and submits Solana transactions through the agent's wallet.

---

## Agentic Wallet Design

Each agent has an independent wallet managed by the Wallet Service.

Capabilities include:
- programmatic wallet creation
- automatic transaction signing
- SOL and SPL token support
- safe key storage
- on-chain interaction with DeFi protocols

Wallets are used to execute operations such as:
- token swaps
- SOL transfers
- token account management
- airdrop requests
- account recovery

All transactions are executed automatically by the agent.

---

## Multi-Agent Scalability

The system supports multiple agents running independently.

Each agent maintains:
- its own wallet
- configuration
- skillset
- memory
- transaction history

Agents can run concurrently and perform independent blockchain actions.

---

## Security Architecture

Since autonomous agents control wallets, SolAegis implements 10 security layers.

| Layer | Protection |
|-------|-----------|
| Wallet Signature Authentication | Ed25519 wallet verification |
| JWT Authentication | Secure API session management |
| Prompt Injection Guard | Detects malicious LLM manipulation |
| Input Sanitization | Prevents XSS or injection attacks |
| Rate Limiting | Prevents spam and brute-force attacks |
| Agent Ownership Isolation | Users cannot access other agents |
| Policy Engine | Enforces transaction limits |
| Scheduler Guardrails | Prevents abusive scheduled jobs |
| Encrypted Wallet Storage | AES-256-GCM encrypted key storage |
| Audit Logging | Immutable log of all actions |

These safeguards ensure agents remain autonomous but controlled.

---

## Tech Stack

**Frontend**
- Next.js
- React
- WebSocket streaming

**Backend**
- Node.js
- Express
- BullMQ scheduler

**Blockchain**
- Solana Web3.js
- SPL Token SDK
- Devnet RPC

**Infrastructure**
- Supabase (database + persistence)
- Redis (task queue)
- LLM (intent parsing)

---

## CLI Interface

SolAegis also provides a developer CLI for interacting with agents directly from the terminal.

The CLI communicates with the backend API and exposes the same capabilities as the web interface.

Run using:

```bash
npx tsx cli/index.ts <command>
```

or

```bash
npm run cli -- <command>
```

### Authentication

Register or log in:

```bash
solaegis auth register -u <username> -p <password>
solaegis auth login -u <username> -p <password>
```

Verify wallet ownership:

```bash
solaegis auth wallet-verify -a <wallet-address>
```

### Agent Management

Create and manage agents:

```bash
solaegis agents list
solaegis agents create -n "TraderBot"
solaegis agents delete -a <agent-id>
```

### Chat with Agents

Send natural language instructions directly from the terminal.

Immediate actions:

```bash
solaegis chat -a <id> "Swap 1 SOL for USDC"
solaegis chat -a <id> "Check my balance"
```

Delayed actions:

```bash
solaegis chat -a <id> "Transfer 0.5 SOL to XYZ in 6 hours"
```

Scheduled actions:

```bash
solaegis chat -a <id> "Scan tokens every 6 hours"
```

Multi-command instructions:

```bash
solaegis chat -a <id> "Check balance and scan for scams"
```

### Agent Configuration

View or update agent policies:

```bash
solaegis config show -a <id>
solaegis config update -a <id> --max-sol 0.1
solaegis config update -a <id> --daily-tx-limit 3
```

### Monitoring

View agent activity and execution logs:

```bash
solaegis history -a <id>
solaegis audit -a <id>
solaegis jobs list -a <id>
```

### Why the CLI Exists

The CLI demonstrates that SolAegis is API-first infrastructure for AI agents, not just a UI application.

This allows:
- automated scripts
- developer integrations
- remote agent control
- infrastructure-style deployment

---

## Project Structure

```
solaegis/
  backend/
    core/           agent logic and execution pipeline
    services/       wallet, policies, market data
    skills/         DeFi interaction modules
    scheduler/      BullMQ job system
    security/       authentication and protection

  frontend/
    app/            main UI
    components/     chat and agent dashboard

  data/
    agents/{id}/
      config.json
      memory.json
      SKILLS.md
```

---

## Example Commands

Swap tokens:
```
swap 0.05 SOL to USDC
```

Transfer funds:
```
send 0.1 SOL to <address>
```

Delayed action:
```
transfer 0.5 SOL in 8 hours
```

Schedule monitoring:
```
scan for scams every 6 hours
```

Update configuration:
```
set daily transaction cap to 3
```

---

## Running the Prototype

Clone the repository:

```bash
git clone https://github.com/michealimuse777/SolAegis.git
cd SolAegis
```

Install dependencies:

```bash
npm install
cd frontend
npm install
```

Start backend:

```bash
npm run dev
```

Start frontend:

```bash
cd frontend
npm run dev
```

- Backend: `http://localhost:4000`
- Frontend: `http://localhost:3000`

The system runs fully on Solana Devnet.

---

## Why SolAegis

AI agents are becoming active participants in decentralized ecosystems.

However, for agents to operate autonomously they require:
- secure wallet infrastructure
- controlled transaction execution
- structured decision frameworks

SolAegis demonstrates how agentic wallets can enable AI agents to interact with DeFi safely and independently.

---

## License

MIT

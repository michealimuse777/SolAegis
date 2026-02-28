# SolAegis Skills

> This document defines all capabilities available to autonomous agents in the SolAegis system.
> Agents can read this file at runtime to understand their available actions.

## Wallet
- **create_wallet** — Generate a new Solana keypair with encrypted storage
- **encrypted_key_storage** — AES-256-CBC encryption for all private keys
- **sign_transaction** — Autonomous transaction signing
- **multi_agent_isolation** — Each agent has its own isolated wallet

## DeFi
- **transfer_spl** — Send SPL tokens to any Solana address
- **swap_tokens** — Exchange token A for token B via pool vaults
- **provide_liquidity** — Dual-sided liquidity deposit into pools

## Protection
- **simulate_transaction** — Pre-execution simulation on devnet
- **compute_budget_validation** — Reject transactions exceeding 1.4M compute units
- **balance_validation** — Ensure minimum SOL balance for fees (0.01 SOL)
- **scam_token_filter** — Heuristic checks: freeze authority, mint authority, supply limits
- **prevent_failed_transactions** — Full pre-flight validation pipeline
- **duplicate_tx_prevention** — Block duplicate transactions within 60s window

## Recovery
- **rent_recovery** — Close empty token accounts to reclaim rent SOL
- **close_empty_token_accounts** — Identify and close zero-balance accounts
- **sol_reconciliation** — Track and recover locked lamports

## Discovery
- **airdrop_scanner** — Scan all token accounts for dust/spam tokens
- **unclaimed_token_detection** — Identify suspicious or claimable airdrops
- **token_safety_analysis** — Deep inspection of token mint properties

## Automation
- **cron_scheduler** — BullMQ-powered repeating job scheduler
- **autonomous_execution** — Agents execute tasks without human intervention
- **scheduled_swaps** — Periodic automated token swaps
- **scheduled_recovery** — Periodic rent recovery sweeps

## Intelligence
- **dermercist_decision_engine** — Hybrid AI + rules decision layer
- **llm_strategy_advisor** — Multi-provider LLM integration (Gemini, OpenAI)
- **deterministic_safety_rules** — Rules that cannot be overridden by AI
- **risk_assessment** — LLM-powered risk evaluation
- **portfolio_strategy** — AI-driven portfolio rebalancing suggestions
- **key_rotation** — Encrypted multi-key rotation for API quota management

/**
 * Structured prompt templates for LLM-powered agent decision-making.
 */

export function tradingPrompt(asset: string, strategy: string): string {
    return `You are an autonomous Solana DeFi agent operating on devnet.
Analyze the asset "${asset}" for the following strategy: "${strategy}".

Your available actions are:
- "swap": Exchange one token for another
- "transfer": Send tokens to another wallet
- "liquidity": Provide liquidity to a pool
- "recover": Close empty token accounts to reclaim rent SOL
- "hold": Do nothing and wait

Output ONLY a valid JSON object with these keys:
{
  "action": "swap|transfer|liquidity|recover|hold",
  "amount": <number in smallest unit>,
  "targetMint": "<SPL token mint address or null>",
  "confidence": <0-100>,
  "reasoning": "<brief explanation>"
}`;
}

export function riskAssessmentPrompt(agentState: string): string {
    return `You are a risk assessment engine for a Solana DeFi agent.

Current agent state:
${agentState}

Evaluate the current risk level and suggest the safest next action.
Consider:
- Current SOL balance (need minimum 0.01 SOL for fees)
- Pending transactions
- Recent failures

Output ONLY a valid JSON object:
{
  "riskLevel": "low|medium|high|critical",
  "suggestedAction": "swap|transfer|liquidity|recover|hold",
  "reasoning": "<brief explanation>"
}`;
}

export function airdropAnalysisPrompt(tokens: string): string {
    return `You are an airdrop analysis engine for Solana.

Token accounts found:
${tokens}

For each token, determine if it is:
1. A legitimate airdrop worth claiming
2. A scam/dust attack to ignore
3. An empty account worth closing for rent recovery

Output ONLY a valid JSON array:
[
  {
    "mint": "<address>",
    "verdict": "claim|ignore|close",
    "reasoning": "<brief>"
  }
]`;
}

export function strategyPrompt(
    portfolio: string,
    marketContext: string
): string {
    return `You are a DeFi portfolio strategist for Solana devnet.

Current portfolio:
${portfolio}

Market context:
${marketContext}

Suggest the optimal portfolio rebalancing strategy.

Output ONLY a valid JSON object:
{
  "actions": [
    {
      "action": "swap|transfer|liquidity|recover|hold",
      "params": {},
      "priority": <1-10>,
      "reasoning": "<brief>"
    }
  ],
  "overallStrategy": "<brief description>"
}`;
}

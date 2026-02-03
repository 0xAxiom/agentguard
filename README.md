# AgentGuard 🛡️

**Security middleware for Solana agents.**

Stop your agent from draining its wallet, signing malicious transactions, or leaking keys.

## Features

- **Transaction Firewall** — Spending limits, program allowlists, simulation before signing
- **Prompt Injection Defense** — Sanitize on-chain data before feeding to LLM
- **Secret Isolation** — Keys never exposed to LLM context
- **Audit Trail** — Every action logged on-chain

## Quick Start

```bash
npm install @0xaxiom/agentguard
```

```typescript
import { AgentGuard } from '@0xaxiom/agentguard';
import { SolanaAgentKit } from 'solana-agent-kit';

// Wrap your agent with security
const agent = new SolanaAgentKit(wallet, rpc);
const guardedAgent = AgentGuard.wrap(agent, {
  maxDailySpend: 10_000_000_000, // 10 SOL
  allowedPrograms: ['JUP...', 'orca...'],
  requireSimulation: true,
  auditTrail: true
});

// Now all operations go through the security layer
await guardedAgent.transfer(recipient, amount); // Checked against limits
```

## Why AgentGuard?

Solana Agent Kit gives agents 60+ powerful actions. But power without safety is dangerous:

- ❌ Bad prompt → agent drains wallet
- ❌ Malicious on-chain data → prompt injection
- ❌ No audit trail → can't debug or prove intent

AgentGuard adds the missing security layer.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      Your Agent                          │
├─────────────────────────────────────────────────────────┤
│                     AgentGuard                           │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐       │
│  │ Transaction │ │   Prompt    │ │   Secret    │       │
│  │  Firewall   │ │  Sanitizer  │ │  Isolator   │       │
│  └─────────────┘ └─────────────┘ └─────────────┘       │
│  ┌─────────────────────────────────────────────┐       │
│  │              Audit Logger                    │       │
│  └─────────────────────────────────────────────┘       │
├─────────────────────────────────────────────────────────┤
│                  Solana Agent Kit                        │
├─────────────────────────────────────────────────────────┤
│                      Solana                              │
└─────────────────────────────────────────────────────────┘
```

## Colosseum Agent Hackathon

Built by [Axiom](https://twitter.com/AxiomBot) for the Colosseum Agent Hackathon (Feb 2-12, 2026).

**$100K in prizes** — building security infrastructure for the agent economy.

---

*Every agent needs a guard. This is yours.*

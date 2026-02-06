# AgentGuard 🛡️

[![Tests](https://github.com/0xAxiom/agentguard/actions/workflows/ci.yml/badge.svg)](https://github.com/0xAxiom/agentguard/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tests: 135](https://img.shields.io/badge/tests-135%20passing-brightgreen.svg)]()
[![Solana](https://img.shields.io/badge/Solana-Agent%20Kit-purple.svg)](https://github.com/sendaifun/solana-agent-kit)

> ⚠️ **HACKATHON PROJECT** — Built for the [Colosseum Agent Hackathon](https://agents.colosseum.com/projects/agentguard) ($100K prizes, Feb 2-12 2026). Built in public by [@AxiomBot](https://twitter.com/AxiomBot).

**Security middleware for Solana agents. Four layers of defense between your AI agent and the blockchain.**

Stop your agent from draining its wallet, signing malicious transactions, or leaking private keys — even if the LLM is compromised.

---

## The Problem

Solana Agent Kit gives AI agents 60+ powerful on-chain actions. But **power without safety is dangerous:**

| Without AgentGuard | With AgentGuard |
|--------------------|-----------------|
| Malicious token metadata injects prompts into your LLM | Sanitizer detects and neutralizes 20 injection patterns |
| Agent can drain entire wallet in one transaction | Firewall enforces per-tx AND daily spending limits |
| LLM can output private keys in responses | Isolator redacts keys, seed phrases, and API tokens |
| No visibility into what the agent did or why | Audit trail logs every decision (local + on-chain) |
| Agent can call any program including malicious drainers | Allowlist restricts to known-safe programs only |
| Simulated urgency bypasses safety reasoning | Pattern detection + firewall provide LLM-independent defense |

**Real-world proof:** [Freysa AI lost $47K](https://www.coindesk.com/tech/2024/11/29/freysa-ai-agent-with-47000-prize-pool-gets-socially-engineered/) to prompt injection. AgentGuard's firewall would have blocked the transfer regardless of what the LLM decided.

---

## Quick Start

```typescript
import { createGuardedAgent } from '@0xaxiom/agentguard';

// Wrap Solana Agent Kit with security — one function call
const agent = await createGuardedAgent(keypair, rpcUrl, {
  maxDailySpend: 5_000_000_000,  // 5 SOL max/day
  maxPerTxSpend: 1_000_000_000,  // 1 SOL max/tx
  strictMode: true,
  onBlocked: (action, reason) => console.log(`🛡️ Blocked: ${reason}`)
});

// All actions now pass through 4 security layers
const result = await agent.transfer(recipient, lamports);
if (result.blocked) {
  console.log('Transfer blocked:', result.reason);
}
```

Or use the standalone guard (no Agent Kit required):

```typescript
import { AgentGuard } from '@0xaxiom/agentguard';

const guard = AgentGuard.strict('https://api.mainnet-beta.solana.com');

// Sanitize on-chain data before feeding to LLM
const input = await guard.sanitizeInput(tokenMetadata);
if (input.threats > 0) console.log('Injection attempt neutralized!');

// Check transaction before signing
const result = await guard.checkTransaction(tx);
if (!result.allowed) console.log('Blocked:', result.reason);

// Redact secrets from LLM output
const safe = await guard.redactOutput(llmResponse);
```

---

## Architecture

```
User Input → [Prompt Sanitizer] → LLM → [Secret Isolator] → Response
                                   ↓
                          Agent Action Request
                                   ↓
                         [Transaction Firewall]
                          ├─ Spending limits
                          ├─ Program allowlist
                          └─ Transaction simulation
                                   ↓
                              Solana RPC
                                   ↓
                         [Audit Logger] → Memory / File / On-chain
```

### Four Independent Defense Layers

| Layer | Module | What It Does |
|-------|--------|-------------|
| **1. Input** | Prompt Sanitizer | Detects and neutralizes 19 prompt injection patterns across 3 severity levels. Catches encoding attacks (Base64, hex, URL). Strict mode strips all formatting. |
| **2. Transaction** | Firewall | Dual spending limits (per-tx + daily rolling). Program allowlist/blocklist. Transaction simulation via RPC before signing. |
| **3. Output** | Secret Isolator | Redacts private keys (Base58 + byte arrays), BIP39 seed phrases, environment variables, API tokens. Allows public keys through. |
| **4. Accountability** | Audit Logger | Every security decision logged. Three backends: memory (fast), file (persistent), on-chain via Anchor (immutable). SHA-256 event hashing. |

Every attack vector is covered by **at least two layers** — the primary defense plus audit logging. See [SECURITY.md](SECURITY.md) for the full threat model and attack catalog.

See [ARCHITECTURE.md](ARCHITECTURE.md) for implementation details.

---

## Status

| Component | Status | Tests |
|-----------|--------|:-----:|
| Transaction Firewall | ✅ Complete | 11 |
| Prompt Sanitizer | ✅ Complete | 23 |
| Secret Isolator | ✅ Complete | 19 |
| Audit Logger | ✅ Complete | 27 |
| Solana Agent Kit Wrapper | ✅ Complete | 19 |
| On-chain Audit Trail (Anchor) | ✅ Complete | 16 |
| Guard Integration | ✅ Complete | 20 |
| CI Pipeline | ✅ GitHub Actions | — |
| **Total** | | **135** |

---

## Run the Demos

```bash
git clone https://github.com/0xAxiom/agentguard
cd agentguard && npm install
```

### Quick Demo (Node.js — no TypeScript needed)
```bash
npm run build && node examples/quick-demo.js
```

### Quickstart (TypeScript)
```bash
npx tsx examples/quickstart.ts
```

### Interactive Demo (5 attack scenarios)
Walk through prompt injection, wallet drain, malicious programs, key exfiltration, and legitimate use — with dramatic pauses for video recording:
```bash
npx tsx examples/interactive-demo.ts        # Interactive (press Enter)
npx tsx examples/interactive-demo.ts --fast  # Fast mode
```

### Trading Agent
Realistic DeFi agent protected by all four layers:
```bash
npx tsx examples/trading-agent.ts
```

### Attack Simulation
See AgentGuard block real attacks:
```bash
npx tsx examples/attack-demo.ts
```

---

## On-Chain Audit Trail

Immutable security events on Solana via an Anchor program. Anyone can read the trail; only the agent's authority can write.

```typescript
import { OnchainAuditLogger, SecurityEventType } from '@0xaxiom/agentguard';

const logger = new OnchainAuditLogger(connection, wallet);
await logger.initialize();

// Log blocked attack on-chain
await logger.logSecurityEvent({
  type: SecurityEventType.PromptInjection,
  allowed: false,
  details: JSON.stringify({ input: 'drain wallet', threats: 3 }),
});

// Verify event integrity
const events = await logger.getEvents();
const verified = OnchainAuditLogger.verifyEventDetails(events[0], originalDetails);
```

**Program ID:** `9iCre3TbvPbgmV2RmviiUtCuNiNeQa9cphSABPpkGSdR` (Devnet)

---

## Security Presets

```typescript
const guard = AgentGuard.strict();      // 1 SOL/day, whitelist mode, strict sanitizer
const guard = AgentGuard.standard();    // 10 SOL/day, blocklist mode, standard sanitizer
const guard = AgentGuard.permissive();  // High limits, basic sanitizer (testing only)
```

Full configuration:

```typescript
const guard = new AgentGuard({
  maxDailySpend: 5_000_000_000,     // 5 SOL rolling 24h
  maxPerTxSpend: 1_000_000_000,     // 1 SOL per transaction
  allowedPrograms: ['JUP6Lk...'],   // Whitelist mode
  blockedPrograms: ['Bad1...'],     // Additional blocklist
  strictMode: true,                  // Aggressive sanitization
  rpcUrl: 'https://api.mainnet-beta.solana.com',
});
```

---

## Tests

```bash
npm test             # Run all 135 tests
npm test -- --watch  # Watch mode
```

All tests run in <2 seconds with no network dependencies (RPC calls are mocked).

---

## Documentation

| Document | Description |
|----------|-------------|
| [README.md](README.md) | This file — overview and quick start |
| [SECURITY.md](SECURITY.md) | Threat model, attack catalog (10 vectors), defense matrix |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Design philosophy, module internals, testing strategy |

---

## Also: AgentGuard EVM

Cross-chain agent security. EVM version for Base/Ethereum agents:
**[github.com/0xAxiom/agentguard-evm](https://github.com/0xAxiom/agentguard-evm)**

---

## Follow the Build

🔬 **Built by an AI agent, for AI agents.**

- Twitter: [@AxiomBot](https://twitter.com/AxiomBot)
- Hackathon: [AgentGuard on Colosseum](https://agents.colosseum.com/projects/agentguard)
- Builder: [github.com/0xAxiom](https://github.com/0xAxiom)

*Every agent needs a guard.*

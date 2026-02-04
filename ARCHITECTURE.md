# Architecture

## Design Philosophy

AgentGuard follows the **middleware pattern**: it sits between your AI agent and the Solana blockchain, intercepting all operations. The goal is defense-in-depth — multiple independent layers that each catch different attack vectors.

```
User Input → [Prompt Sanitizer] → LLM → [Secret Isolator] → Agent Action
                                           ↓
                                   [Transaction Firewall] → Solana
                                           ↓
                                   [Audit Logger] → Memory / File / On-chain
```

## Modules

### Transaction Firewall (`src/firewall/`)

Three sub-components:

- **SpendingLimits** (`limits.ts`) — Tracks cumulative daily spend and per-transaction maximums. Resets on 24-hour boundaries. All values in lamports.
- **ProgramAllowlist** (`allowlist.ts`) — Allowlist/blocklist for Solana program IDs. Ships with known-safe system programs and known-malicious programs. Supports runtime modifications.
- **TransactionSimulator** (`simulator.ts`) — Simulates transactions via RPC before signing. Estimates SOL balance changes and catches failures early.

The firewall runs all three checks in sequence: programs → spending → simulation. First failure short-circuits.

### Prompt Sanitizer (`src/sanitizer/`)

- **Patterns** (`patterns.ts`) — 30+ regex patterns for detecting prompt injection: system prompt overrides, role impersonation, delimiter injection, encoding attacks, unicode homoglyphs.
- **Cleaner** (`cleaner.ts`) — Strips or neutralizes detected threats. Optional strict mode strips all markdown/formatting.

Designed for on-chain data (NFT metadata, token names, memo fields) that gets fed to an LLM.

### Secret Isolator (`src/isolator/`)

Detects and redacts:
- Solana private keys (Base58, byte arrays)
- Seed phrases (BIP39 12/24 word sequences)
- Environment variable patterns (`PRIVATE_KEY=...`)
- API keys and tokens

Configurable: allows public keys through by default (they're not secrets).

### Audit Logger (`src/audit/`)

Three storage backends:
- **Memory** — In-process `Map`, fastest, lost on restart
- **File** — JSON on disk, survives restarts
- **On-chain** — Solana program via Anchor (see below)

Every security decision is logged: what was checked, what was allowed/blocked, and why.

### On-Chain Audit Trail (`src/audit/onchain.ts` + `programs/`)

Anchor program that stores immutable security events on Solana:

```
AuditAuthority PDA (per-agent)
  └── SecurityEvent PDAs (sequential)
       ├── event_type: u8
       ├── allowed: bool
       ├── details_hash: [u8; 32]
       └── timestamp: i64
```

Events are hashed (SHA-256) before storage to keep costs low while maintaining verifiability. Anyone can read the audit trail; only the agent's authority can write to it.

**Program ID:** `9iCre3TbvPbgmV2RmviiUtCuNiNeQa9cphSABPpkGSdR` (Devnet)

### Solana Agent Kit Wrapper (`src/wrapper/`)

Drop-in wrapper for `solana-agent-kit`. Intercepts common actions (transfer, swap, stake, deploy) and routes through all security layers automatically. Supports:

- Callbacks: `onBlocked`, `onInjection`, `onSecretLeak`
- Dry-run mode for testing
- Custom security checks per action

## Guard Class (`src/guard.ts`)

The main entry point. Composes all modules and provides a unified API:

```typescript
const guard = AgentGuard.strict();      // Conservative defaults
const guard = AgentGuard.standard();    // Balanced
const guard = AgentGuard.permissive();  // High limits
```

Factory presets configure spending limits, audit storage, and strict mode simultaneously.

## Testing Strategy

135 tests across 7 test files:
- Unit tests for each module in isolation
- Integration tests through the Guard class
- End-to-end security flow tests
- On-chain PDA derivation and verification tests

All tests run via `vitest` with no network dependencies (RPC calls are mocked).

## Security Model

**Threat model:** A compromised or manipulated LLM trying to:
1. Drain the agent's wallet (→ Firewall: spending limits)
2. Interact with malicious programs (→ Firewall: allowlist)
3. Inject prompts via on-chain data (→ Sanitizer)
4. Exfiltrate private keys in responses (→ Isolator)
5. Act without accountability (→ Audit Logger)

**Not in scope:** Key management (use a hardware wallet or HSM), RPC endpoint security, or LLM model safety.

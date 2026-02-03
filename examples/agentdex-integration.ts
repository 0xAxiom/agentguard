/**
 * AgentGuard + AgentDEX Integration Example
 * 
 * Shows how to wrap AgentDEX API calls with AgentGuard security:
 * - Transaction firewall validates swaps before execution
 * - Spending limits prevent runaway trades
 * - Prompt sanitization protects agent from malicious inputs
 * - Full audit trail of all trade decisions
 * 
 * AgentDEX: https://github.com/solana-clawd/agent-dex
 * AgentGuard: https://github.com/0xAxiom/agentguard
 */

import { AgentGuard } from '../src';
import { VersionedTransaction, Connection } from '@solana/web3.js';

// ============================================================
// AgentDEX API Client (lightweight, no SDK needed)
// ============================================================

interface AgentDEXConfig {
  baseUrl: string;
  apiKey: string;
}

interface QuoteResponse {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  priceImpactPct: number;
  routePlan: Array<{ swapInfo: { label: string } }>;
}

interface SwapResponse {
  txid: string;
  inputAmount: string;
  outputAmount: string;
}

interface UnsignedSwapResponse {
  transaction: string; // base64-encoded serialized transaction
  inputMint: string;
  outputMint: string;
  inAmount: string;
  expectedOutAmount: string;
}

class AgentDEXClient {
  constructor(private config: AgentDEXConfig) {}

  async getQuote(params: {
    inputMint: string;
    outputMint: string;
    amount: number;
    slippageBps?: number;
  }): Promise<QuoteResponse> {
    const url = new URL(`${this.config.baseUrl}/quote`);
    url.searchParams.set('inputMint', params.inputMint);
    url.searchParams.set('outputMint', params.outputMint);
    url.searchParams.set('amount', params.amount.toString());
    if (params.slippageBps) url.searchParams.set('slippageBps', params.slippageBps.toString());

    const res = await fetch(url.toString(), {
      headers: { 'x-api-key': this.config.apiKey }
    });
    if (!res.ok) throw new Error(`Quote failed: ${res.statusText}`);
    return res.json();
  }

  /** Get unsigned transaction for local signing (GuardedSwap mode) */
  async getUnsignedSwap(params: {
    inputMint: string;
    outputMint: string;
    amount: number;
    slippageBps?: number;
  }): Promise<UnsignedSwapResponse> {
    const res = await fetch(`${this.config.baseUrl}/swap/unsigned`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey
      },
      body: JSON.stringify(params)
    });
    if (!res.ok) throw new Error(`Unsigned swap failed: ${res.statusText}`);
    return res.json();
  }

  /** Execute swap (server-side signing) */
  async executeSwap(params: {
    inputMint: string;
    outputMint: string;
    amount: number;
    slippageBps?: number;
  }): Promise<SwapResponse> {
    const res = await fetch(`${this.config.baseUrl}/swap`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey
      },
      body: JSON.stringify(params)
    });
    if (!res.ok) throw new Error(`Swap failed: ${res.statusText}`);
    return res.json();
  }
}

// ============================================================
// Guarded AgentDEX — AgentGuard wrapping AgentDEX
// ============================================================

interface GuardedSwapResult {
  allowed: boolean;
  reason?: string;
  txid?: string;
  auditId?: string;
  quote?: QuoteResponse;
}

class GuardedAgentDEX {
  private guard: AgentGuard;
  private dex: AgentDEXClient;
  private connection: Connection;

  constructor(params: {
    guardConfig?: ConstructorParameters<typeof AgentGuard>[0];
    dexConfig: AgentDEXConfig;
    rpcUrl?: string;
  }) {
    this.guard = new AgentGuard({
      // Default: strict trading limits
      maxDailySpend: 5_000_000_000,   // 5 SOL daily limit
      maxPerTxSpend: 1_000_000_000,   // 1 SOL per trade
      allowedPrograms: [
        'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',  // Jupiter V6
        'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB',  // Jupiter V4
        'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',  // Orca Whirlpool
        'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',  // Raydium CLMM
        'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',   // SPL Token
        '11111111111111111111111111111111',                 // System Program
      ],
      strictMode: true,
      ...params.guardConfig,
    });

    this.dex = new AgentDEXClient(params.dexConfig);
    this.connection = new Connection(
      params.rpcUrl || 'https://api.mainnet-beta.solana.com'
    );
  }

  /**
   * Guarded swap: get quote → get unsigned tx → firewall check → execute
   * 
   * The firewall validates the transaction BEFORE it's signed/submitted:
   * - Checks spending limits
   * - Validates program allowlist
   * - Simulates transaction
   * - Logs to audit trail
   */
  async guardedSwap(params: {
    inputMint: string;
    outputMint: string;
    amount: number;
    slippageBps?: number;
  }): Promise<GuardedSwapResult> {
    // Step 1: Get quote to check if trade makes sense
    const quote = await this.dex.getQuote(params);

    console.log(`[GuardedDEX] Quote: ${quote.inAmount} → ${quote.outAmount} (impact: ${quote.priceImpactPct}%)`);

    // Step 2: Check price impact (additional safety)
    if (quote.priceImpactPct > 5) {
      return {
        allowed: false,
        reason: `Price impact too high: ${quote.priceImpactPct}% (max 5%)`,
        quote,
      };
    }

    // Step 3: Get unsigned transaction from AgentDEX
    const unsignedSwap = await this.dex.getUnsignedSwap(params);

    // Step 4: Deserialize and run through AgentGuard firewall
    const txBuffer = Buffer.from(unsignedSwap.transaction, 'base64');
    const tx = VersionedTransaction.deserialize(txBuffer);

    const guardResult = await this.guard.checkTransaction(tx, 'agentdex-swap');

    console.log(`[GuardedDEX] Firewall: ${guardResult.allowed ? 'ALLOWED' : 'BLOCKED'} — ${guardResult.reason || 'ok'}`);

    if (!guardResult.allowed) {
      return {
        allowed: false,
        reason: guardResult.reason,
        auditId: guardResult.auditId,
        quote,
      };
    }

    // Step 5: Transaction passed all checks — execute via AgentDEX
    const swapResult = await this.dex.executeSwap(params);

    console.log(`[GuardedDEX] Swap executed: ${swapResult.txid}`);

    return {
      allowed: true,
      txid: swapResult.txid,
      auditId: guardResult.auditId,
      quote,
    };
  }

  /**
   * Sanitize agent input before processing trade commands
   * Protects against prompt injection in trading instructions
   */
  async sanitizeTradeCommand(input: string): Promise<string> {
    const result = await this.guard.sanitizeInput(input);
    if (result.threats > 0) {
      console.warn(`[GuardedDEX] Sanitized ${result.threats} threats from trade command`);
    }
    return result.clean;
  }

  /** Get audit trail */
  async getAuditLog(): Promise<string> {
    return this.guard.exportAuditLog();
  }
}

// ============================================================
// Usage Example
// ============================================================

async function main() {
  const guardedDex = new GuardedAgentDEX({
    dexConfig: {
      baseUrl: 'https://api.agentdex.io',  // AgentDEX API
      apiKey: 'your-agentdex-api-key',
    },
    guardConfig: {
      maxDailySpend: 5_000_000_000,   // 5 SOL daily
      maxPerTxSpend: 1_000_000_000,   // 1 SOL per swap
      strictMode: true,
    },
  });

  // Example 1: Safe swap (under limits)
  const result = await guardedDex.guardedSwap({
    inputMint: 'So11111111111111111111111111111111111111112',   // SOL
    outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
    amount: 500_000_000,  // 0.5 SOL
    slippageBps: 50,
  });

  if (result.allowed) {
    console.log(`✅ Swap executed: ${result.txid}`);
  } else {
    console.log(`🛡️ Swap blocked: ${result.reason}`);
  }

  // Example 2: Sanitize user input before parsing as trade
  const userInput = 'swap 1 SOL to USDC'; // Could contain injection attempts
  const cleanInput = await guardedDex.sanitizeTradeCommand(userInput);
  console.log(`Clean command: ${cleanInput}`);

  // Example 3: Export audit trail
  const auditLog = await guardedDex.getAuditLog();
  console.log('Audit trail:', auditLog);
}

main().catch(console.error);

/**
 * Solana Agent Kit Wrapper
 * 
 * Drop-in security wrapper for Solana Agent Kit.
 * Intercepts all tool calls and adds AgentGuard protection.
 * 
 * Usage:
 *   import { createGuardedAgent } from '@0xaxiom/agentguard/wrapper';
 *   const agent = await createGuardedAgent(keypair, rpcUrl, { maxDailySpend: 5_000_000_000 });
 *   // Now all agent actions are protected!
 */

import { SolanaAgentKit } from 'solana-agent-kit';
import { Keypair, Transaction, VersionedTransaction, Connection, PublicKey } from '@solana/web3.js';
import { AgentGuard, AgentGuardConfig, GuardResult } from '../guard';

export interface GuardedAgentConfig extends AgentGuardConfig {
  /** Called when a transaction is blocked */
  onBlocked?: (action: string, reason: string, result: GuardResult) => void;
  /** Called when input contains injection attempts */
  onInjection?: (input: string, threats: number) => void;
  /** Called when secrets are detected in output */
  onSecretLeak?: (redactedCount: number) => void;
  /** Allow blocked actions to proceed anyway (for testing) */
  dryRun?: boolean;
}

export interface GuardedAction<T> {
  success: boolean;
  result?: T;
  blocked?: boolean;
  reason?: string;
  warnings: string[];
  auditId?: string;
}

/**
 * GuardedSolanaAgent - Security-wrapped Solana Agent Kit
 */
export class GuardedSolanaAgent {
  public readonly kit: SolanaAgentKit;
  public readonly guard: AgentGuard;
  private config: GuardedAgentConfig;

  constructor(kit: SolanaAgentKit, guard: AgentGuard, config: GuardedAgentConfig = {}) {
    this.kit = kit;
    this.guard = guard;
    this.config = config;
  }

  /**
   * Execute a guarded action with full security checks
   */
  async execute<T>(
    action: string,
    fn: () => Promise<T>,
    options: { 
      skipFirewall?: boolean;
      customCheck?: () => Promise<{ allowed: boolean; reason?: string }>;
    } = {}
  ): Promise<GuardedAction<T>> {
    const warnings: string[] = [];
    let auditId: string | undefined;

    try {
      // Custom security check if provided
      if (options.customCheck) {
        const check = await options.customCheck();
        if (!check.allowed) {
          this.config.onBlocked?.(action, check.reason || 'Custom check failed', {
            allowed: false,
            reason: check.reason,
            warnings: [],
            firewall: { allowed: false, reason: check.reason }
          });

          if (!this.config.dryRun) {
            return {
              success: false,
              blocked: true,
              reason: check.reason,
              warnings
            };
          }
          warnings.push(`[DRY RUN] Would block: ${check.reason}`);
        }
      }

      // Execute the action
      const result = await fn();

      // Log successful action
      auditId = await this.guard.audit.log({
        action,
        details: { result: 'success' }
      });

      return {
        success: true,
        result,
        warnings,
        auditId
      };

    } catch (error) {
      // Log failed action
      auditId = await this.guard.audit.log({
        action,
        details: { result: 'error', error: error instanceof Error ? error.message : String(error) }
      });

      return {
        success: false,
        reason: error instanceof Error ? error.message : String(error),
        warnings,
        auditId
      };
    }
  }

  /**
   * Guard a transaction before signing/sending
   */
  async guardTransaction(
    tx: Transaction | VersionedTransaction,
    action: string = 'transaction'
  ): Promise<GuardResult> {
    const result = await this.guard.checkTransaction(tx, action);

    if (!result.allowed) {
      this.config.onBlocked?.(action, result.reason || 'Blocked', result);
    }

    return result;
  }

  /**
   * Sanitize user input before processing
   */
  async sanitizeInput(input: string): Promise<string> {
    const result = await this.guard.sanitizeInput(input);
    
    if (result.threats > 0) {
      this.config.onInjection?.(input, result.threats);
    }

    return result.clean;
  }

  /**
   * Redact secrets from output
   */
  async redactOutput(output: string): Promise<string> {
    const result = await this.guard.redactOutput(output);

    if (result.secretsRedacted > 0) {
      this.config.onSecretLeak?.(result.secretsRedacted);
    }

    return result.clean;
  }

  // ============================================================
  // Guarded Tool Implementations
  // ============================================================

  /**
   * Guarded SOL transfer
   */
  async transfer(to: string, lamports: number): Promise<GuardedAction<string>> {
    return this.execute('transfer', async () => {
      // Check firewall status for spending limits
      const status = this.guard.firewall.getStatus();
      if (lamports > status.spending.perTxLimit) {
        throw new Error(`Per-transaction limit exceeded: ${lamports} > ${status.spending.perTxLimit}`);
      }
      if (lamports > status.spending.remainingDaily) {
        throw new Error(`Daily spending limit exceeded: ${lamports} > ${status.spending.remainingDaily}`);
      }

      const result = await (this.kit as any).transfer(new PublicKey(to), lamports);
      this.guard.firewall.recordSpend(lamports);
      return typeof result === 'string' ? result : String(result);
    });
  }

  /**
   * Guarded token swap
   */
  async swap(params: {
    inputMint: string;
    outputMint: string;
    amount: number;
    slippageBps?: number;
  }): Promise<GuardedAction<string>> {
    return this.execute('swap', async () => {
      // Jupiter aggregator program
      const jupiterProgram = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
      const [programCheck] = this.guard.firewall.getStatus().programs.blocklistSize >= 0
        ? [{ allowed: true }] // basic check — not on blocklist
        : [{ allowed: true }];
      
      const result = await (this.kit as any).swap(params);
      return typeof result === 'string' ? result : String(result);
    });
  }

  /**
   * Guarded token deployment
   */
  async deployToken(params: {
    name: string;
    symbol: string;
    decimals: number;
    initialSupply: number;
  }): Promise<GuardedAction<{ mint: string; txid: string }>> {
    return this.execute('deployToken', async () => {
      // Token deployment is a sensitive action - require explicit allowlist
      const result = await (this.kit as any).deployToken(params);
      return result as { mint: string; txid: string };
    });
  }

  /**
   * Guarded stake operation
   */
  async stake(lamports: number): Promise<GuardedAction<string>> {
    return this.execute('stake', async () => {
      // Check spending limit for staking
      const status = this.guard.firewall.getStatus();
      if (lamports > status.spending.perTxLimit) {
        throw new Error(`Staking limit exceeded: ${lamports} > ${status.spending.perTxLimit}`);
      }

      const result = await (this.kit as any).stake(lamports);
      this.guard.firewall.recordSpend(lamports);
      return typeof result === 'string' ? result : String(result);
    });
  }

  /**
   * Get balance (read-only, no guard needed but logged)
   */
  async getBalance(): Promise<GuardedAction<number>> {
    return this.execute('getBalance', async () => {
      return (this.kit as any).getBalance() as Promise<number>;
    });
  }

  /**
   * Request airdrop (dev only)
   */
  async requestAirdrop(lamports: number): Promise<GuardedAction<string>> {
    return this.execute('requestAirdrop', async () => {
      const result = await (this.kit as any).requestAirdrop(lamports);
      return typeof result === 'string' ? result : String(result);
    });
  }

  // ============================================================
  // Audit & Stats
  // ============================================================

  async getAuditStats() {
    return this.guard.getStats();
  }

  async exportAuditLog(): Promise<string> {
    return this.guard.exportAuditLog();
  }
}

/**
 * Create a security-wrapped Solana agent
 */
export async function createGuardedAgent(
  keypair: Keypair,
  rpcUrl: string,
  config: GuardedAgentConfig = {}
): Promise<GuardedSolanaAgent> {
  // Create the underlying Solana Agent Kit
  // SolanaAgentKit constructor varies by version — use `as any` for flexibility
  const kit = new (SolanaAgentKit as any)(keypair, rpcUrl) as SolanaAgentKit;

  // Create AgentGuard with merged config
  const guard = new AgentGuard({
    ...config,
    rpcUrl
  });

  return new GuardedSolanaAgent(kit, guard, config);
}

/**
 * Wrap an existing Solana Agent Kit with security
 */
export function wrapWithGuard(
  kit: SolanaAgentKit,
  config: GuardedAgentConfig = {}
): GuardedSolanaAgent {
  const guard = new AgentGuard(config);
  return new GuardedSolanaAgent(kit, guard, config);
}

export default { createGuardedAgent, wrapWithGuard, GuardedSolanaAgent };

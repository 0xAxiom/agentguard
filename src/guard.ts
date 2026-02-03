/**
 * AgentGuard - Main security middleware for Solana agents
 * 
 * Wraps Solana Agent Kit with comprehensive security:
 * - Transaction Firewall (spending limits, program allowlists)
 * - Prompt Sanitizer (injection defense)
 * - Secret Isolator (key protection)
 * - Audit Logger (accountability trail)
 */

import { Transaction, VersionedTransaction, PublicKey } from '@solana/web3.js';
import { TransactionFirewall, FirewallConfig, FirewallResult } from './firewall';
import { PromptSanitizer, SanitizerConfig, SanitizeResult } from './sanitizer';
import { SecretIsolator, IsolatorConfig, RedactResult } from './isolator';
import { AuditLogger, AuditConfig } from './audit';

export interface AgentGuardConfig {
  firewall?: FirewallConfig;
  sanitizer?: SanitizerConfig;
  isolator?: IsolatorConfig;
  audit?: AuditConfig;
  
  // Convenience options
  maxDailySpend?: number;
  maxPerTxSpend?: number;
  allowedPrograms?: string[];
  blockedPrograms?: string[];
  strictMode?: boolean;
  rpcUrl?: string;
}

export interface GuardResult {
  allowed: boolean;
  reason?: string;
  warnings: string[];
  firewall: FirewallResult;
  auditId?: string;
}

export interface GuardedInput {
  clean: string;
  threats: number;
  modified: boolean;
  auditId?: string;
}

export interface GuardedOutput {
  clean: string;
  secretsRedacted: number;
  auditId?: string;
}

/**
 * Main AgentGuard class
 */
export class AgentGuard {
  public readonly firewall: TransactionFirewall;
  public readonly sanitizer: PromptSanitizer;
  public readonly isolator: SecretIsolator;
  public readonly audit: AuditLogger;

  constructor(config: AgentGuardConfig = {}) {
    // Initialize firewall
    this.firewall = new TransactionFirewall({
      maxDailySpend: config.maxDailySpend ?? config.firewall?.maxDailySpend ?? 10_000_000_000, // 10 SOL
      maxPerTxSpend: config.maxPerTxSpend ?? config.firewall?.maxPerTxSpend ?? 1_000_000_000, // 1 SOL
      allowedPrograms: config.allowedPrograms ?? config.firewall?.allowedPrograms,
      blockedPrograms: config.blockedPrograms ?? config.firewall?.blockedPrograms,
      requireSimulation: config.firewall?.requireSimulation ?? true,
      rpcUrl: config.rpcUrl ?? config.firewall?.rpcUrl ?? 'https://api.mainnet-beta.solana.com'
    });

    // Initialize sanitizer
    this.sanitizer = new PromptSanitizer({
      strictMode: config.strictMode ?? config.sanitizer?.strictMode ?? false,
      stripMarkdown: config.sanitizer?.stripMarkdown ?? false,
      maxLength: config.sanitizer?.maxLength ?? 10000,
      customPatterns: config.sanitizer?.customPatterns
    });

    // Initialize isolator
    this.isolator = new SecretIsolator({
      allowPublicKeys: config.isolator?.allowPublicKeys ?? true,
      redactPatterns: config.isolator?.redactPatterns
    });

    // Initialize audit logger
    this.audit = new AuditLogger({
      storage: config.audit?.storage ?? 'memory',
      filePath: config.audit?.filePath,
      includeTimestamps: config.audit?.includeTimestamps ?? true,
      maxEntries: config.audit?.maxEntries ?? 10000
    });
  }

  /**
   * Check a transaction through all security layers
   */
  async checkTransaction(
    tx: Transaction | VersionedTransaction,
    action: string = 'transaction'
  ): Promise<GuardResult> {
    const warnings: string[] = [];
    
    // Run through firewall
    const firewallResult = await this.firewall.check(tx);
    
    if (firewallResult.warnings) {
      warnings.push(...firewallResult.warnings);
    }

    // Log the check
    const auditId = await this.audit.logTransactionCheck(
      action,
      { 
        programIds: this.extractProgramIds(tx),
        allowed: firewallResult.allowed
      },
      {
        allowed: firewallResult.allowed,
        reason: firewallResult.reason
      }
    );

    return {
      allowed: firewallResult.allowed,
      reason: firewallResult.reason,
      warnings,
      firewall: firewallResult,
      auditId
    };
  }

  /**
   * Sanitize input before sending to LLM
   */
  async sanitizeInput(text: string): Promise<GuardedInput> {
    const result = this.sanitizer.sanitize(text);
    
    // Log sanitization
    const auditId = await this.audit.logSanitization(
      text.slice(0, 100),
      result.threats.length,
      result.modified
    );

    return {
      clean: result.clean,
      threats: result.threats.length,
      modified: result.modified,
      auditId
    };
  }

  /**
   * Redact secrets from output before showing to user/logs
   */
  async redactOutput(text: string): Promise<GuardedOutput> {
    const result = this.isolator.redact(text);
    
    // Log redaction if secrets were found
    let auditId: string | undefined;
    if (result.redacted) {
      auditId = await this.audit.logRedaction(
        result.matches.length,
        result.matches.map(m => m.type)
      );
    }

    return {
      clean: result.clean,
      secretsRedacted: result.matches.length,
      auditId
    };
  }

  /**
   * Check if input is safe (quick check, no logging)
   */
  isSafeInput(text: string): boolean {
    return this.sanitizer.isSafe(text);
  }

  /**
   * Check if output contains secrets (quick check, no logging)
   */
  containsSecrets(text: string): boolean {
    return this.isolator.containsSecrets(text);
  }

  /**
   * Get audit statistics
   */
  async getStats() {
    return this.audit.getStats();
  }

  /**
   * Export audit log
   */
  async exportAuditLog(): Promise<string> {
    return this.audit.export();
  }

  /**
   * Extract program IDs from a transaction
   */
  private extractProgramIds(tx: Transaction | VersionedTransaction): string[] {
    try {
      if ('message' in tx && 'compiledInstructions' in tx.message) {
        // Versioned transaction
        const msg = tx.message as any;
        const keys = msg.staticAccountKeys || [];
        return msg.compiledInstructions.map((ix: any) => 
          keys[ix.programIdIndex]?.toBase58() || 'unknown'
        );
      } else if ('instructions' in tx) {
        // Legacy transaction
        return (tx as Transaction).instructions.map(ix => 
          ix.programId.toBase58()
        );
      }
    } catch {
      // Ignore errors
    }
    return [];
  }

  /**
   * Create pre-configured guard instances
   */
  static strict(rpcUrl?: string): AgentGuard {
    return new AgentGuard({
      strictMode: true,
      maxDailySpend: 1_000_000_000, // 1 SOL
      maxPerTxSpend: 100_000_000,   // 0.1 SOL
      rpcUrl,
      audit: { storage: 'file', filePath: './agentguard-audit.json' }
    });
  }

  static standard(rpcUrl?: string): AgentGuard {
    return new AgentGuard({
      strictMode: false,
      maxDailySpend: 10_000_000_000, // 10 SOL
      maxPerTxSpend: 1_000_000_000,  // 1 SOL
      rpcUrl,
      audit: { storage: 'memory' }
    });
  }

  static permissive(rpcUrl?: string): AgentGuard {
    return new AgentGuard({
      strictMode: false,
      maxDailySpend: 100_000_000_000, // 100 SOL
      maxPerTxSpend: 10_000_000_000,  // 10 SOL
      rpcUrl,
      audit: { storage: 'memory' }
    });
  }
}

export default AgentGuard;

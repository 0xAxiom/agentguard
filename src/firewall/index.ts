/**
 * TransactionFirewall - Core security layer for Solana agent transactions
 * 
 * Features:
 * - Daily/per-tx spending limits
 * - Program allowlist/blocklist
 * - Transaction simulation before signing
 * - Detailed rejection reasons
 */

import { Transaction, VersionedTransaction, PublicKey } from '@solana/web3.js';
import { SpendingLimits, SpendingLimitConfig } from './limits';
import { ProgramAllowlist, AllowlistConfig, ProgramCheckResult } from './allowlist';
import { TransactionSimulator, SimulationResult, SimulatorConfig } from './simulator';

export interface FirewallConfig {
  maxDailySpend: number;        // lamports
  maxPerTxSpend: number;        // lamports
  allowedPrograms?: string[];   // if set, only these allowed
  blockedPrograms?: string[];   // always blocked
  requireSimulation?: boolean;  // simulate before allowing
  rpcUrl: string;
  payerPublicKey?: PublicKey;   // for spend estimation
}

export interface FirewallResult {
  allowed: boolean;
  reason?: string;
  warnings?: string[];
  simulationResult?: SimulationResult;
  programsChecked?: ProgramCheckResult[];
  estimatedSpend?: number;
}

export interface FirewallStatus {
  spending: {
    dailySpend: number;
    dailyLimit: number;
    perTxLimit: number;
    remainingDaily: number;
  };
  programs: {
    mode: 'allowlist' | 'blocklist_only';
    allowlistSize: number | null;
    blocklistSize: number;
  };
  requireSimulation: boolean;
}

export class TransactionFirewall {
  private readonly limits: SpendingLimits;
  private readonly allowlist: ProgramAllowlist;
  private readonly simulator: TransactionSimulator;
  private readonly requireSimulation: boolean;
  private readonly payerPublicKey?: PublicKey;

  constructor(config: FirewallConfig) {
    // Initialize spending limits
    this.limits = new SpendingLimits({
      maxDailySpend: config.maxDailySpend,
      maxPerTxSpend: config.maxPerTxSpend,
    });

    // Initialize program allowlist
    this.allowlist = new ProgramAllowlist({
      allowedPrograms: config.allowedPrograms,
      blockedPrograms: config.blockedPrograms,
    });

    // Initialize simulator
    this.simulator = new TransactionSimulator({
      rpcUrl: config.rpcUrl,
    });

    this.requireSimulation = config.requireSimulation ?? true;
    this.payerPublicKey = config.payerPublicKey;
  }

  /**
   * Check if a transaction is allowed through the firewall
   */
  async check(tx: Transaction | VersionedTransaction): Promise<FirewallResult> {
    const warnings: string[] = [];
    let simulationResult: SimulationResult | undefined;
    let estimatedSpend: number | undefined;

    // Step 1: Check programs against allowlist/blocklist
    const programIds = this.simulator.extractProgramIds(tx);
    const programChecks = this.allowlist.checkAll(programIds);
    
    const blockedProgram = programChecks.find(p => !p.allowed);
    if (blockedProgram) {
      return {
        allowed: false,
        reason: blockedProgram.reason,
        programsChecked: programChecks,
        warnings,
      };
    }

    // Step 2: Estimate spending
    if (this.payerPublicKey) {
      const spendEstimate = await this.simulator.estimateSpend(tx, this.payerPublicKey);
      estimatedSpend = spendEstimate.estimatedSpend;
      warnings.push(...spendEstimate.warnings);

      // Check against spending limits
      const limitCheck = this.limits.check(estimatedSpend);
      if (!limitCheck.allowed) {
        return {
          allowed: false,
          reason: limitCheck.reason,
          programsChecked: programChecks,
          estimatedSpend,
          warnings,
        };
      }
    } else {
      // No payer key - can't estimate spend, warn but continue
      warnings.push('No payer public key provided - spending limits not enforced');
    }

    // Step 3: Simulate transaction (if required)
    if (this.requireSimulation) {
      simulationResult = await this.simulate(tx);
      
      if (!simulationResult.success) {
        return {
          allowed: false,
          reason: `Simulation failed: ${simulationResult.error}`,
          simulationResult,
          programsChecked: programChecks,
          estimatedSpend,
          warnings: [...warnings, ...simulationResult.warnings],
        };
      }
      
      warnings.push(...simulationResult.warnings);
    }

    // All checks passed
    return {
      allowed: true,
      simulationResult,
      programsChecked: programChecks,
      estimatedSpend,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  /**
   * Simulate a transaction without full firewall checks
   */
  async simulate(tx: Transaction | VersionedTransaction): Promise<SimulationResult> {
    return this.simulator.simulate(tx, this.payerPublicKey);
  }

  /**
   * Record a successful transaction's spend
   * Call this after transaction is confirmed
   */
  recordSpend(amountLamports: number): void {
    this.limits.recordSpend(amountLamports);
  }

  /**
   * Reset daily spending limit counter
   */
  resetDailySpend(): void {
    this.limits.resetDailySpend();
  }

  /**
   * Get current firewall status
   */
  getStatus(): FirewallStatus {
    const spendStatus = this.limits.getStatus();
    const programStatus = this.allowlist.getStatus();

    return {
      spending: {
        dailySpend: spendStatus.dailySpend,
        dailyLimit: spendStatus.dailyLimit,
        perTxLimit: spendStatus.perTxLimit,
        remainingDaily: spendStatus.dailyLimit - spendStatus.dailySpend,
      },
      programs: programStatus,
      requireSimulation: this.requireSimulation,
    };
  }

  /**
   * Add a program to the blocklist at runtime
   */
  blockProgram(programId: string): void {
    this.allowlist.addToBlocklist(programId);
  }

  /**
   * Add a program to the allowlist at runtime (if in allowlist mode)
   */
  allowProgram(programId: string): boolean {
    return this.allowlist.addToAllowlist(programId);
  }
}

// Re-export types and utilities
export { SpendingLimits, SpendingLimitConfig } from './limits';
export { ProgramAllowlist, AllowlistConfig, ProgramCheckResult, SAFE_SYSTEM_PROGRAMS, KNOWN_MALICIOUS_PROGRAMS } from './allowlist';
export { TransactionSimulator, SimulationResult, SimulatorConfig, BalanceChange } from './simulator';

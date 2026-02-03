/**
 * Transaction simulator for pre-flight validation
 */

import { 
  Transaction, 
  VersionedTransaction, 
  Connection, 
  PublicKey,
  TransactionInstruction,
  MessageCompiledInstruction
} from '@solana/web3.js';

export interface SimulationResult {
  success: boolean;
  error?: string;
  logs?: string[];
  unitsConsumed?: number;
  balanceChanges?: BalanceChange[];
  warnings: string[];
}

export interface BalanceChange {
  account: string;
  preBalance: number;
  postBalance: number;
  change: number;
}

export interface SimulatorConfig {
  rpcUrl: string;
  commitment?: 'processed' | 'confirmed' | 'finalized';
  maxRetries?: number;
}

export class TransactionSimulator {
  private readonly connection: Connection;
  private readonly commitment: 'processed' | 'confirmed' | 'finalized';
  private readonly maxRetries: number;

  constructor(config: SimulatorConfig) {
    this.connection = new Connection(config.rpcUrl, {
      commitment: config.commitment || 'confirmed',
    });
    this.commitment = config.commitment || 'confirmed';
    this.maxRetries = config.maxRetries || 2;
  }

  /**
   * Simulate a transaction and return detailed results
   */
  async simulate(
    tx: Transaction | VersionedTransaction,
    _signerPublicKey?: PublicKey
  ): Promise<SimulationResult> {
    const warnings: string[] = [];

    try {
      let simulationResult;

      if (tx instanceof Transaction) {
        // Legacy transaction
        if (!tx.recentBlockhash) {
          const { blockhash } = await this.connection.getLatestBlockhash(this.commitment);
          tx.recentBlockhash = blockhash;
        }

        simulationResult = await this.simulateWithRetry(async () => {
          // For legacy transactions, use the array-based overload
          return await this.connection.simulateTransaction(tx);
        });
      } else {
        // Versioned transaction
        simulationResult = await this.simulateWithRetry(async () => {
          return await this.connection.simulateTransaction(tx, {
            commitment: this.commitment,
            sigVerify: false,
          });
        });
      }

      const { value } = simulationResult;

      // Check for errors
      if (value.err) {
        return {
          success: false,
          error: this.formatSimulationError(value.err),
          logs: value.logs || [],
          unitsConsumed: value.unitsConsumed ?? undefined,
          warnings,
        };
      }

      // Analyze logs for warnings
      const logWarnings = this.analyzeLogsForWarnings(value.logs || []);
      warnings.push(...logWarnings);

      // Check compute units
      if (value.unitsConsumed && value.unitsConsumed > 1_000_000) {
        warnings.push(`High compute usage: ${value.unitsConsumed.toLocaleString()} units`);
      }

      return {
        success: true,
        logs: value.logs || [],
        unitsConsumed: value.unitsConsumed ?? undefined,
        warnings,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown simulation error',
        warnings,
      };
    }
  }

  /**
   * Get estimated SOL spend from a transaction
   * This is a basic estimation - actual spend may differ
   */
  async estimateSpend(
    tx: Transaction | VersionedTransaction,
    _payerPublicKey: PublicKey
  ): Promise<{ estimatedSpend: number; fee: number; warnings: string[] }> {
    const warnings: string[] = [];

    try {
      // Get fee for the transaction
      let fee = 5000; // Default Solana fee (5000 lamports)
      
      if (tx instanceof Transaction && tx.recentBlockhash) {
        const feeResult = await this.connection.getFeeForMessage(
          tx.compileMessage(),
          this.commitment
        );
        if (feeResult.value !== null) {
          fee = feeResult.value;
        }
      }

      // Analyze instructions for transfers
      let estimatedSpend = fee;

      if (tx instanceof Transaction) {
        for (const ix of tx.instructions) {
          const spend = this.extractSpendFromLegacyInstruction(ix);
          estimatedSpend += spend;
        }
      } else {
        for (const ix of tx.message.compiledInstructions) {
          const spend = this.extractSpendFromCompiledInstruction(ix, tx);
          estimatedSpend += spend;
        }
      }

      if (estimatedSpend === fee) {
        warnings.push('Could not detect explicit SOL transfers - spend may be higher');
      }

      return { estimatedSpend, fee, warnings };
    } catch (error) {
      warnings.push(`Fee estimation failed: ${error instanceof Error ? error.message : 'unknown'}`);
      return { estimatedSpend: 5000, fee: 5000, warnings };
    }
  }

  /**
   * Extract program IDs from a transaction
   */
  extractProgramIds(tx: Transaction | VersionedTransaction): string[] {
    if (tx instanceof Transaction) {
      return [...new Set(tx.instructions.map(ix => ix.programId.toBase58()))];
    } else {
      const programIdIndexes = [...new Set(tx.message.compiledInstructions.map(ix => ix.programIdIndex))];
      return programIdIndexes.map(idx => tx.message.staticAccountKeys[idx].toBase58());
    }
  }

  private extractSpendFromLegacyInstruction(ix: TransactionInstruction): number {
    const programId = ix.programId.toBase58();
    
    if (programId === '11111111111111111111111111111111') {
      // System program - check for transfer instruction
      const data = Buffer.from(ix.data);
      if (data.length >= 12) {
        const instructionType = data.readUInt32LE(0);
        if (instructionType === 2) {
          // Transfer instruction
          return Number(data.readBigUInt64LE(4));
        }
      }
    }
    
    return 0;
  }

  private extractSpendFromCompiledInstruction(
    ix: MessageCompiledInstruction, 
    tx: VersionedTransaction
  ): number {
    const programId = tx.message.staticAccountKeys[ix.programIdIndex].toBase58();
    
    if (programId === '11111111111111111111111111111111') {
      // System program - check for transfer instruction
      const data = Buffer.from(ix.data);
      if (data.length >= 12) {
        const instructionType = data.readUInt32LE(0);
        if (instructionType === 2) {
          // Transfer instruction
          return Number(data.readBigUInt64LE(4));
        }
      }
    }
    
    return 0;
  }

  private async simulateWithRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error | null = null;
    
    for (let i = 0; i < this.maxRetries; i++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');
        if (i < this.maxRetries - 1) {
          await this.sleep(100 * (i + 1)); // Exponential backoff
        }
      }
    }
    
    throw lastError;
  }

  private formatSimulationError(err: unknown): string {
    if (typeof err === 'string') return err;
    if (typeof err === 'object' && err !== null) {
      // Handle Solana error format
      if ('InstructionError' in (err as Record<string, unknown>)) {
        const instructionError = (err as Record<string, unknown>)['InstructionError'];
        if (Array.isArray(instructionError) && instructionError.length >= 2) {
          const [index, errorType] = instructionError;
          return `Instruction ${index} failed: ${JSON.stringify(errorType)}`;
        }
      }
      return JSON.stringify(err);
    }
    return 'Unknown error';
  }

  private analyzeLogsForWarnings(logs: string[]): string[] {
    const warnings: string[] = [];
    
    for (const log of logs) {
      const logLower = log.toLowerCase();
      
      // Check for concerning patterns
      if (logLower.includes('insufficient funds')) {
        warnings.push('Transaction may fail due to insufficient funds');
      }
      if (logLower.includes('slippage')) {
        warnings.push('Transaction involves slippage tolerance - check settings');
      }
      if (logLower.includes('authority') && logLower.includes('invalid')) {
        warnings.push('Authority mismatch detected in logs');
      }
    }
    
    return warnings;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Spending limit tracker for transaction firewall
 */

export interface SpendingLimitConfig {
  maxDailySpend: number;   // lamports
  maxPerTxSpend: number;   // lamports
}

export interface SpendingCheckResult {
  allowed: boolean;
  reason?: string;
  currentDailySpend: number;
  remainingDaily: number;
}

export class SpendingLimits {
  private dailySpend: number = 0;
  private lastResetDate: string;
  private readonly maxDaily: number;
  private readonly maxPerTx: number;

  constructor(config: SpendingLimitConfig) {
    this.maxDaily = config.maxDailySpend;
    this.maxPerTx = config.maxPerTxSpend;
    this.lastResetDate = this.getTodayDate();
  }

  /**
   * Check if a transaction amount is within limits
   */
  check(amountLamports: number): SpendingCheckResult {
    this.maybeResetDaily();

    // Check per-transaction limit
    if (amountLamports > this.maxPerTx) {
      return {
        allowed: false,
        reason: `Transaction amount ${this.formatLamports(amountLamports)} exceeds per-tx limit of ${this.formatLamports(this.maxPerTx)}`,
        currentDailySpend: this.dailySpend,
        remainingDaily: Math.max(0, this.maxDaily - this.dailySpend),
      };
    }

    // Check daily limit
    const projectedDaily = this.dailySpend + amountLamports;
    if (projectedDaily > this.maxDaily) {
      return {
        allowed: false,
        reason: `Transaction would exceed daily limit. Current: ${this.formatLamports(this.dailySpend)}, Tx: ${this.formatLamports(amountLamports)}, Limit: ${this.formatLamports(this.maxDaily)}`,
        currentDailySpend: this.dailySpend,
        remainingDaily: Math.max(0, this.maxDaily - this.dailySpend),
      };
    }

    return {
      allowed: true,
      currentDailySpend: this.dailySpend,
      remainingDaily: this.maxDaily - projectedDaily,
    };
  }

  /**
   * Record a spend (call after transaction succeeds)
   */
  recordSpend(amountLamports: number): void {
    this.maybeResetDaily();
    this.dailySpend += amountLamports;
  }

  /**
   * Manually reset daily spend counter
   */
  resetDailySpend(): void {
    this.dailySpend = 0;
    this.lastResetDate = this.getTodayDate();
  }

  /**
   * Get current spending status
   */
  getStatus(): { dailySpend: number; dailyLimit: number; perTxLimit: number } {
    this.maybeResetDaily();
    return {
      dailySpend: this.dailySpend,
      dailyLimit: this.maxDaily,
      perTxLimit: this.maxPerTx,
    };
  }

  private maybeResetDaily(): void {
    const today = this.getTodayDate();
    if (today !== this.lastResetDate) {
      this.dailySpend = 0;
      this.lastResetDate = today;
    }
  }

  private getTodayDate(): string {
    return new Date().toISOString().split('T')[0];
  }

  private formatLamports(lamports: number): string {
    const sol = lamports / 1e9;
    if (sol >= 0.001) {
      return `${sol.toFixed(4)} SOL`;
    }
    return `${lamports.toLocaleString()} lamports`;
  }
}

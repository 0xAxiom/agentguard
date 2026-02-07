/**
 * SpendingLimits tests — covers limits.ts (79% → target 95%+)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SpendingLimits } from '../src/firewall/limits';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';

describe('SpendingLimits', () => {
  let limits: SpendingLimits;

  beforeEach(() => {
    limits = new SpendingLimits({
      maxDailySpend: 10 * LAMPORTS_PER_SOL,
      maxPerTxSpend: 1 * LAMPORTS_PER_SOL,
    });
  });

  describe('check()', () => {
    it('allows transactions within limits', () => {
      const result = limits.check(0.5 * LAMPORTS_PER_SOL);
      expect(result.allowed).toBe(true);
      expect(result.remainingDaily).toBe(9.5 * LAMPORTS_PER_SOL);
    });

    it('blocks per-tx limit exceeded', () => {
      const result = limits.check(2 * LAMPORTS_PER_SOL);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('per-tx limit');
    });

    it('blocks daily limit exceeded', () => {
      // Spend up to near the limit
      limits.recordSpend(9.5 * LAMPORTS_PER_SOL);
      const result = limits.check(0.8 * LAMPORTS_PER_SOL);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('daily limit');
    });

    it('formats amounts in SOL when >= 0.001', () => {
      const result = limits.check(2 * LAMPORTS_PER_SOL);
      expect(result.reason).toContain('SOL');
    });

    it('formats amounts in lamports when < 0.001 SOL', () => {
      const smallLimits = new SpendingLimits({
        maxDailySpend: 100,
        maxPerTxSpend: 50,
      });
      const result = smallLimits.check(80);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('lamports');
    });

    it('returns currentDailySpend accurately', () => {
      limits.recordSpend(1 * LAMPORTS_PER_SOL);
      limits.recordSpend(2 * LAMPORTS_PER_SOL);
      const result = limits.check(0.1 * LAMPORTS_PER_SOL);
      expect(result.currentDailySpend).toBe(3 * LAMPORTS_PER_SOL);
    });

    it('clamps remainingDaily to 0 when overspent', () => {
      // Force check where remaining would be negative  
      const tinyLimits = new SpendingLimits({
        maxDailySpend: 1000,
        maxPerTxSpend: 2000, // per-tx is higher than daily
      });
      tinyLimits.recordSpend(900);
      const result = tinyLimits.check(200);
      expect(result.allowed).toBe(false);
      expect(result.remainingDaily).toBe(100); // 1000-900
    });
  });

  describe('recordSpend()', () => {
    it('accumulates spending', () => {
      limits.recordSpend(100);
      limits.recordSpend(200);
      const status = limits.getStatus();
      expect(status.dailySpend).toBe(300);
    });
  });

  describe('resetDailySpend()', () => {
    it('resets to zero', () => {
      limits.recordSpend(5 * LAMPORTS_PER_SOL);
      limits.resetDailySpend();
      const status = limits.getStatus();
      expect(status.dailySpend).toBe(0);
    });
  });

  describe('getStatus()', () => {
    it('returns correct shape', () => {
      const status = limits.getStatus();
      expect(status).toHaveProperty('dailySpend');
      expect(status).toHaveProperty('dailyLimit');
      expect(status).toHaveProperty('perTxLimit');
      expect(status.dailyLimit).toBe(10 * LAMPORTS_PER_SOL);
      expect(status.perTxLimit).toBe(1 * LAMPORTS_PER_SOL);
    });
  });

  describe('daily reset on date change', () => {
    it('resets daily spend when date changes', () => {
      limits.recordSpend(5 * LAMPORTS_PER_SOL);
      
      // Mock date to next day
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      vi.useFakeTimers();
      vi.setSystemTime(tomorrow);

      const status = limits.getStatus();
      expect(status.dailySpend).toBe(0);

      vi.useRealTimers();
    });

    it('resets during check() on new day', () => {
      limits.recordSpend(9 * LAMPORTS_PER_SOL);
      
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      vi.useFakeTimers();
      vi.setSystemTime(tomorrow);

      // Should be allowed now since daily reset
      const result = limits.check(0.5 * LAMPORTS_PER_SOL);
      expect(result.allowed).toBe(true);
      expect(result.currentDailySpend).toBe(0);

      vi.useRealTimers();
    });
  });
});

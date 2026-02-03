/**
 * Tests for TransactionFirewall
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TransactionFirewall } from '../src/firewall';
import { Transaction, PublicKey, SystemProgram, LAMPORTS_PER_SOL, Keypair } from '@solana/web3.js';

// Mock RPC for simulation
vi.mock('@solana/web3.js', async () => {
  const actual = await vi.importActual('@solana/web3.js');
  return {
    ...actual,
    Connection: vi.fn().mockImplementation(() => ({
      simulateTransaction: vi.fn().mockResolvedValue({
        value: { err: null, logs: [] }
      }),
      getLatestBlockhash: vi.fn().mockResolvedValue({
        blockhash: '11111111111111111111111111111111',
        lastValidBlockHeight: 1000
      })
    }))
  };
});

describe('TransactionFirewall', () => {
  let firewall: TransactionFirewall;
  // Use real Keypair for valid public key
  const mockPayer = Keypair.generate().publicKey;
  const mockRecipient = Keypair.generate().publicKey;

  beforeEach(() => {
    firewall = new TransactionFirewall({
      maxDailySpend: 10 * LAMPORTS_PER_SOL, // 10 SOL
      maxPerTxSpend: 1 * LAMPORTS_PER_SOL,  // 1 SOL
      rpcUrl: 'https://api.devnet.solana.com',
      requireSimulation: false, // Skip simulation for unit tests
      payerPublicKey: mockPayer
    });
  });

  describe('program allowlist', () => {
    it('allows system program by default', async () => {
      const firewall = new TransactionFirewall({
        maxDailySpend: 10 * LAMPORTS_PER_SOL,
        maxPerTxSpend: 1 * LAMPORTS_PER_SOL,
        rpcUrl: 'https://api.devnet.solana.com',
        requireSimulation: false
      });

      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: mockPayer,
          toPubkey: mockRecipient,
          lamports: 1000
        })
      );

      const result = await firewall.check(tx);
      expect(result.allowed).toBe(true);
    });

    it('blocks programs in blocklist', async () => {
      // Use a valid public key format for blocked program
      const blockedProgram = Keypair.generate().publicKey.toBase58();
      
      const firewall = new TransactionFirewall({
        maxDailySpend: 10 * LAMPORTS_PER_SOL,
        maxPerTxSpend: 1 * LAMPORTS_PER_SOL,
        blockedPrograms: [blockedProgram],
        rpcUrl: 'https://api.devnet.solana.com',
        requireSimulation: false
      });

      const tx = new Transaction();
      tx.add({
        programId: new PublicKey(blockedProgram),
        keys: [],
        data: Buffer.from([])
      });

      const result = await firewall.check(tx);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('blocked');
    });

    it('only allows allowlisted programs when set', async () => {
      const firewall = new TransactionFirewall({
        maxDailySpend: 10 * LAMPORTS_PER_SOL,
        maxPerTxSpend: 1 * LAMPORTS_PER_SOL,
        allowedPrograms: [SystemProgram.programId.toBase58()],
        rpcUrl: 'https://api.devnet.solana.com',
        requireSimulation: false
      });

      // Random program not in allowlist
      const randomProgram = Keypair.generate().publicKey;
      const tx = new Transaction();
      tx.add({
        programId: randomProgram,
        keys: [],
        data: Buffer.from([])
      });

      const result = await firewall.check(tx);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not in allowlist');
    });

    it('allows runtime program additions', async () => {
      const firewall = new TransactionFirewall({
        maxDailySpend: 10 * LAMPORTS_PER_SOL,
        maxPerTxSpend: 1 * LAMPORTS_PER_SOL,
        allowedPrograms: [], // Empty allowlist
        rpcUrl: 'https://api.devnet.solana.com',
        requireSimulation: false
      });

      const programKey = Keypair.generate().publicKey;
      const programId = programKey.toBase58();
      
      // Initially blocked
      const tx = new Transaction();
      tx.add({
        programId: programKey,
        keys: [],
        data: Buffer.from([])
      });

      let result = await firewall.check(tx);
      expect(result.allowed).toBe(false);

      // Add to allowlist
      firewall.allowProgram(programId);

      // Now allowed
      result = await firewall.check(tx);
      expect(result.allowed).toBe(true);
    });
  });

  describe('spending limits', () => {
    it('returns status with remaining daily spend', () => {
      const status = firewall.getStatus();
      
      expect(status.spending.dailyLimit).toBe(10 * LAMPORTS_PER_SOL);
      expect(status.spending.perTxLimit).toBe(1 * LAMPORTS_PER_SOL);
      expect(status.spending.dailySpend).toBe(0);
      expect(status.spending.remainingDaily).toBe(10 * LAMPORTS_PER_SOL);
    });

    it('tracks recorded spending', () => {
      firewall.recordSpend(2 * LAMPORTS_PER_SOL);
      
      const status = firewall.getStatus();
      expect(status.spending.dailySpend).toBe(2 * LAMPORTS_PER_SOL);
      expect(status.spending.remainingDaily).toBe(8 * LAMPORTS_PER_SOL);
    });

    it('resets daily spend counter', () => {
      firewall.recordSpend(5 * LAMPORTS_PER_SOL);
      expect(firewall.getStatus().spending.dailySpend).toBe(5 * LAMPORTS_PER_SOL);
      
      firewall.resetDailySpend();
      expect(firewall.getStatus().spending.dailySpend).toBe(0);
    });

    it('accumulates spending over multiple transactions', () => {
      firewall.recordSpend(1 * LAMPORTS_PER_SOL);
      firewall.recordSpend(2 * LAMPORTS_PER_SOL);
      firewall.recordSpend(3 * LAMPORTS_PER_SOL);
      
      const status = firewall.getStatus();
      expect(status.spending.dailySpend).toBe(6 * LAMPORTS_PER_SOL);
    });
  });

  describe('firewall status', () => {
    it('reports simulation requirement', () => {
      const withSim = new TransactionFirewall({
        maxDailySpend: 10 * LAMPORTS_PER_SOL,
        maxPerTxSpend: 1 * LAMPORTS_PER_SOL,
        rpcUrl: 'https://api.devnet.solana.com',
        requireSimulation: true
      });

      const withoutSim = new TransactionFirewall({
        maxDailySpend: 10 * LAMPORTS_PER_SOL,
        maxPerTxSpend: 1 * LAMPORTS_PER_SOL,
        rpcUrl: 'https://api.devnet.solana.com',
        requireSimulation: false
      });

      expect(withSim.getStatus().requireSimulation).toBe(true);
      expect(withoutSim.getStatus().requireSimulation).toBe(false);
    });

    it('reports program mode', () => {
      const allowlistMode = new TransactionFirewall({
        maxDailySpend: 10 * LAMPORTS_PER_SOL,
        maxPerTxSpend: 1 * LAMPORTS_PER_SOL,
        allowedPrograms: [SystemProgram.programId.toBase58()],
        rpcUrl: 'https://api.devnet.solana.com',
        requireSimulation: false
      });

      const blockedKey = Keypair.generate().publicKey.toBase58();
      const blocklistOnly = new TransactionFirewall({
        maxDailySpend: 10 * LAMPORTS_PER_SOL,
        maxPerTxSpend: 1 * LAMPORTS_PER_SOL,
        blockedPrograms: [blockedKey],
        rpcUrl: 'https://api.devnet.solana.com',
        requireSimulation: false
      });

      expect(allowlistMode.getStatus().programs.mode).toBe('allowlist');
      expect(blocklistOnly.getStatus().programs.mode).toBe('blocklist_only');
    });
  });

  describe('runtime blocklist', () => {
    it('blocks programs added at runtime', async () => {
      const programKey = Keypair.generate().publicKey;
      const programId = programKey.toBase58();
      
      const tx = new Transaction();
      tx.add({
        programId: programKey,
        keys: [],
        data: Buffer.from([])
      });

      // Initially allowed (no blocklist)
      let result = await firewall.check(tx);
      expect(result.allowed).toBe(true);

      // Add to blocklist
      firewall.blockProgram(programId);

      // Now blocked
      result = await firewall.check(tx);
      expect(result.allowed).toBe(false);
    });
  });
});

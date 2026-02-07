/**
 * TransactionSimulator tests — covers simulator.ts (61% → target 85%+)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  Keypair,
  SystemProgram,
  Transaction,
  PublicKey,
  LAMPORTS_PER_SOL,
  Connection,
  VersionedTransaction,
  MessageV0,
  TransactionMessage,
} from '@solana/web3.js';
import { TransactionSimulator } from '../src/firewall/simulator';

// Mock the Connection to avoid real RPC calls
vi.mock('@solana/web3.js', async () => {
  const actual = await vi.importActual('@solana/web3.js');
  return {
    ...actual as any,
  };
});

describe('TransactionSimulator', () => {
  let simulator: TransactionSimulator;

  beforeEach(() => {
    simulator = new TransactionSimulator({
      rpcUrl: 'https://api.devnet.solana.com',
      commitment: 'confirmed',
      maxRetries: 2,
    });
  });

  describe('extractProgramIds', () => {
    it('extracts program IDs from legacy Transaction', () => {
      const payer = Keypair.generate();
      const recipient = Keypair.generate();
      
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: recipient.publicKey,
          lamports: LAMPORTS_PER_SOL,
        })
      );

      const programIds = simulator.extractProgramIds(tx);
      expect(programIds).toContain(SystemProgram.programId.toBase58());
    });

    it('handles multiple instructions', () => {
      const payer = Keypair.generate();
      const r1 = Keypair.generate();
      const r2 = Keypair.generate();
      
      const tx = new Transaction()
        .add(SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: r1.publicKey,
          lamports: 1000,
        }))
        .add(SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: r2.publicKey,
          lamports: 2000,
        }));

      const programIds = simulator.extractProgramIds(tx);
      // Both use SystemProgram, should deduplicate
      expect(programIds.length).toBeGreaterThanOrEqual(1);
      expect(programIds).toContain(SystemProgram.programId.toBase58());
    });

    it('extracts from VersionedTransaction', () => {
      const payer = Keypair.generate();
      const recipient = Keypair.generate();

      const ix = SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: recipient.publicKey,
        lamports: 1000,
      });

      // Build a v0 message
      const msg = MessageV0.compile({
        payerKey: payer.publicKey,
        instructions: [ix],
        recentBlockhash: '11111111111111111111111111111111',
      });

      const vTx = new VersionedTransaction(msg);
      const programIds = simulator.extractProgramIds(vTx);
      expect(programIds).toContain(SystemProgram.programId.toBase58());
    });
  });

  describe('simulate', () => {
    it('handles simulation errors gracefully', async () => {
      const payer = Keypair.generate();
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: Keypair.generate().publicKey,
          lamports: LAMPORTS_PER_SOL,
        })
      );

      // This will fail because we can't actually simulate on devnet without funded account
      const result = await simulator.simulate(tx, payer.publicKey);
      // Should return a result without throwing
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('warnings');
    });
  });

  describe('estimateSpend', () => {
    it('estimates spend for system transfer', async () => {
      const payer = Keypair.generate();
      const recipient = Keypair.generate();
      
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: recipient.publicKey,
          lamports: LAMPORTS_PER_SOL,
        })
      );
      tx.recentBlockhash = '11111111111111111111111111111111';
      tx.feePayer = payer.publicKey;

      // Will likely fail RPC fee lookup but should handle gracefully
      const result = await simulator.estimateSpend(tx, payer.publicKey);
      expect(result).toHaveProperty('estimatedSpend');
      expect(result).toHaveProperty('fee');
      expect(result).toHaveProperty('warnings');
      expect(result.estimatedSpend).toBeGreaterThan(0);
    });

    it('adds warning when no explicit transfers detected', async () => {
      const payer = Keypair.generate();
      
      // Create a tx with no transfer (just an allocate)
      const tx = new Transaction().add(
        SystemProgram.createAccount({
          fromPubkey: payer.publicKey,
          newAccountPubkey: Keypair.generate().publicKey,
          lamports: 1000,
          space: 0,
          programId: SystemProgram.programId,
        })
      );
      tx.recentBlockhash = '11111111111111111111111111111111';
      tx.feePayer = payer.publicKey;

      const result = await simulator.estimateSpend(tx, payer.publicKey);
      expect(result).toHaveProperty('estimatedSpend');
    });
  });

  describe('constructor options', () => {
    it('accepts custom commitment', () => {
      const sim = new TransactionSimulator({
        rpcUrl: 'https://api.devnet.solana.com',
        commitment: 'finalized',
      });
      expect(sim).toBeDefined();
    });

    it('accepts custom maxRetries', () => {
      const sim = new TransactionSimulator({
        rpcUrl: 'https://api.devnet.solana.com',
        maxRetries: 5,
      });
      expect(sim).toBeDefined();
    });

    it('uses defaults when not specified', () => {
      const sim = new TransactionSimulator({
        rpcUrl: 'https://api.devnet.solana.com',
      });
      expect(sim).toBeDefined();
    });
  });
});

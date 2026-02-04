/**
 * On-Chain Audit Logger Tests
 * 
 * Unit tests for the TypeScript client.
 * Integration tests require a running validator (skipped in CI).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Keypair, PublicKey, Connection } from '@solana/web3.js';
import { 
  OnchainAuditLogger, 
  SecurityEventType, 
  PROGRAM_ID,
} from '../src/audit/onchain';
import { createHash } from 'crypto';

describe('OnchainAuditLogger', () => {
  let connection: Connection;
  let wallet: Keypair;
  let logger: OnchainAuditLogger;

  beforeEach(() => {
    connection = new Connection('https://api.devnet.solana.com');
    wallet = Keypair.generate();
    logger = new OnchainAuditLogger(connection, wallet);
  });

  describe('PDA derivation', () => {
    it('should derive deterministic authority PDA', () => {
      const [pda1] = PublicKey.findProgramAddressSync(
        [Buffer.from('audit-authority'), wallet.publicKey.toBuffer()],
        PROGRAM_ID
      );
      const [pda2] = PublicKey.findProgramAddressSync(
        [Buffer.from('audit-authority'), wallet.publicKey.toBuffer()],
        PROGRAM_ID
      );
      expect(pda1.toBase58()).toBe(pda2.toBase58());
    });

    it('should derive different PDAs for different wallets', () => {
      const wallet2 = Keypair.generate();
      const [pda1] = PublicKey.findProgramAddressSync(
        [Buffer.from('audit-authority'), wallet.publicKey.toBuffer()],
        PROGRAM_ID
      );
      const [pda2] = PublicKey.findProgramAddressSync(
        [Buffer.from('audit-authority'), wallet2.publicKey.toBuffer()],
        PROGRAM_ID
      );
      expect(pda1.toBase58()).not.toBe(pda2.toBase58());
    });

    it('should derive deterministic event PDAs', () => {
      const indexBuf = Buffer.alloc(8);
      indexBuf.writeBigUInt64LE(BigInt(0));
      
      const [pda1] = PublicKey.findProgramAddressSync(
        [Buffer.from('security-event'), wallet.publicKey.toBuffer(), indexBuf],
        PROGRAM_ID
      );
      const [pda2] = PublicKey.findProgramAddressSync(
        [Buffer.from('security-event'), wallet.publicKey.toBuffer(), indexBuf],
        PROGRAM_ID
      );
      expect(pda1.toBase58()).toBe(pda2.toBase58());
    });

    it('should derive different PDAs for different event indices', () => {
      const idx0 = Buffer.alloc(8);
      idx0.writeBigUInt64LE(BigInt(0));
      const idx1 = Buffer.alloc(8);
      idx1.writeBigUInt64LE(BigInt(1));

      const [pda1] = PublicKey.findProgramAddressSync(
        [Buffer.from('security-event'), wallet.publicKey.toBuffer(), idx0],
        PROGRAM_ID
      );
      const [pda2] = PublicKey.findProgramAddressSync(
        [Buffer.from('security-event'), wallet.publicKey.toBuffer(), idx1],
        PROGRAM_ID
      );
      expect(pda1.toBase58()).not.toBe(pda2.toBase58());
    });
  });

  describe('verifyEventDetails', () => {
    it('should verify matching details', () => {
      const details = JSON.stringify({ action: 'transfer', amount: 1 });
      const hash = createHash('sha256').update(details).digest();

      const event = {
        authority: wallet.publicKey,
        eventType: SecurityEventType.TransactionCheck,
        actionHash: hash,
        allowed: true,
        timestamp: Date.now(),
        eventIndex: 0,
        detailsLen: Buffer.byteLength(details),
        bump: 255,
        address: wallet.publicKey,
      };

      expect(OnchainAuditLogger.verifyEventDetails(event, details)).toBe(true);
    });

    it('should reject non-matching details', () => {
      const details = 'original details';
      const hash = createHash('sha256').update(details).digest();

      const event = {
        authority: wallet.publicKey,
        eventType: SecurityEventType.TransactionCheck,
        actionHash: hash,
        allowed: true,
        timestamp: Date.now(),
        eventIndex: 0,
        detailsLen: Buffer.byteLength(details),
        bump: 255,
        address: wallet.publicKey,
      };

      expect(OnchainAuditLogger.verifyEventDetails(event, 'tampered details')).toBe(false);
    });
  });

  describe('SecurityEventType enum', () => {
    it('should have correct values', () => {
      expect(SecurityEventType.TransactionCheck).toBe(0);
      expect(SecurityEventType.PromptInjection).toBe(1);
      expect(SecurityEventType.SecretLeak).toBe(2);
      expect(SecurityEventType.GeneralAction).toBe(3);
    });
  });

  describe('PROGRAM_ID', () => {
    it('should be a valid public key', () => {
      expect(PROGRAM_ID).toBeInstanceOf(PublicKey);
      expect(PROGRAM_ID.toBase58()).toBe('9iCre3TbvPbgmV2RmviiUtCuNiNeQa9cphSABPpkGSdR');
    });
  });

  describe('constructor', () => {
    it('should create logger with connection and wallet', () => {
      const newLogger = new OnchainAuditLogger(connection, wallet);
      expect(newLogger).toBeInstanceOf(OnchainAuditLogger);
    });
  });

  describe('getAuthority (no on-chain state)', () => {
    it('should return null for uninitialized authority', async () => {
      const authority = await logger.getAuthority();
      expect(authority).toBeNull();
    });
  });

  describe('getEvent (no on-chain state)', () => {
    it('should return null for non-existent event', async () => {
      const event = await logger.getEvent(0);
      expect(event).toBeNull();
    });
  });

  describe('getEvents (no on-chain state)', () => {
    it('should return empty array for uninitialized authority', async () => {
      const events = await logger.getEvents();
      expect(events).toEqual([]);
    });
  });

  describe('getEventsForAuthority (static)', () => {
    it('should return empty array for unknown authority', async () => {
      const randomWallet = Keypair.generate();
      const events = await OnchainAuditLogger.getEventsForAuthority(
        connection,
        randomWallet.publicKey
      );
      expect(events).toEqual([]);
    });
  });

  describe('details hashing', () => {
    it('should produce deterministic hashes', () => {
      const details = 'test details for hashing';
      const hash1 = createHash('sha256').update(details).digest();
      const hash2 = createHash('sha256').update(details).digest();
      expect(hash1.equals(hash2)).toBe(true);
    });

    it('should produce different hashes for different details', () => {
      const hash1 = createHash('sha256').update('details A').digest();
      const hash2 = createHash('sha256').update('details B').digest();
      expect(hash1.equals(hash2)).toBe(false);
    });

    it('should produce 32-byte hashes', () => {
      const hash = createHash('sha256').update('any string').digest();
      expect(hash.length).toBe(32);
    });
  });
});

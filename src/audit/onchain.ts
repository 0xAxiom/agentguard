/**
 * On-Chain Audit Logger
 * 
 * Writes security events to Solana via the AgentGuard Anchor program.
 * Provides immutable, verifiable audit trails for AI agents.
 * 
 * Usage:
 *   const logger = new OnchainAuditLogger(connection, wallet);
 *   await logger.initialize();
 *   await logger.logSecurityEvent({ type: 'tx_check', allowed: false, details: '...' });
 * 
 * Anyone can read events via getEvents() for transparency.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { createHash } from 'crypto';

// Program ID (deployed on devnet)
export const PROGRAM_ID = new PublicKey('9iCre3TbvPbgmV2RmviiUtCuNiNeQa9cphSABPpkGSdR');

// Account discriminators (first 8 bytes of SHA-256 of "account:<Name>")
const AUDIT_AUTHORITY_DISCRIMINATOR = Buffer.from(
  createHash('sha256').update('account:AuditAuthority').digest().subarray(0, 8)
);
const SECURITY_EVENT_DISCRIMINATOR = Buffer.from(
  createHash('sha256').update('account:SecurityEvent').digest().subarray(0, 8)
);

// Instruction discriminators (first 8 bytes of SHA-256 of "global:<name>")
const IX_INITIALIZE = Buffer.from(
  createHash('sha256').update('global:initialize').digest().subarray(0, 8)
);
const IX_LOG_EVENT = Buffer.from(
  createHash('sha256').update('global:log_event').digest().subarray(0, 8)
);
const IX_CLOSE_EVENT = Buffer.from(
  createHash('sha256').update('global:close_event').digest().subarray(0, 8)
);

export enum SecurityEventType {
  TransactionCheck = 0,
  PromptInjection = 1,
  SecretLeak = 2,
  GeneralAction = 3,
}

export interface OnchainSecurityEvent {
  authority: PublicKey;
  eventType: SecurityEventType;
  actionHash: Buffer;
  allowed: boolean;
  timestamp: number;
  eventIndex: number;
  detailsLen: number;
  bump: number;
  address: PublicKey;
}

export interface OnchainAuditAuthority {
  authority: PublicKey;
  eventCount: number;
  createdAt: number;
  bump: number;
  address: PublicKey;
}

export interface LogEventParams {
  type: SecurityEventType;
  allowed: boolean;
  details: string;  // Hashed before writing on-chain
}

/**
 * On-Chain Audit Logger
 * 
 * Writes security events to the AgentGuard Anchor program.
 */
export class OnchainAuditLogger {
  private connection: Connection;
  private wallet: Keypair;
  private authorityPda: PublicKey | null = null;
  private authorityBump: number | null = null;
  private initialized: boolean = false;

  constructor(connection: Connection, wallet: Keypair) {
    this.connection = connection;
    this.wallet = wallet;
  }

  /**
   * Derive the AuditAuthority PDA for this wallet
   */
  private getAuthorityPda(): [PublicKey, number] {
    if (this.authorityPda && this.authorityBump !== null) {
      return [this.authorityPda, this.authorityBump];
    }

    const [pda, bump] = PublicKey.findProgramAddressSync(
      [Buffer.from('audit-authority'), this.wallet.publicKey.toBuffer()],
      PROGRAM_ID
    );

    this.authorityPda = pda;
    this.authorityBump = bump;
    return [pda, bump];
  }

  /**
   * Derive a SecurityEvent PDA for a given event index
   */
  private getEventPda(eventIndex: number): [PublicKey, number] {
    const indexBuf = Buffer.alloc(8);
    indexBuf.writeBigUInt64LE(BigInt(eventIndex));

    return PublicKey.findProgramAddressSync(
      [
        Buffer.from('security-event'),
        this.wallet.publicKey.toBuffer(),
        indexBuf,
      ],
      PROGRAM_ID
    );
  }

  /**
   * Hash event details for on-chain storage
   */
  private hashDetails(details: string): Buffer {
    return createHash('sha256').update(details).digest();
  }

  /**
   * Initialize the audit authority on-chain.
   * Must be called once before logging events.
   */
  async initialize(): Promise<string> {
    const [authorityPda] = this.getAuthorityPda();

    // Check if already initialized
    const accountInfo = await this.connection.getAccountInfo(authorityPda);
    if (accountInfo) {
      this.initialized = true;
      return 'already_initialized';
    }

    const data = IX_INITIALIZE;

    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: authorityPda, isSigner: false, isWritable: true },
        { pubkey: this.wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    const sig = await sendAndConfirmTransaction(this.connection, tx, [this.wallet]);
    this.initialized = true;
    return sig;
  }

  /**
   * Log a security event on-chain
   */
  async logSecurityEvent(params: LogEventParams): Promise<{
    signature: string;
    eventIndex: number;
    actionHash: string;
  }> {
    if (!this.initialized) {
      await this.initialize();
    }

    // Get current event count
    const authority = await this.getAuthority();
    if (!authority) {
      throw new Error('Audit authority not found. Call initialize() first.');
    }

    const eventIndex = authority.eventCount;
    const [authorityPda] = this.getAuthorityPda();
    const [eventPda] = this.getEventPda(eventIndex);

    const actionHash = this.hashDetails(params.details);
    const detailsLen = Buffer.byteLength(params.details, 'utf-8');

    // Encode instruction data
    const data = Buffer.alloc(
      8 +  // discriminator
      1 +  // event_type
      32 + // action_hash
      1 +  // allowed
      2    // details_len
    );

    let offset = 0;
    IX_LOG_EVENT.copy(data, offset); offset += 8;
    data.writeUInt8(params.type, offset); offset += 1;
    actionHash.copy(data, offset); offset += 32;
    data.writeUInt8(params.allowed ? 1 : 0, offset); offset += 1;
    data.writeUInt16LE(Math.min(detailsLen, 65535), offset); offset += 2;

    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: authorityPda, isSigner: false, isWritable: true },
        { pubkey: eventPda, isSigner: false, isWritable: true },
        { pubkey: this.wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    const signature = await sendAndConfirmTransaction(this.connection, tx, [this.wallet]);

    return {
      signature,
      eventIndex,
      actionHash: actionHash.toString('hex'),
    };
  }

  /**
   * Close a security event account to reclaim rent
   */
  async closeEvent(eventIndex: number): Promise<string> {
    const [authorityPda] = this.getAuthorityPda();
    const [eventPda] = this.getEventPda(eventIndex);

    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: authorityPda, isSigner: false, isWritable: false },
        { pubkey: eventPda, isSigner: false, isWritable: true },
        { pubkey: this.wallet.publicKey, isSigner: true, isWritable: true },
      ],
      data: IX_CLOSE_EVENT,
    });

    const tx = new Transaction().add(ix);
    return sendAndConfirmTransaction(this.connection, tx, [this.wallet]);
  }

  // ============================================================
  // Read Methods (anyone can call these)
  // ============================================================

  /**
   * Get the audit authority account
   */
  async getAuthority(): Promise<OnchainAuditAuthority | null> {
    const [pda] = this.getAuthorityPda();
    const accountInfo = await this.connection.getAccountInfo(pda);

    if (!accountInfo || accountInfo.data.length < AUDIT_AUTHORITY_DISCRIMINATOR.length + 49) {
      return null;
    }

    const data = accountInfo.data;
    let offset = 8; // skip discriminator

    const authority = new PublicKey(data.subarray(offset, offset + 32)); offset += 32;
    const eventCount = Number(data.readBigUInt64LE(offset)); offset += 8;
    const createdAt = Number(data.readBigInt64LE(offset)); offset += 8;
    const bump = data.readUInt8(offset); offset += 1;

    return { authority, eventCount, createdAt, bump, address: pda };
  }

  /**
   * Get a specific security event by index
   */
  async getEvent(eventIndex: number): Promise<OnchainSecurityEvent | null> {
    const [pda] = this.getEventPda(eventIndex);
    const accountInfo = await this.connection.getAccountInfo(pda);

    if (!accountInfo) return null;

    return this.parseSecurityEvent(accountInfo.data, pda);
  }

  /**
   * Get all security events for this authority
   */
  async getEvents(limit?: number): Promise<OnchainSecurityEvent[]> {
    const authority = await this.getAuthority();
    if (!authority) return [];

    const count = limit ? Math.min(limit, authority.eventCount) : authority.eventCount;
    const events: OnchainSecurityEvent[] = [];

    // Fetch events in reverse (most recent first)
    for (let i = authority.eventCount - 1; i >= Math.max(0, authority.eventCount - count); i--) {
      const event = await this.getEvent(i);
      if (event) events.push(event);
    }

    return events;
  }

  /**
   * Get events for ANY authority (for transparency/auditing)
   */
  static async getEventsForAuthority(
    connection: Connection,
    authorityWallet: PublicKey,
    limit?: number
  ): Promise<OnchainSecurityEvent[]> {
    const [authorityPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('audit-authority'), authorityWallet.toBuffer()],
      PROGRAM_ID
    );

    const accountInfo = await connection.getAccountInfo(authorityPda);
    if (!accountInfo) return [];

    const data = accountInfo.data;
    const eventCount = Number(data.readBigUInt64LE(40)); // offset past discriminator + pubkey

    const count = limit ? Math.min(limit, eventCount) : eventCount;
    const events: OnchainSecurityEvent[] = [];

    for (let i = eventCount - 1; i >= Math.max(0, eventCount - count); i--) {
      const indexBuf = Buffer.alloc(8);
      indexBuf.writeBigUInt64LE(BigInt(i));

      const [eventPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('security-event'), authorityWallet.toBuffer(), indexBuf],
        PROGRAM_ID
      );

      const eventInfo = await connection.getAccountInfo(eventPda);
      if (eventInfo) {
        const event = OnchainAuditLogger.parseSecurityEventStatic(eventInfo.data, eventPda);
        if (event) events.push(event);
      }
    }

    return events;
  }

  /**
   * Verify an event's details hash matches
   */
  static verifyEventDetails(event: OnchainSecurityEvent, details: string): boolean {
    const hash = createHash('sha256').update(details).digest();
    return hash.equals(event.actionHash);
  }

  // ============================================================
  // Internal
  // ============================================================

  private parseSecurityEvent(data: Buffer, address: PublicKey): OnchainSecurityEvent | null {
    return OnchainAuditLogger.parseSecurityEventStatic(data, address);
  }

  private static parseSecurityEventStatic(data: Buffer, address: PublicKey): OnchainSecurityEvent | null {
    if (data.length < 8 + 32 + 1 + 32 + 1 + 8 + 8 + 2 + 1) return null;

    let offset = 8; // skip discriminator

    const authority = new PublicKey(data.subarray(offset, offset + 32)); offset += 32;
    const eventType = data.readUInt8(offset) as SecurityEventType; offset += 1;
    const actionHash = Buffer.from(data.subarray(offset, offset + 32)); offset += 32;
    const allowed = data.readUInt8(offset) === 1; offset += 1;
    const timestamp = Number(data.readBigInt64LE(offset)); offset += 8;
    const eventIndex = Number(data.readBigUInt64LE(offset)); offset += 8;
    const detailsLen = data.readUInt16LE(offset); offset += 2;
    const bump = data.readUInt8(offset); offset += 1;

    return {
      authority,
      eventType,
      actionHash,
      allowed,
      timestamp,
      eventIndex,
      detailsLen,
      bump,
      address,
    };
  }
}

export default OnchainAuditLogger;

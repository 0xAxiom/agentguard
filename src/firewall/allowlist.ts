/**
 * Program allowlist/blocklist management for transaction firewall
 */

import { PublicKey } from '@solana/web3.js';

// Known malicious programs (maintained blocklist)
export const KNOWN_MALICIOUS_PROGRAMS: string[] = [
  // Add known malicious program addresses here
  // These are always blocked regardless of user config
];

// Common safe system programs
export const SAFE_SYSTEM_PROGRAMS: string[] = [
  '11111111111111111111111111111111',        // System Program
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // Token Program
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', // Associated Token Program
  'ComputeBudget111111111111111111111111111111', // Compute Budget
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',  // Memo Program
  'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s',  // Metaplex Token Metadata
];

export interface ProgramCheckResult {
  allowed: boolean;
  reason?: string;
  programId: string;
  status: 'allowed' | 'blocked' | 'not_in_allowlist' | 'system_safe';
}

export interface AllowlistConfig {
  allowedPrograms?: string[];   // If set, ONLY these programs are allowed (whitelist mode)
  blockedPrograms?: string[];   // Always blocked (added to built-in blocklist)
  allowSystemPrograms?: boolean; // Allow common Solana system programs (default: true)
}

export class ProgramAllowlist {
  private readonly allowlist: Set<string> | null; // null = no whitelist, allow all except blocked
  private readonly blocklist: Set<string>;
  private readonly systemPrograms: Set<string>;
  private readonly allowSystemPrograms: boolean;

  constructor(config: AllowlistConfig) {
    // Allowlist mode: if provided, ONLY these programs are allowed
    this.allowlist = config.allowedPrograms 
      ? new Set(config.allowedPrograms.map(p => p.toLowerCase()))
      : null;

    // Blocklist: user-provided + known malicious
    this.blocklist = new Set([
      ...KNOWN_MALICIOUS_PROGRAMS,
      ...(config.blockedPrograms || []),
    ].map(p => p.toLowerCase()));

    // System programs (safe by default)
    this.systemPrograms = new Set(SAFE_SYSTEM_PROGRAMS.map(p => p.toLowerCase()));
    this.allowSystemPrograms = config.allowSystemPrograms ?? true;
  }

  /**
   * Check if a program is allowed
   */
  check(programId: string | PublicKey): ProgramCheckResult {
    const id = typeof programId === 'string' ? programId : programId.toBase58();
    const idLower = id.toLowerCase();

    // Always check blocklist first
    if (this.blocklist.has(idLower)) {
      return {
        allowed: false,
        reason: `Program ${id} is blocked (malicious or user-blocked)`,
        programId: id,
        status: 'blocked',
      };
    }

    // System programs are safe by default
    if (this.allowSystemPrograms && this.systemPrograms.has(idLower)) {
      return {
        allowed: true,
        programId: id,
        status: 'system_safe',
      };
    }

    // If allowlist mode is on, check against it
    if (this.allowlist !== null) {
      if (this.allowlist.has(idLower)) {
        return {
          allowed: true,
          programId: id,
          status: 'allowed',
        };
      }
      return {
        allowed: false,
        reason: `Program ${id} is not in allowlist`,
        programId: id,
        status: 'not_in_allowlist',
      };
    }

    // No allowlist mode = allow all (except blocked)
    return {
      allowed: true,
      programId: id,
      status: 'allowed',
    };
  }

  /**
   * Check multiple programs at once
   */
  checkAll(programIds: (string | PublicKey)[]): ProgramCheckResult[] {
    return programIds.map(id => this.check(id));
  }

  /**
   * Add a program to the blocklist at runtime
   */
  addToBlocklist(programId: string): void {
    this.blocklist.add(programId.toLowerCase());
  }

  /**
   * Add a program to the allowlist at runtime (if in allowlist mode)
   */
  addToAllowlist(programId: string): boolean {
    if (this.allowlist === null) {
      return false; // Not in allowlist mode
    }
    this.allowlist.add(programId.toLowerCase());
    return true;
  }

  /**
   * Get current allowlist/blocklist status
   */
  getStatus(): {
    mode: 'allowlist' | 'blocklist_only';
    allowlistSize: number | null;
    blocklistSize: number;
  } {
    return {
      mode: this.allowlist !== null ? 'allowlist' : 'blocklist_only',
      allowlistSize: this.allowlist?.size ?? null,
      blocklistSize: this.blocklist.size,
    };
  }
}

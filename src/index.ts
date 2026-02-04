/**
 * AgentGuard - Security middleware for Solana agents
 * 
 * Wraps Solana Agent Kit with safety rails:
 * - Transaction firewall (spending limits, allowlists)
 * - Prompt injection defense
 * - Secret isolation
 * - Audit trail (local + on-chain)
 */

// Main guard class
export { AgentGuard, AgentGuardConfig, GuardResult } from './guard';

// Individual components
export { TransactionFirewall, FirewallConfig, FirewallResult } from './firewall';
export { PromptSanitizer, SanitizerConfig, SanitizeResult } from './sanitizer';
export { SecretIsolator, IsolatorConfig, RedactResult } from './isolator';
export { AuditLogger, AuditConfig, AuditEntry } from './audit';

// On-chain audit trail
export { 
  OnchainAuditLogger, 
  SecurityEventType,
  PROGRAM_ID as AUDIT_PROGRAM_ID,
} from './audit/onchain';
export type { 
  OnchainSecurityEvent, 
  OnchainAuditAuthority, 
  LogEventParams 
} from './audit/onchain';

// Solana Agent Kit wrapper
export { 
  createGuardedAgent, 
  wrapWithGuard, 
  GuardedSolanaAgent,
  GuardedAgentConfig,
  GuardedAction 
} from './wrapper';

// Default export
export { AgentGuard as default } from './guard';

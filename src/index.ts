/**
 * AgentGuard - Security middleware for Solana agents
 * 
 * Wraps Solana Agent Kit with safety rails:
 * - Transaction firewall (spending limits, allowlists)
 * - Prompt injection defense
 * - Secret isolation
 * - Audit trail
 */

// Main guard class
export { AgentGuard, AgentGuardConfig, GuardResult } from './guard';

// Individual components
export { TransactionFirewall, FirewallConfig, FirewallResult } from './firewall';
export { PromptSanitizer, SanitizerConfig, SanitizeResult } from './sanitizer';
export { SecretIsolator, IsolatorConfig, RedactResult } from './isolator';
export { AuditLogger, AuditConfig, AuditEntry } from './audit';

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

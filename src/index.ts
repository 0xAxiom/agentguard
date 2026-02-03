/**
 * AgentGuard - Security middleware for Solana agents
 * 
 * Wraps Solana Agent Kit with safety rails:
 * - Transaction firewall (spending limits, allowlists)
 * - Prompt injection defense
 * - Secret isolation
 * - Audit trail
 */

// Core firewall module
export { 
  TransactionFirewall,
  SpendingLimits,
  ProgramAllowlist,
  TransactionSimulator,
  SAFE_SYSTEM_PROGRAMS,
  KNOWN_MALICIOUS_PROGRAMS,
} from './firewall';

export type {
  FirewallConfig,
  FirewallResult,
  FirewallStatus,
  SpendingLimitConfig,
  AllowlistConfig,
  ProgramCheckResult,
  SimulatorConfig,
  SimulationResult,
  BalanceChange,
} from './firewall';

// TODO: Additional modules to be implemented
// export { AgentGuard } from './guard';
// export { PromptSanitizer } from './sanitizer';
// export { SecretIsolator } from './isolator';
// export { AuditLogger } from './audit';

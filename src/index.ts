/**
 * AgentGuard - Security middleware for Solana agents
 * 
 * Wraps Solana Agent Kit with safety rails:
 * - Transaction firewall (spending limits, allowlists)
 * - Prompt injection defense
 * - Secret isolation
 * - Audit trail
 */

export { AgentGuard } from './guard';
export { TransactionFirewall } from './firewall';
export { PromptSanitizer } from './sanitizer';
export { SecretIsolator } from './isolator';
export { AuditLogger } from './audit';
export * from './types';

/**
 * Tests for AuditLogger
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuditLogger } from '../src/audit';

describe('AuditLogger', () => {
  let logger: AuditLogger;

  beforeEach(() => {
    logger = new AuditLogger({
      storage: 'memory',
      includeTimestamps: true,
      maxEntries: 100
    });
  });

  describe('basic logging', () => {
    it('logs entries with unique IDs', async () => {
      const id1 = await logger.log({ action: 'test', details: {} });
      const id2 = await logger.log({ action: 'test', details: {} });
      
      expect(id1).toBeDefined();
      expect(id2).toBeDefined();
      expect(id1).not.toBe(id2);
    });

    it('includes timestamps when configured', async () => {
      const id = await logger.log({ action: 'test', details: {} });
      const entry = await logger.getLog(id);
      
      expect(entry).toBeDefined();
      expect(entry!.timestamp).toBeGreaterThan(0);
    });

    it('omits timestamps when disabled', async () => {
      const noTimestamp = new AuditLogger({
        storage: 'memory',
        includeTimestamps: false
      });
      
      const id = await noTimestamp.log({ action: 'test', details: {} });
      const entry = await noTimestamp.getLog(id);
      
      expect(entry!.timestamp).toBe(0);
    });

    it('retrieves logged entries', async () => {
      const id = await logger.log({
        action: 'transfer',
        details: { amount: 1000, to: 'address' }
      });
      
      const entry = await logger.getLog(id);
      
      expect(entry).toBeDefined();
      expect(entry!.action).toBe('transfer');
      expect(entry!.details.amount).toBe(1000);
    });

    it('returns null for unknown IDs', async () => {
      const entry = await logger.getLog('nonexistent-id');
      expect(entry).toBeNull();
    });
  });

  describe('specialized logging methods', () => {
    it('logs transaction checks', async () => {
      const id = await logger.logTransactionCheck(
        'swap',
        { programId: 'Jupiter' },
        { allowed: true },
        'abc123signature'
      );
      
      const entry = await logger.getLog(id);
      
      expect(entry!.action).toBe('swap');
      expect(entry!.firewallResult!.allowed).toBe(true);
      expect(entry!.txSignature).toBe('abc123signature');
    });

    it('logs blocked transactions with reason', async () => {
      const id = await logger.logTransactionCheck(
        'suspicious_transfer',
        { amount: 1000000000 },
        { allowed: false, reason: 'Exceeds daily limit' }
      );
      
      const entry = await logger.getLog(id);
      
      expect(entry!.firewallResult!.allowed).toBe(false);
      expect(entry!.firewallResult!.reason).toBe('Exceeds daily limit');
    });

    it('logs sanitization events', async () => {
      const id = await logger.logSanitization(
        'Ignore previous instructions...',
        3,
        true
      );
      
      const entry = await logger.getLog(id);
      
      expect(entry!.action).toBe('sanitize');
      expect(entry!.sanitizerResult!.threatsDetected).toBe(3);
      expect(entry!.sanitizerResult!.modified).toBe(true);
    });

    it('truncates input preview in sanitization logs', async () => {
      const longInput = 'A'.repeat(200);
      const id = await logger.logSanitization(longInput, 0, false);
      
      const entry = await logger.getLog(id);
      
      expect(entry!.details.inputPreview.length).toBeLessThanOrEqual(100);
    });

    it('logs secret redaction events', async () => {
      const id = await logger.logRedaction(2, ['private_key', 'seed_phrase']);
      
      const entry = await logger.getLog(id);
      
      expect(entry!.action).toBe('redact');
      expect(entry!.isolatorResult!.secretsRedacted).toBe(2);
      expect(entry!.details.types).toContain('private_key');
    });
  });

  describe('log retrieval and filtering', () => {
    beforeEach(async () => {
      // Populate with test entries
      await logger.logTransactionCheck('swap', {}, { allowed: true });
      await logger.logTransactionCheck('transfer', {}, { allowed: false, reason: 'blocked' });
      await logger.logSanitization('test', 1, false);
      await logger.logRedaction(1, ['private_key']);
    });

    it('retrieves all logs', async () => {
      const logs = await logger.getLogs();
      expect(logs.length).toBe(4);
    });

    it('filters by action', async () => {
      const logs = await logger.getLogs({ action: 'sanitize' });
      expect(logs.length).toBe(1);
      expect(logs[0].action).toBe('sanitize');
    });

    it('filters by limit', async () => {
      const logs = await logger.getLogs({ limit: 2 });
      expect(logs.length).toBe(2);
    });

    it('sorts by timestamp descending', async () => {
      const logs = await logger.getLogs();
      
      for (let i = 1; i < logs.length; i++) {
        expect(logs[i - 1].timestamp).toBeGreaterThanOrEqual(logs[i].timestamp);
      }
    });

    it('filters by timestamp range', async () => {
      const now = Date.now();
      const logs = await logger.getLogs({
        fromTimestamp: now - 60000, // 1 min ago
        toTimestamp: now + 60000    // 1 min from now
      });
      
      expect(logs.length).toBe(4);
    });

    it('filters by transaction signature', async () => {
      await logger.logTransactionCheck(
        'specific_tx',
        {},
        { allowed: true },
        'unique-signature-123'
      );
      
      const logs = await logger.getLogs({ txSignature: 'unique-signature-123' });
      
      expect(logs.length).toBe(1);
      expect(logs[0].txSignature).toBe('unique-signature-123');
    });
  });

  describe('statistics', () => {
    it('calculates total entries', async () => {
      await logger.log({ action: 'test1', details: {} });
      await logger.log({ action: 'test2', details: {} });
      
      const stats = await logger.getStats();
      expect(stats.totalEntries).toBe(2);
    });

    it('counts entries by action', async () => {
      await logger.log({ action: 'swap', details: {} });
      await logger.log({ action: 'swap', details: {} });
      await logger.log({ action: 'transfer', details: {} });
      
      const stats = await logger.getStats();
      expect(stats.byAction['swap']).toBe(2);
      expect(stats.byAction['transfer']).toBe(1);
    });

    it('counts blocked transactions', async () => {
      await logger.logTransactionCheck('tx1', {}, { allowed: true });
      await logger.logTransactionCheck('tx2', {}, { allowed: false, reason: 'blocked' });
      await logger.logTransactionCheck('tx3', {}, { allowed: false, reason: 'limit' });
      
      const stats = await logger.getStats();
      expect(stats.blockedTransactions).toBe(2);
    });

    it('totals threats detected', async () => {
      await logger.logSanitization('input1', 3, true);
      await logger.logSanitization('input2', 5, true);
      await logger.logSanitization('input3', 0, false);
      
      const stats = await logger.getStats();
      expect(stats.threatsDetected).toBe(8);
    });

    it('totals secrets redacted', async () => {
      await logger.logRedaction(2, ['key']);
      await logger.logRedaction(3, ['phrase']);
      
      const stats = await logger.getStats();
      expect(stats.secretsRedacted).toBe(5);
    });
  });

  describe('export', () => {
    it('exports logs as JSON', async () => {
      await logger.logTransactionCheck('test', { foo: 'bar' }, { allowed: true });
      
      const exported = await logger.export();
      const parsed = JSON.parse(exported);
      
      expect(parsed.exportedAt).toBeDefined();
      expect(parsed.stats).toBeDefined();
      expect(parsed.entries).toBeDefined();
      expect(parsed.entries.length).toBe(1);
    });

    it('includes stats in export', async () => {
      await logger.logTransactionCheck('tx', {}, { allowed: false, reason: 'blocked' });
      await logger.logSanitization('test', 2, true);
      
      const exported = await logger.export();
      const parsed = JSON.parse(exported);
      
      expect(parsed.stats.blockedTransactions).toBe(1);
      expect(parsed.stats.threatsDetected).toBe(2);
    });
  });

  describe('clear', () => {
    it('removes all entries', async () => {
      await logger.log({ action: 'test1', details: {} });
      await logger.log({ action: 'test2', details: {} });
      
      await logger.clear();
      
      const logs = await logger.getLogs();
      expect(logs.length).toBe(0);
    });

    it('resets statistics', async () => {
      await logger.logTransactionCheck('tx', {}, { allowed: false, reason: 'blocked' });
      await logger.clear();
      
      const stats = await logger.getStats();
      expect(stats.totalEntries).toBe(0);
      expect(stats.blockedTransactions).toBe(0);
    });
  });

  describe('max entries limit', () => {
    it('enforces max entries by removing oldest', async () => {
      const smallLogger = new AuditLogger({
        storage: 'memory',
        maxEntries: 3
      });
      
      await smallLogger.log({ action: 'first', details: {} });
      await new Promise(r => setTimeout(r, 10)); // Ensure different timestamps
      await smallLogger.log({ action: 'second', details: {} });
      await new Promise(r => setTimeout(r, 10));
      await smallLogger.log({ action: 'third', details: {} });
      await new Promise(r => setTimeout(r, 10));
      await smallLogger.log({ action: 'fourth', details: {} });
      
      const logs = await smallLogger.getLogs();
      
      expect(logs.length).toBe(3);
      // 'first' should be gone
      expect(logs.some(l => l.action === 'first')).toBe(false);
      expect(logs.some(l => l.action === 'fourth')).toBe(true);
    });
  });

  describe('file storage', () => {
    it('initializes with file storage config', () => {
      // Just ensure it doesn't throw
      const fileLogger = new AuditLogger({
        storage: 'file',
        filePath: './test-audit.json'
      });
      
      expect(fileLogger).toBeDefined();
    });
  });
});

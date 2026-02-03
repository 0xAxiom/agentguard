/**
 * Tests for SecretIsolator
 */

import { describe, it, expect } from 'vitest';
import { SecretIsolator } from '../src/isolator';

describe('SecretIsolator', () => {
  describe('private key detection', () => {
    it('detects Solana private key format (88 chars Base58)', () => {
      const isolator = new SecretIsolator();
      // Example private key pattern - 88 Base58 chars starting with valid char
      const fakePrivateKey = '5' + 'K'.repeat(86) + '1'; // 88 Base58 chars
      
      const result = isolator.redact(`My key is ${fakePrivateKey}`);
      
      expect(result.redacted).toBe(true);
      expect(result.matches.some(m => m.type === 'private_key')).toBe(true);
      expect(result.clean).not.toContain(fakePrivateKey);
      expect(result.clean).toContain('[REDACTED]');
    });

    it('detects hex private keys (64 chars)', () => {
      const isolator = new SecretIsolator();
      const hexKey = 'a'.repeat(64);
      
      const result = isolator.redact(`Hex key: ${hexKey}`);
      
      expect(result.redacted).toBe(true);
      expect(result.matches.some(m => m.type === 'hex_key')).toBe(true);
    });

    it('allows public keys by default (44 chars)', () => {
      const isolator = new SecretIsolator({ allowPublicKeys: true });
      // Typical Solana public key length (44 chars)
      const publicKey = 'So11111111111111111111111111111111111111112';
      
      const result = isolator.redact(`Send to ${publicKey}`);
      
      // Should NOT redact public keys when allowPublicKeys is true
      expect(result.redacted).toBe(false);
      expect(result.clean).toContain(publicKey);
    });
  });

  describe('environment variable leaks', () => {
    it('detects PRIVATE_KEY assignments', () => {
      const isolator = new SecretIsolator();
      
      const result = isolator.redact('PRIVATE_KEY=abc123secret');
      
      expect(result.redacted).toBe(true);
      expect(result.matches.some(m => m.type === 'env_var')).toBe(true);
      expect(result.clean).not.toContain('abc123secret');
    });

    it('detects SECRET_KEY assignments', () => {
      const isolator = new SecretIsolator();
      
      const result = isolator.redact('export SECRET_KEY="mysupersecret"');
      
      expect(result.redacted).toBe(true);
      expect(result.matches.some(m => m.type === 'env_var')).toBe(true);
    });

    it('detects API_KEY assignments', () => {
      const isolator = new SecretIsolator();
      
      const result = isolator.redact('API_KEY: sk-proj-abc123');
      
      expect(result.redacted).toBe(true);
    });

    it('detects AUTH_TOKEN assignments', () => {
      const isolator = new SecretIsolator();
      
      const result = isolator.redact("AUTH_TOKEN = 'ghp_xxxxxxxxxxxx'");
      
      expect(result.redacted).toBe(true);
    });

    it('detects PASSWORD assignments', () => {
      const isolator = new SecretIsolator();
      
      const result = isolator.redact('PASSWORD=hunter2');
      
      expect(result.redacted).toBe(true);
    });
  });

  describe('custom placeholder', () => {
    it('uses custom placeholder text', () => {
      const isolator = new SecretIsolator({ placeholder: '***HIDDEN***' });
      const hexKey = 'a'.repeat(64);
      
      const result = isolator.redact(`Key: ${hexKey}`);
      
      expect(result.clean).toContain('***HIDDEN***');
      expect(result.clean).not.toContain('[REDACTED]');
    });
  });

  describe('containsSecrets utility', () => {
    it('returns true for text with secrets', () => {
      const isolator = new SecretIsolator();
      const hexKey = 'f'.repeat(64);
      
      expect(isolator.containsSecrets(`Key: ${hexKey}`)).toBe(true);
    });

    it('returns false for clean text', () => {
      const isolator = new SecretIsolator();
      
      expect(isolator.containsSecrets('Hello, this is safe text!')).toBe(false);
    });
  });

  describe('wrapOutput utility', () => {
    it('redacts string outputs', () => {
      const isolator = new SecretIsolator();
      const hexKey = 'b'.repeat(64);
      
      const result = isolator.wrapOutput(() => `Secret: ${hexKey}`);
      
      expect(result).not.toContain(hexKey);
      expect(result).toContain('[REDACTED]');
    });

    it('redacts object outputs via JSON', () => {
      const isolator = new SecretIsolator();
      const hexKey = 'c'.repeat(64);
      
      const result = isolator.wrapOutput(() => ({ key: hexKey, name: 'test' }));
      
      expect(result.key).toBe('[REDACTED]');
      expect(result.name).toBe('test');
    });

    it('passes through non-string/object outputs', () => {
      const isolator = new SecretIsolator();
      
      expect(isolator.wrapOutput(() => 42)).toBe(42);
      expect(isolator.wrapOutput(() => true)).toBe(true);
      expect(isolator.wrapOutput(() => null)).toBe(null);
    });
  });

  describe('match previews', () => {
    it('provides preview of redacted secrets', () => {
      const isolator = new SecretIsolator();
      const hexKey = 'abcd' + 'e'.repeat(56) + '1234';
      
      const result = isolator.redact(`Key: ${hexKey}`);
      
      const match = result.matches.find(m => m.type === 'hex_key');
      expect(match).toBeDefined();
      expect(match!.preview).toBe('abcd...1234');
    });
  });

  describe('multiple secrets', () => {
    it('redacts all secrets in text', () => {
      const isolator = new SecretIsolator();
      const key1 = 'd'.repeat(64);
      const key2 = 'e'.repeat(64);
      
      const result = isolator.redact(`First: ${key1}, Second: ${key2}`);
      
      expect(result.matches.length).toBe(2);
      expect(result.clean).not.toContain(key1);
      expect(result.clean).not.toContain(key2);
    });
  });

  describe('edge cases', () => {
    it('handles empty strings', () => {
      const isolator = new SecretIsolator();
      
      const result = isolator.redact('');
      
      expect(result.redacted).toBe(false);
      expect(result.clean).toBe('');
      expect(result.matches.length).toBe(0);
    });

    it('handles text with no secrets', () => {
      const isolator = new SecretIsolator();
      const safeText = 'This is a completely safe message about NFTs!';
      
      const result = isolator.redact(safeText);
      
      expect(result.redacted).toBe(false);
      expect(result.clean).toBe(safeText);
    });

    it('handles mixed content', () => {
      const isolator = new SecretIsolator();
      const hexKey = 'f'.repeat(64);
      
      const result = isolator.redact(`
        Hello! Here's some info:
        - Name: Alice
        - Secret key: ${hexKey}
        - Balance: 100 SOL
      `);
      
      expect(result.redacted).toBe(true);
      expect(result.clean).toContain('Alice');
      expect(result.clean).toContain('100 SOL');
      expect(result.clean).not.toContain(hexKey);
    });
  });
});

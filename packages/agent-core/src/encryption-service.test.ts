import { describe, it, expect } from 'vitest';
import { EncryptionService, EncryptionError } from './encryption-service.js';

// 32-byte hex key for AES-256
const TEST_KEY = 'a'.repeat(64);

describe('EncryptionService', () => {
  const svc = new EncryptionService(TEST_KEY);

  describe('encrypt()', () => {
    it('returns a non-empty string', () => {
      const result = svc.encrypt('my-github-pat');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('does not return the plaintext', () => {
      const result = svc.encrypt('my-github-pat');
      expect(result).not.toContain('my-github-pat');
    });

    it('produces different ciphertext on each call (random IV)', () => {
      const a = svc.encrypt('same-value');
      const b = svc.encrypt('same-value');
      expect(a).not.toBe(b);
    });
  });

  describe('decrypt()', () => {
    it('recovers the original plaintext', () => {
      const plaintext = 'ghp_mySecretToken123';
      const encrypted = svc.encrypt(plaintext);
      expect(svc.decrypt(encrypted)).toBe(plaintext);
    });

    it('handles long tokens', () => {
      const token = 'github_pat_' + 'x'.repeat(200);
      expect(svc.decrypt(svc.encrypt(token))).toBe(token);
    });

    it('throws EncryptionError when ciphertext is tampered', () => {
      const encrypted = svc.encrypt('secret');
      const tampered = encrypted.slice(0, -4) + 'XXXX';
      expect(() => svc.decrypt(tampered)).toThrow(EncryptionError);
    });

    it('throws EncryptionError when ciphertext is garbage', () => {
      expect(() => svc.decrypt('not-valid-ciphertext')).toThrow(EncryptionError);
    });
  });

  describe('constructor validation', () => {
    it('throws when key is not 64 hex characters', () => {
      expect(() => new EncryptionService('tooshort')).toThrow(EncryptionError);
    });

    it('throws when key contains non-hex characters', () => {
      expect(() => new EncryptionService('z'.repeat(64))).toThrow(EncryptionError);
    });

    it('accepts a valid 64-char hex key', () => {
      expect(() => new EncryptionService(TEST_KEY)).not.toThrow();
    });
  });
});

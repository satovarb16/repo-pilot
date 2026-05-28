import { describe, it, expect } from 'vitest';
import { SecretRedactor } from './secret-redactor.js';

describe('SecretRedactor', () => {
  const redactor = new SecretRedactor();

  describe('redact()', () => {
    it('returns clean text unchanged', () => {
      const input = 'Hello, this is safe text with no secrets.';
      expect(redactor.redact(input)).toBe(input);
    });

    it('redacts .env-style KEY=VALUE assignments', () => {
      const input = 'DATABASE_URL=postgresql://user:password@localhost/db';
      expect(redactor.redact(input)).toBe('DATABASE_URL=[REDACTED]');
    });

    it('redacts GitHub personal access tokens (ghp_)', () => {
      const input = 'token: ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ123456';
      expect(redactor.redact(input)).toContain('[REDACTED]');
      expect(redactor.redact(input)).not.toContain('ghp_');
    });

    it('redacts GitHub fine-grained tokens (github_pat_)', () => {
      const input = 'Authorization: github_pat_11AAABBB_someRandomLongToken';
      expect(redactor.redact(input)).toContain('[REDACTED]');
      expect(redactor.redact(input)).not.toContain('github_pat_');
    });

    it('redacts Bearer tokens in Authorization headers', () => {
      const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig';
      expect(redactor.redact(input)).toContain('[REDACTED]');
      expect(redactor.redact(input)).not.toContain('eyJhbGci');
    });

    it('redacts PEM private key blocks', () => {
      const input = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----';
      expect(redactor.redact(input)).toContain('[REDACTED]');
      expect(redactor.redact(input)).not.toContain('MIIEowIBAAKCAQEA');
    });

    it('redacts generic private key blocks', () => {
      const input = '-----BEGIN PRIVATE KEY-----\nMIIEvAIBADANBgkqhkiG9w\n-----END PRIVATE KEY-----';
      expect(redactor.redact(input)).toContain('[REDACTED]');
    });

    it('redacts multiple secrets in a single string', () => {
      const input = [
        'API_KEY=sk-ant-1234567890abcdef',
        'Authorization: Bearer my-secret-token',
      ].join('\n');
      const result = redactor.redact(input);
      expect(result).not.toContain('sk-ant-1234567890abcdef');
      expect(result).not.toContain('my-secret-token');
    });

    it('does not redact normal key=value pairs with short values', () => {
      const input = 'NODE_ENV=production';
      expect(redactor.redact(input)).toBe('NODE_ENV=production');
    });

    it('redacts Anthropic API keys (sk-ant-)', () => {
      const input = 'key=sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789';
      expect(redactor.redact(input)).toContain('[REDACTED]');
      expect(redactor.redact(input)).not.toContain('sk-ant-');
    });

    it('redacts AWS access key IDs (AKIA...)', () => {
      const input = 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE';
      expect(redactor.redact(input)).toContain('[REDACTED]');
      expect(redactor.redact(input)).not.toContain('AKIAIOSFODNN7EXAMPLE');
    });

    it('redacts AWS secret access keys', () => {
      const input = 'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
      expect(redactor.redact(input)).toContain('[REDACTED]');
      expect(redactor.redact(input)).not.toContain('wJalrXUtnFEMI');
    });

    it('redacts Azure connection strings', () => {
      const input = 'DefaultEndpointsProtocol=https;AccountName=myaccount;AccountKey=abc123XYZ==;EndpointSuffix=core.windows.net';
      expect(redactor.redact(input)).toContain('[REDACTED]');
      expect(redactor.redact(input)).not.toContain('abc123XYZ==');
    });

    it('redacts Azure SAS tokens (sig= parameter)', () => {
      const input = 'https://myaccount.blob.core.windows.net/container?sv=2020-08-04&sig=abcDEF123456%2Bxyz%3D&se=2024-01-01';
      expect(redactor.redact(input)).toContain('[REDACTED]');
      expect(redactor.redact(input)).not.toContain('abcDEF123456');
    });
  });
});

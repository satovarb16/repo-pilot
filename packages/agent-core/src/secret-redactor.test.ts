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

    // Phase 5 T02 — 6 new patterns (positive cases)

    it('redacts Stripe live secret keys (sk_live_)', () => {
      const input = 'STRIPE_SECRET=sk_live_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef';
      expect(redactor.redact(input)).toContain('[REDACTED]');
      expect(redactor.redact(input)).not.toContain('sk_live_');
    });

    it('redacts JWT tokens (eyJ.eyJ. 3-part shape)', () => {
      const input = 'token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyMSJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
      expect(redactor.redact(input)).toContain('[REDACTED]');
      expect(redactor.redact(input)).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    });

    it('redacts npm auth tokens (npm_)', () => {
      const input = '//registry.npmjs.org/:_authToken=npm_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij';
      expect(redactor.redact(input)).toContain('[REDACTED]');
      expect(redactor.redact(input)).not.toContain('npm_ABC');
    });

    it('redacts SendGrid API keys (SG.)', () => {
      const input = 'SENDGRID_KEY=SG.ABCDEFGHIJKLMNOPQRSTUVwx.ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq';
      expect(redactor.redact(input)).toContain('[REDACTED]');
      expect(redactor.redact(input)).not.toContain('SG.');
    });

    it('redacts Twilio auth tokens (SK prefix + 32 hex)', () => {
      const input = 'TWILIO_AUTH=SK0123456789abcdef0123456789abcdef';
      expect(redactor.redact(input)).toContain('[REDACTED]');
      expect(redactor.redact(input)).not.toContain('SK0123456789abcdef');
    });

    it('redacts Twilio SID tokens (AC prefix + 32 hex)', () => {
      const input = 'TWILIO_SID=AC0123456789abcdef0123456789abcdef';
      expect(redactor.redact(input)).toContain('[REDACTED]');
      expect(redactor.redact(input)).not.toContain('AC0123456789abcdef');
    });

    it('redacts GCP SA JSON private_key field', () => {
      const input = '{"private_key": "-----BEGIN RSA PRIVATE KEY-----\\nMIIEowIBAAKCAQEA\\n-----END RSA PRIVATE KEY-----\\n"}';
      const result = redactor.redact(input);
      expect(result).toContain('[REDACTED]');
      expect(result).not.toContain('MIIEowIBAAKCAQEA');
    });

    // Phase 5 T02 — 6 new patterns (negative cases — must NOT over-redact)

    it('does NOT redact a short Stripe-looking string below minimum length', () => {
      // sk_live_ requires at least 20 more chars
      const input = 'sk_live_short';
      expect(redactor.redact(input)).toBe(input);
    });

    it('does NOT redact single-part base64 that is not a JWT (no dots)', () => {
      const input = 'eyJhbGciOiJIUzI1NiJ9'; // just one segment, no dots
      expect(redactor.redact(input)).toBe(input);
    });

    it('does NOT redact npm_ token that is too short (needs 36 alphanum chars)', () => {
      const input = 'npm_TOOSHORT';
      expect(redactor.redact(input)).toBe(input);
    });

    it('does NOT redact a SendGrid-like key with wrong segment lengths', () => {
      // Correct is 22 + 43; this has wrong lengths
      const input = 'SG.TOOSHORT.TOOSHORT';
      expect(redactor.redact(input)).toBe(input);
    });

    it('does NOT redact a Twilio-like prefix with wrong hex length (< 32)', () => {
      const input = 'SK0123456789abcdef'; // only 16 hex chars, needs 32
      expect(redactor.redact(input)).toBe(input);
    });

    it('does NOT redact a JSON key named private_key with an empty value', () => {
      // Empty string between quotes — should stay unchanged
      const input = '{"private_key": ""}';
      expect(redactor.redact(input)).toBe(input);
    });
  });
});

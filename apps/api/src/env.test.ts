import { describe, it, expect } from 'vitest';
import { envSchema, parseEnv } from './env.js';

describe('envSchema', () => {
  it('parses valid env vars', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: 'postgresql://localhost/test',
      ANTHROPIC_API_KEY: 'sk-ant-test',
      TOKEN_ENCRYPTION_KEY: 'test-key',
    });
    expect(result.success).toBe(true);
  });

  it('applies default PORT of 3001', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: 'postgresql://localhost/test',
      ANTHROPIC_API_KEY: 'sk-ant-test',
      TOKEN_ENCRYPTION_KEY: 'test-key',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.PORT).toBe(3001);
    }
  });

  it('applies default REPO_ROOT', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: 'postgresql://localhost/test',
      ANTHROPIC_API_KEY: 'sk-ant-test',
      TOKEN_ENCRYPTION_KEY: 'test-key',
    });
    if (result.success) {
      expect(result.data.REPO_ROOT).toBe('/tmp/repo-pilot/clones');
    }
  });

  it('rejects when DATABASE_URL is missing', () => {
    const result = envSchema.safeParse({
      ANTHROPIC_API_KEY: 'sk-ant-test',
      TOKEN_ENCRYPTION_KEY: 'test-key',
    });
    expect(result.success).toBe(false);
  });

  it('rejects when DATABASE_URL is empty string', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: '',
      ANTHROPIC_API_KEY: 'sk-ant-test',
      TOKEN_ENCRYPTION_KEY: 'test-key',
    });
    expect(result.success).toBe(false);
  });

  it('rejects when ANTHROPIC_API_KEY is missing', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: 'postgresql://localhost/test',
      TOKEN_ENCRYPTION_KEY: 'test-key',
    });
    expect(result.success).toBe(false);
  });

  it('rejects when TOKEN_ENCRYPTION_KEY is missing', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: 'postgresql://localhost/test',
      ANTHROPIC_API_KEY: 'sk-ant-test',
    });
    expect(result.success).toBe(false);
  });
});

describe('parseEnv', () => {
  it('returns typed env when all required vars are present', () => {
    const result = parseEnv({
      DATABASE_URL: 'postgresql://localhost/test',
      ANTHROPIC_API_KEY: 'sk-ant-test',
      TOKEN_ENCRYPTION_KEY: 'test-key',
    });
    expect(result.DATABASE_URL).toBe('postgresql://localhost/test');
    expect(result.PORT).toBe(3001);
  });

  it('throws ZodError when required vars are missing', () => {
    expect(() => parseEnv({})).toThrow();
  });
});

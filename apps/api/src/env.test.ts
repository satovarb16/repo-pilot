import { describe, it, expect } from 'vitest';
import { envSchema, parseEnv } from './env.js';

// Base fixture without any provider-specific keys
const BASE_ENV = {
  DATABASE_URL: 'postgresql://localhost/test',
  TOKEN_ENCRYPTION_KEY: 'test-key',
  MCP_SERVER_PATH: '/some/path/index.js',
};

describe('envSchema', () => {
  it('parses valid env vars', () => {
    const result = envSchema.safeParse(BASE_ENV);
    expect(result.success).toBe(true);
  });

  it('applies default PORT of 3001', () => {
    const result = envSchema.safeParse(BASE_ENV);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.PORT).toBe(3001);
    }
  });

  it('applies default REPO_ROOT', () => {
    const result = envSchema.safeParse(BASE_ENV);
    if (result.success) {
      expect(result.data.REPO_ROOT).toBe('/tmp/repo-pilot/clones');
    }
  });

  it('rejects when DATABASE_URL is missing', () => {
    const result = envSchema.safeParse({
      TOKEN_ENCRYPTION_KEY: 'test-key',
      MCP_SERVER_PATH: '/some/path/index.js',
    });
    expect(result.success).toBe(false);
  });

  it('rejects when DATABASE_URL is empty string', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: '',
      TOKEN_ENCRYPTION_KEY: 'test-key',
      MCP_SERVER_PATH: '/some/path/index.js',
    });
    expect(result.success).toBe(false);
  });

  it('rejects when TOKEN_ENCRYPTION_KEY is missing', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: 'postgresql://localhost/test',
      MCP_SERVER_PATH: '/some/path/index.js',
    });
    expect(result.success).toBe(false);
  });

  it('rejects when MCP_SERVER_PATH is missing', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: 'postgresql://localhost/test',
      TOKEN_ENCRYPTION_KEY: 'test-key',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a valid MCP_SERVER_PATH', () => {
    const result = envSchema.safeParse(BASE_ENV);
    expect(result.success).toBe(true);
  });

  // S-08: Ollama env defaults applied when vars are absent
  it('S-08: applies default OLLAMA_BASE_URL when not set', () => {
    const result = envSchema.safeParse(BASE_ENV);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.OLLAMA_BASE_URL).toBe('http://localhost:11434');
    }
  });

  it('S-08: applies default OLLAMA_MODEL when not set', () => {
    const result = envSchema.safeParse(BASE_ENV);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.OLLAMA_MODEL).toBe('qwen2.5-coder:7b');
    }
  });

  it('S-08: accepts custom OLLAMA_BASE_URL', () => {
    const result = envSchema.safeParse({
      ...BASE_ENV,
      OLLAMA_BASE_URL: 'http://192.168.1.10:11434',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.OLLAMA_BASE_URL).toBe('http://192.168.1.10:11434');
    }
  });

  it('S-08: accepts custom OLLAMA_MODEL', () => {
    const result = envSchema.safeParse({
      ...BASE_ENV,
      OLLAMA_MODEL: 'llama3:8b',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.OLLAMA_MODEL).toBe('llama3:8b');
    }
  });

  // S-09: ANTHROPIC_API_KEY is no longer required — server starts without it
  it('S-09: does not throw when ANTHROPIC_API_KEY is absent', () => {
    const result = envSchema.safeParse(BASE_ENV);
    expect(result.success).toBe(true);
  });

  it('S-09: parsed env has no ANTHROPIC_API_KEY field', () => {
    const result = envSchema.safeParse(BASE_ENV);
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>)['ANTHROPIC_API_KEY']).toBeUndefined();
    }
  });
});

describe('parseEnv', () => {
  it('returns typed env when all required vars are present', () => {
    const result = parseEnv({
      DATABASE_URL: 'postgresql://localhost/test',
      TOKEN_ENCRYPTION_KEY: 'test-key',
      MCP_SERVER_PATH: '/some/path/index.js',
    });
    expect(result.DATABASE_URL).toBe('postgresql://localhost/test');
    expect(result.PORT).toBe(3001);
    expect(result.OLLAMA_BASE_URL).toBe('http://localhost:11434');
    expect(result.OLLAMA_MODEL).toBe('qwen2.5-coder:7b');
  });

  it('throws ZodError when required vars are missing', () => {
    expect(() => parseEnv({})).toThrow();
  });
});

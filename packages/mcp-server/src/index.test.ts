import { describe, it, expect } from 'vitest';
import { isBlocklisted } from './blocklist.js';

// index.ts starts the MCP server on import so it cannot be imported in tests.
// Smoke-test the building blocks that index.ts depends on instead.
describe('mcp-server smoke tests', () => {
  it('blocklist is accessible', () => {
    expect(typeof isBlocklisted).toBe('function');
  });
});

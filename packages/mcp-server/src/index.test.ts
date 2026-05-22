import { describe, it, expect } from 'vitest';
import * as mcpServer from './index.js';

describe('mcp-server', () => {
  it('exports a module without throwing', () => {
    expect(mcpServer).toBeDefined();
  });
});

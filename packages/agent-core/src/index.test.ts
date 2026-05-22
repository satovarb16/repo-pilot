import { describe, it, expect } from 'vitest';
import * as agentCore from './index.js';

describe('agent-core', () => {
  it('exports a module without throwing', () => {
    expect(agentCore).toBeDefined();
  });
});

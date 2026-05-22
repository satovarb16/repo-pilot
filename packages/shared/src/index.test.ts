import { describe, it, expect } from 'vitest';
import * as shared from './index.js';

describe('shared', () => {
  it('exports a module without throwing', () => {
    expect(shared).toBeDefined();
  });
});

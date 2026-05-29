import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestRepo, type TestRepo } from './helpers/fixture.js';
import { readFile } from '../src/tools/read-file.js';

describe('readFile', () => {
  let repo: TestRepo;

  beforeAll(() => { repo = createTestRepo(); });
  afterAll(() => repo.cleanup());

  it('reads a source file', () => {
    const result = readFile(repo.root, 'src/index.ts');
    expect(result).toContain('export function hello');
  });

  it('throws for a blocklisted .env file', () => {
    expect(() => readFile(repo.root, '.env')).toThrow('not permitted');
  });

  it('throws for a blocklisted private key file', () => {
    expect(() => readFile(repo.root, 'id_rsa')).toThrow('not permitted');
  });

  it('throws for a path traversal attempt', () => {
    expect(() => readFile(repo.root, '../../etc/passwd')).toThrow();
  });

  it('throws for a file that does not exist', () => {
    expect(() => readFile(repo.root, 'nonexistent.ts')).toThrow();
  });
});

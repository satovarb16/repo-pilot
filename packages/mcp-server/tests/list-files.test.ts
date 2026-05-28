import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestRepo, type TestRepo } from './helpers/fixture.js';
import { listFiles } from '../src/tools/list-files.js';

describe('listFiles', () => {
  let repo: TestRepo;

  beforeAll(() => { repo = createTestRepo(); });
  afterAll(() => repo.cleanup());

  it('lists all non-excluded files from the repo root', () => {
    const result = listFiles(repo.root, '.');
    expect(result).toContain('src/index.ts');
    expect(result).toContain('src/utils.ts');
    expect(result).toContain('package.json');
    expect(result).toContain('README.md');
  });

  it('excludes node_modules', () => {
    const result = listFiles(repo.root, '.');
    expect(result).not.toContain('node_modules');
  });

  it('lists files in a subdirectory', () => {
    const result = listFiles(repo.root, 'src');
    expect(result).toContain('src/index.ts');
    expect(result).toContain('src/utils.ts');
    expect(result).not.toContain('package.json');
  });

  it('throws PathValidationError for traversal attempts', () => {
    expect(() => listFiles(repo.root, '../../etc')).toThrow();
  });
});

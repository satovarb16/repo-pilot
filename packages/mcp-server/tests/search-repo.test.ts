import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestRepo, type TestRepo } from './helpers/fixture.js';
import { searchRepo } from '../src/tools/search-repo.js';

describe('searchRepo', () => {
  let repo: TestRepo;

  beforeAll(() => { repo = createTestRepo(); });
  afterAll(() => repo.cleanup());

  it('finds a match in a source file', () => {
    const result = searchRepo(repo.root, 'hello');
    expect(result).toContain('src/index.ts');
    expect(result).toContain('hello');
  });

  it('returns no matches message when nothing found', () => {
    const result = searchRepo(repo.root, 'zzz_does_not_exist_zzz');
    expect(result).toBe('No matches found.');
  });

  it('supports regex queries', () => {
    const result = searchRepo(repo.root, 'export (function|const)');
    expect(result).toContain('src/index.ts');
    expect(result).toContain('src/utils.ts');
  });

  it('excludes node_modules from results', () => {
    const result = searchRepo(repo.root, 'module');
    expect(result).not.toContain('node_modules');
  });

  it('scopes search to a subdirectory', () => {
    const result = searchRepo(repo.root, 'PI', 'src');
    expect(result).toContain('src/utils.ts');
    expect(result).not.toContain('package.json');
  });

  it('does not return content from blocklisted files', () => {
    const result = searchRepo(repo.root, 'SECRET');
    expect(result).not.toContain('.env');
  });
});

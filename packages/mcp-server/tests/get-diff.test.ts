import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestRepo, type TestRepo } from './helpers/fixture.js';
import { getDiff } from '../src/tools/get-diff.js';

describe('getDiff', () => {
  let repo: TestRepo;

  beforeAll(() => { repo = createTestRepo(); });
  afterAll(() => repo.cleanup());

  it('returns "No changes." when the working tree is clean', () => {
    const result = getDiff(repo.root, false);
    expect(result).toBe('No changes.');
  });

  it('shows unstaged changes after modifying a file', () => {
    writeFileSync(join(repo.root, 'src', 'index.ts'), 'export function hello() { return "modified"; }\n');
    const result = getDiff(repo.root, false);
    expect(result).toContain('modified');
    // restore
    execSync('git checkout -- src/index.ts', { cwd: repo.root });
  });

  it('shows staged changes when staged flag is true', () => {
    writeFileSync(join(repo.root, 'src', 'utils.ts'), 'export const PI = 3.14159;\n');
    execSync('git add src/utils.ts', { cwd: repo.root });
    const result = getDiff(repo.root, true);
    expect(result).toContain('3.14159');
    // restore
    execSync('git restore --staged src/utils.ts', { cwd: repo.root });
    execSync('git checkout -- src/utils.ts', { cwd: repo.root });
  });
});

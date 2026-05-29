import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export interface TestRepo {
  root: string;
  cleanup: () => void;
}

export function createTestRepo(): TestRepo {
  const root = mkdtempSync(join(tmpdir(), 'repo-pilot-test-'));

  // git identity required for commits
  const git = (cmd: string) => execSync(cmd, { cwd: root, stdio: 'pipe' });
  git('git init');
  git('git config user.email "test@test.com"');
  git('git config user.name "Test"');

  // directory structure
  mkdirSync(join(root, 'src'));
  mkdirSync(join(root, 'node_modules', 'some-dep'), { recursive: true });

  // source files with known content for search tests
  writeFileSync(join(root, 'src', 'index.ts'), 'export function hello() { return "world"; }\n');
  writeFileSync(join(root, 'src', 'utils.ts'), 'export const PI = 3.14;\n// TODO: remove this\n');
  writeFileSync(join(root, 'package.json'), '{"name":"test-repo","version":"1.0.0"}\n');
  writeFileSync(join(root, 'README.md'), '# Test Repo\nHello world\n');

  // sensitive files that must be blocked
  writeFileSync(join(root, '.env'), 'SECRET=supersecret\n');
  writeFileSync(join(root, 'id_rsa'), '-----BEGIN RSA PRIVATE KEY-----\nfake\n');

  // node_modules file (must be excluded from list/search)
  writeFileSync(join(root, 'node_modules', 'some-dep', 'index.js'), 'module.exports = {};\n');

  // initial commit so git diff works
  git('git add src package.json README.md');
  git('git commit -m "initial commit"');

  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

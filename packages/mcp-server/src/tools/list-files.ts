import { readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { PathValidator } from '@repo-pilot/agent-core';

const EXCLUDED_DIRS = new Set(['.git', 'node_modules', 'dist', '.turbo', '.next']);

export function listFiles(repoRoot: string, relativePath: string = '.'): string {
  const normalizedRoot = resolve(repoRoot);

  // PathValidator throws when path resolves to repoRoot itself (relative === '').
  // The '.' case is valid for listing the whole repo, so we handle it directly.
  let absPath: string;
  if (relativePath === '.' || relativePath === '') {
    absPath = normalizedRoot;
  } else {
    const validator = new PathValidator(repoRoot);
    absPath = validator.validate(relativePath);
  }

  const results: string[] = [];
  walkDir(absPath, normalizedRoot, results);

  return results.length > 0 ? results.join('\n') : 'No files found.';
}

function walkDir(dir: string, repoRoot: string, results: string[]): void {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) walkDir(fullPath, repoRoot, results);
    } else {
      // Normalize to forward slashes so tests pass on Windows
      results.push(relative(repoRoot, fullPath).replace(/\\/g, '/'));
    }
  }
}

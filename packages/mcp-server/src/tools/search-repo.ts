import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { PathValidator } from '@repo-pilot/agent-core';
import { isBlocklisted } from '../blocklist.js';

const EXCLUDED_DIRS = new Set(['.git', 'node_modules', 'dist', '.turbo', '.next']);
const MAX_RESULTS = 100;

export function searchRepo(repoRoot: string, query: string, relativePath: string = '.'): string {
  const normalizedRoot = resolve(repoRoot);

  // PathValidator throws when path resolves to repoRoot itself (relative === '').
  // The '.' case is valid for searching the whole repo, so we handle it directly.
  let absPath: string;
  if (relativePath === '.' || relativePath === '') {
    absPath = normalizedRoot;
  } else {
    const validator = new PathValidator(repoRoot);
    absPath = validator.validate(relativePath);
  }

  const regex = new RegExp(query, 'gm');
  const matches: string[] = [];

  walkAndSearch(absPath, normalizedRoot, regex, matches);

  if (matches.length === 0) return 'No matches found.';

  const truncated = matches.length > MAX_RESULTS;
  const output = matches.slice(0, MAX_RESULTS).join('\n');
  return truncated ? `${output}\n[truncated — 100 match limit reached]` : output;
}

function walkAndSearch(dir: string, repoRoot: string, regex: RegExp, matches: string[]): void {
  if (matches.length >= MAX_RESULTS) return;

  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (matches.length >= MAX_RESULTS) break;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) walkAndSearch(fullPath, repoRoot, regex, matches);
    } else {
      if (isBlocklisted(fullPath)) continue;
      try {
        const content = readFileSync(fullPath, 'utf8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length && matches.length < MAX_RESULTS; i++) {
          regex.lastIndex = 0;
          if (regex.test(lines[i])) {
            matches.push(`${relative(repoRoot, fullPath).replace(/\\/g, '/')}:${i + 1}: ${lines[i].trim()}`);
          }
        }
      } catch {
        // skip unreadable files
      }
    }
  }
}

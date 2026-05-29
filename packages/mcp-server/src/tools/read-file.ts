import { readFileSync } from 'node:fs';
import { PathValidator } from '@repo-pilot/agent-core';
import { isBlocklisted } from '../blocklist.js';

export function readFile(repoRoot: string, relativePath: string): string {
  const validator = new PathValidator(repoRoot);
  const absPath = validator.validate(relativePath);

  if (isBlocklisted(absPath)) {
    throw new Error(`reading this file is not permitted`);
  }

  return readFileSync(absPath, 'utf8');
}

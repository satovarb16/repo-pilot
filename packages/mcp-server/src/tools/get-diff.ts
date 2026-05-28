import { execSync } from 'node:child_process';

export function getDiff(repoRoot: string, staged: boolean = false): string {
  const args = staged ? 'diff --cached' : 'diff';
  const result = execSync(`git ${args}`, { cwd: repoRoot }).toString();
  return result.trim() || 'No changes.';
}

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Loads .env from repo root into process.env, skipping keys already set.
export function loadRootEnv(): void {
  const envPath = fileURLToPath(new URL('../../../.env', import.meta.url));
  try {
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // .env not found — rely on pre-set environment variables
  }
}

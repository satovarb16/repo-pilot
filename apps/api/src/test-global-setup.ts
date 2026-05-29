import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Loads .env from repo root — same relative depth as packages/agent-core/src/load-env.ts
function loadRootEnv(): void {
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

// Vitest globalSetup — runs in the main process before any workers are spawned.
export async function setup() {
  loadRootEnv();
}

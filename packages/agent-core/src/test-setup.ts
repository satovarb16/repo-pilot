import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Load .env from repo root so PrismaClient picks up DATABASE_URL during tests.
// Vitest's envFile option doesn't reliably resolve before module-level Prisma instantiation,
// so we do it here via a setupFile (runs in the test worker before any test file is imported).
// test-setup.ts is at packages/agent-core/src/ → go up 3 levels to repo root
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
    // Only set if not already set (so CI env takes precedence)
    if (!process.env[key]) process.env[key] = value;
  }
} catch {
  // .env not found — rely on pre-set environment variables
}

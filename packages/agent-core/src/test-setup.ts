import { loadRootEnv } from './load-env.js';

// Load .env from repo root so PrismaClient picks up DATABASE_URL during tests.
// Vitest's envFile option doesn't reliably resolve before module-level Prisma instantiation,
// so we do it here via a setupFile (runs in the test worker before any test file is imported).
loadRootEnv();

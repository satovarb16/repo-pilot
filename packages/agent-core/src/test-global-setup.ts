import { loadRootEnv } from './load-env.js';

// Vitest globalSetup — runs in the main process before any workers are spawned.
// Sets DATABASE_URL and other env vars from root .env so they are inherited by workers.
export async function setup() {
  loadRootEnv();
}

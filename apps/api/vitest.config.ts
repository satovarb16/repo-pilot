import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Load root .env in the main process before workers are spawned
    globalSetup: ['./src/test-global-setup.ts'],
    // Also load in each worker in case PrismaClient is instantiated at module level
    setupFiles: ['./src/test-setup.ts'],
  },
});

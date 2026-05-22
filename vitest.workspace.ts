import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/shared/vitest.config.ts',
  'packages/agent-core/vitest.config.ts',
  'packages/mcp-server/vitest.config.ts',
  'apps/api/vitest.config.ts',
]);

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MCPClientManager, MCPTimeoutError } from './mcp-client-manager.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
// src/ → agent-core/ → packages/ → repo root
const REPO_ROOT = resolve(__dirname, '../../..');
// src/ → agent-core/ → packages/mcp-server/dist/index.js
const SERVER_PATH = resolve(__dirname, '../../mcp-server/dist/index.js');

describe('MCPClientManager', () => {
  let manager: MCPClientManager;

  beforeEach(() => {
    manager = new MCPClientManager(REPO_ROOT, SERVER_PATH);
  });

  afterEach(async () => {
    await manager.stop();
  });

  it('lists files after start()', async () => {
    await manager.start();
    const result = await manager.callTool('list_files', {});
    expect(result).toContain('package.json');
    expect(result).toContain('CLAUDE.md');
  });

  it('callTool before start() throws immediately', async () => {
    await expect(manager.callTool('list_files', {})).rejects.toThrow('not started');
  });

  it('stop() is safe to call multiple times', async () => {
    await manager.start();
    await manager.stop();
    await expect(manager.stop()).resolves.not.toThrow();
  });

  it('throws MCPTimeoutError when tool call exceeds 30s', async () => {
    vi.useFakeTimers();
    await manager.start();

    // Patch the internal client to never resolve
    const m = manager as any;
    m.client.callTool = () => new Promise(() => {});

    // Attach rejection handler before advancing time to avoid unhandled rejection warning
    const promise = manager.callTool('list_files', {});
    const assertion = expect(promise).rejects.toThrow(MCPTimeoutError);
    await vi.advanceTimersByTimeAsync(30_001);
    await assertion;

    vi.useRealTimers();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SandboxRunner, SandboxCommandError } from './sandbox-runner.js';

// ---------------------------------------------------------------------------
// D1-2.1 — SandboxRunner unit tests
// ---------------------------------------------------------------------------

describe('SandboxRunner.assertAllowed (allowlist enforcement)', () => {
  it('throws SandboxCommandError for "rm -rf /"', () => {
    const runner = new SandboxRunner();
    expect(() => (runner as any).assertAllowed('rm -rf /')).toThrow(SandboxCommandError);
  });

  it('throws SandboxCommandError for compound command "npm test && curl evil"', () => {
    const runner = new SandboxRunner();
    expect(() => (runner as any).assertAllowed('npm test && curl evil')).toThrow(SandboxCommandError);
  });

  it('does NOT throw for "npm test"', () => {
    const runner = new SandboxRunner();
    expect(() => (runner as any).assertAllowed('npm test')).not.toThrow();
  });

  it('does NOT throw for "pnpm test"', () => {
    const runner = new SandboxRunner();
    expect(() => (runner as any).assertAllowed('pnpm test')).not.toThrow();
  });

  it('does NOT throw for "jest"', () => {
    const runner = new SandboxRunner();
    expect(() => (runner as any).assertAllowed('jest')).not.toThrow();
  });

  it('does NOT throw for "vitest"', () => {
    const runner = new SandboxRunner();
    expect(() => (runner as any).assertAllowed('vitest')).not.toThrow();
  });
});

describe('SandboxRunner.run — child_process fallback when Docker unavailable', () => {
  it('returns sandboxed: false when isDockerAvailable returns false', async () => {
    const runner = new SandboxRunner();

    // Mock isDockerAvailable to return false
    vi.spyOn(runner as any, 'isDockerAvailable').mockResolvedValue(false);

    // Mock the child_process fallback to return a controlled result
    vi.spyOn(runner as any, 'runInChildProcess').mockResolvedValue({
      exitCode: 0,
      stdout: 'Tests passed',
      stderr: '',
      durationMs: 100,
      sandboxed: false,
      timedOut: false,
      dockerImage: null,
    });

    const result = await runner.run({ command: 'npm test', repoPath: '/tmp/repo' });
    expect(result.sandboxed).toBe(false);
    expect(result.dockerImage).toBeNull();
  });
});

describe('SandboxRunner.run — timeout sentinel', () => {
  it('returns timedOut: true and exitCode: 124 when timeout fires', async () => {
    const runner = new SandboxRunner();

    vi.spyOn(runner as any, 'isDockerAvailable').mockResolvedValue(false);
    vi.spyOn(runner as any, 'runInChildProcess').mockResolvedValue({
      exitCode: 124,
      stdout: '',
      stderr: 'Timeout',
      durationMs: 120_000,
      sandboxed: false,
      timedOut: true,
      dockerImage: null,
    });

    const result = await runner.run({ command: 'npm test', repoPath: '/tmp/repo' });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBe(124);
  });
});

describe('SandboxRunner.run — onChunk streaming (child_process fallback)', () => {
  it('calls onChunk for each stdout/stderr chunk during child_process run', async () => {
    const runner = new SandboxRunner();
    vi.spyOn(runner as any, 'isDockerAvailable').mockResolvedValue(false);

    const chunks: string[] = [];
    // Spy on runInChildProcess to simulate chunk emission via onChunk
    vi.spyOn(runner as any, 'runInChildProcess').mockImplementation(
      async (opts: any) => {
        opts.onChunk?.('stdout chunk 1');
        opts.onChunk?.('stderr chunk 2');
        return {
          exitCode: 0, stdout: 'stdout chunk 1', stderr: 'stderr chunk 2',
          durationMs: 50, sandboxed: false, timedOut: false, dockerImage: null,
        };
      },
    );

    const result = await runner.run(
      { command: 'npm test', repoPath: '/tmp/repo' },
      (chunk) => chunks.push(chunk),
    );

    expect(chunks).toEqual(['stdout chunk 1', 'stderr chunk 2']);
    expect(result.exitCode).toBe(0);
  });

  it('works without onChunk (undefined) — no error', async () => {
    const runner = new SandboxRunner();
    vi.spyOn(runner as any, 'isDockerAvailable').mockResolvedValue(false);
    vi.spyOn(runner as any, 'runInChildProcess').mockResolvedValue({
      exitCode: 0, stdout: 'ok', stderr: '', durationMs: 10,
      sandboxed: false, timedOut: false, dockerImage: null,
    });

    await expect(runner.run({ command: 'npm test', repoPath: '/tmp/repo' })).resolves.toBeDefined();
  });
});

describe('SandboxRunner.run — onChunk streaming (Docker path)', () => {
  it('calls onChunk via Docker stream when Docker available', async () => {
    const runner = new SandboxRunner();
    vi.spyOn(runner as any, 'isDockerAvailable').mockResolvedValue(true);

    const chunks: string[] = [];
    // Spy on runInDocker to simulate chunk emission
    vi.spyOn(runner as any, 'runInDocker').mockImplementation(
      async (opts: any) => {
        opts.onChunk?.('docker-stdout-chunk');
        return {
          exitCode: 0, stdout: 'docker-stdout-chunk', stderr: '',
          durationMs: 200, sandboxed: true, timedOut: false, dockerImage: 'tag:123',
        };
      },
    );

    await runner.run({ command: 'npm test', repoPath: '/tmp/repo' }, (c) => chunks.push(c));
    expect(chunks).toContain('docker-stdout-chunk');
  });
});

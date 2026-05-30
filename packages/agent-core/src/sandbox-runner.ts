import { spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';
import Docker from 'dockerode';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface SandboxRunOptions {
  /** Test command — validated against ALLOWED_COMMANDS before any process spawns */
  command: string;
  /** Host path to the repo clone (build context and cwd for child_process) */
  repoPath: string;
  /** Default 120 seconds */
  timeoutMs?: number;
}

export interface TestRunResult {
  exitCode: number;     // 124 sentinel on timeout
  stdout: string;
  stderr: string;
  durationMs: number;
  /** false when Docker is unavailable and child_process fallback is used */
  sandboxed: boolean;
  timedOut: boolean;
  /** Docker image tag when sandboxed, null on fallback path */
  dockerImage: string | null;
}

export class SandboxCommandError extends Error {
  constructor(command: string) {
    super(`Command not in allowlist: "${command}"`);
    this.name = 'SandboxCommandError';
  }
}

// ---------------------------------------------------------------------------
// SandboxRunner
// ---------------------------------------------------------------------------

export class SandboxRunner {
  static readonly ALLOWED_COMMANDS = [
    'npm test',
    'npm run test',
    'npm run test:ci',
    'pnpm test',
    'pnpm run test',
    'yarn test',
    'jest',
    'vitest',
  ] as const;

  constructor(
    /** Path to Docker socket (e.g. /var/run/docker.sock). Undefined → try default, then fallback */
    private readonly dockerSocketPath?: string,
    /** Path to Dockerfile.sandbox. Undefined → no Docker build attempted */
    private readonly dockerfilePath?: string,
  ) {}

  async run(opts: SandboxRunOptions, onChunk?: (chunk: string) => void): Promise<TestRunResult> {
    this.assertAllowed(opts.command);
    const timeout = opts.timeoutMs ?? 120_000;

    if (await this.isDockerAvailable()) {
      try {
        return await this.runInDocker({ ...opts, timeoutMs: timeout, onChunk });
      } catch (err) {
        // Unexpected Docker error → fallback (logged, not rethrown)
        console.warn('[SandboxRunner] Docker failed, falling back to child_process:', err);
      }
    }

    return this.runInChildProcess({ ...opts, timeoutMs: timeout, onChunk });
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private assertAllowed(command: string): void {
    // Normalize whitespace for comparison
    const normalized = command.replace(/\s+/g, ' ').trim();
    const isAllowed = (SandboxRunner.ALLOWED_COMMANDS as readonly string[]).includes(normalized);
    if (!isAllowed) {
      throw new SandboxCommandError(command);
    }
  }

  private async isDockerAvailable(): Promise<boolean> {
    try {
      const docker = this.buildDockerClient();
      await docker.ping();
      return true;
    } catch {
      return false;
    }
  }

  private buildDockerClient(): Docker {
    return this.dockerSocketPath
      ? new Docker({ socketPath: this.dockerSocketPath })
      : new Docker();
  }

  private async runInDocker(opts: Required<SandboxRunOptions> & { onChunk?: (chunk: string) => void }): Promise<TestRunResult> {
    const docker = this.buildDockerClient();
    const imageTag = `repo-pilot-sandbox:${Date.now()}`;
    const start = Date.now();

    // Build image from Dockerfile.sandbox using the repo clone as build context
    await new Promise<void>((resolve, reject) => {
      docker.buildImage(
        { context: opts.repoPath, src: ['.'] },
        { t: imageTag, dockerfile: this.dockerfilePath ?? 'Dockerfile.sandbox' },
        (err, stream) => {
          if (err) return reject(err);
          if (!stream) return reject(new Error('No build stream'));
          docker.modem.followProgress(stream, (buildErr) => {
            if (buildErr) reject(buildErr);
            else resolve();
          });
        },
      );
    });

    // Split command into argv array
    const cmdParts = opts.command.split(/\s+/);

    const container = await docker.createContainer({
      Image: imageTag,
      Cmd: cmdParts,
      HostConfig: {
        NetworkMode: 'none',
        AutoRemove: false,
      },
    });

    let timedOut = false;
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    try {
      // Attach before start so we capture all output
      const attachStream = await container.attach({
        stream: true,
        stdout: true,
        stderr: true,
      });

      const stdoutPassthrough = new PassThrough();
      const stderrPassthrough = new PassThrough();
      stdoutPassthrough.on('data', (chunk: Buffer) => {
        stdoutChunks.push(chunk);
        opts.onChunk?.(chunk.toString('utf8'));
      });
      stderrPassthrough.on('data', (chunk: Buffer) => {
        stderrChunks.push(chunk);
        opts.onChunk?.(chunk.toString('utf8'));
      });

      // Demux the multiplexed Docker stream — no manual 8-byte parsing
      docker.modem.demuxStream(attachStream, stdoutPassthrough, stderrPassthrough);

      await container.start();

      // Race container exit against timeout
      const { StatusCode } = await Promise.race([
        container.wait() as Promise<{ StatusCode: number }>,
        new Promise<{ StatusCode: number }>((resolve) => {
          setTimeout(async () => {
            timedOut = true;
            await container.kill().catch(() => {});
            resolve({ StatusCode: 124 });
          }, opts.timeoutMs);
        }),
      ]);

      // Let passthrough streams drain
      await new Promise<void>((resolve) => setImmediate(resolve));
      stdoutPassthrough.end();
      stderrPassthrough.end();

      return {
        exitCode: timedOut ? 124 : StatusCode,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        durationMs: Date.now() - start,
        sandboxed: true,
        timedOut,
        dockerImage: imageTag,
      };
    } finally {
      // Always destroy the container even if an error occurred
      await container.remove({ force: true }).catch(() => {});
      // Best-effort image cleanup to avoid disk leaks — ignore errors
      await docker.getImage(imageTag).remove({ force: true }).catch(() => {});
    }
  }

  private async runInChildProcess(opts: Required<SandboxRunOptions> & { onChunk?: (chunk: string) => void }): Promise<TestRunResult> {
    const start = Date.now();
    const [cmd, ...args] = opts.command.split(/\s+/);

    return new Promise<TestRunResult>((resolve) => {
      const proc = spawn(cmd, args, {
        cwd: opts.repoPath,
        shell: false,
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let timedOut = false;

      proc.stdout?.on('data', (chunk: Buffer) => {
        stdoutChunks.push(chunk);
        opts.onChunk?.(chunk.toString('utf8'));
      });
      proc.stderr?.on('data', (chunk: Buffer) => {
        stderrChunks.push(chunk);
        opts.onChunk?.(chunk.toString('utf8'));
      });

      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGKILL');
      }, opts.timeoutMs);

      proc.on('close', (code) => {
        clearTimeout(timer);
        resolve({
          exitCode: timedOut ? 124 : (code ?? 1),
          stdout: Buffer.concat(stdoutChunks).toString('utf8'),
          stderr: Buffer.concat(stderrChunks).toString('utf8'),
          durationMs: Date.now() - start,
          sandboxed: false,
          timedOut,
          dockerImage: null,
        });
      });
    });
  }
}

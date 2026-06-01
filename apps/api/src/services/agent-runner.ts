import { EventEmitter } from 'node:events';
import type { PrismaClient } from '@prisma/client';
import {
  AgentStateMachine,
  ClaudeService,
  GitHubService,
  MCPClientManager,
  SandboxRunner,
  SecretRedactor,
} from '@repo-pilot/agent-core';

export interface EditApprovalResult {
  approved: string[];
  rejected: string[];
}

export class ConcurrencyLimitError extends Error {
  constructor(limit: number) {
    super(`Concurrency limit of ${limit} active runs reached. Try again later.`);
    this.name = 'ConcurrencyLimitError';
  }
}

export class AgentRunner {
  private readonly emitters = new Map<string, EventEmitter>();
  private readonly planResolvers = new Map<string, (approved: boolean) => void>();
  private readonly editResolvers = new Map<string, (result: EditApprovalResult) => void>();
  private readonly testRunResolvers = new Map<string, (approved: boolean) => void>();
  // D1-10: PR approval resolvers — keyed by runId, same pattern as testRunResolvers
  private readonly prResolvers = new Map<string, (approved: boolean) => void>();
  // Phase 5: in-process concurrency counter
  private activeRuns = 0;
  private readonly maxConcurrent: number;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly repoRoot: string,
    private readonly anthropicApiKey: string,
    private readonly mcpServerPath: string,
    private readonly dockerSocket?: string,
    private readonly dockerfilePath?: string,
    maxConcurrent?: number,
  ) {
    // Default from env MAX_CONCURRENT_RUNS; 0 = unlimited
    this.maxConcurrent = maxConcurrent ?? Number(process.env['MAX_CONCURRENT_RUNS'] ?? 2);
  }

  register(runId: string): void {
    this.emitters.set(runId, new EventEmitter());
  }

  /**
   * Phase 5 T07/T08: Atomically check and acquire a concurrency slot.
   * Must be called before any await so the check+increment is never interleaved
   * with a concurrent request. Throws ConcurrencyLimitError if the cap is reached.
   * Call releaseSlot() if the run never starts (e.g. DB create fails after this).
   */
  acquireSlot(): void {
    if (this.maxConcurrent > 0 && this.activeRuns >= this.maxConcurrent) {
      throw new ConcurrencyLimitError(this.maxConcurrent);
    }
    this.activeRuns++;
  }

  releaseSlot(): void {
    this.activeRuns--;
  }

  // D1-10: token added as explicit param — never persisted, lifetime bound to the run
  async start(
    runId: string,
    repoPath: string,
    token?: string,
    owner?: string,
    repo?: string,
  ): Promise<void> {
    // Slot pre-acquired by caller via acquireSlot() — no double-check needed here
    try {
      const emitter = this.emitters.get(runId) ?? new EventEmitter();
      if (!this.emitters.has(runId)) this.emitters.set(runId, emitter);

      const secretRedactor = new SecretRedactor();
      const claudeService = new ClaudeService(this.anthropicApiKey, secretRedactor);
      const mcpClientManager = new MCPClientManager(repoPath, this.mcpServerPath);
      const sandboxRunner = new SandboxRunner(this.dockerSocket, this.dockerfilePath);
      const githubService = new GitHubService(this.repoRoot);

      const sm = new AgentStateMachine(
        runId,
        this.prisma,
        claudeService,
        mcpClientManager,
        repoPath,
        () => this.waitForPlanApproval(runId),
        () => this.waitForEditApprovals(runId),
        sandboxRunner,
        'npm test',
        () => this.waitForTestRunApproval(runId),
        emitter,
        // D1-8: wire PR approval gate when token is available
        token ? () => this.waitForPRApproval(runId) : undefined,
        token ? githubService : undefined,
        token,
        owner,
        repo,
        // Phase 5 T09: pass SecretRedactor into SM for tool input/output redaction at SSE boundary
        secretRedactor,
      );

      // Fire and forget — errors are emitted via EventEmitter as run_failed
      sm.start()
        .catch(() => {})
        .finally(() => {
          this.activeRuns--;
          this.emitters.delete(runId);
          this.planResolvers.delete(runId);
          this.editResolvers.delete(runId);
          this.testRunResolvers.delete(runId);
          // D1-10: clean up PR resolver in finally (no orphaned promise on failure)
          this.prResolvers.delete(runId);
        });
    } catch (err) {
      // Constructor threw before sm.start() registered the finally — release the slot manually
      this.activeRuns--;
      throw err;
    }
  }

  getEmitter(runId: string): EventEmitter | undefined {
    return this.emitters.get(runId);
  }

  waitForPlanApproval(runId: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.planResolvers.set(runId, resolve);
    });
  }

  resolvePlanApproval(runId: string, approved: boolean): void {
    this.planResolvers.get(runId)?.(approved);
    this.planResolvers.delete(runId);
  }

  waitForEditApprovals(runId: string): Promise<EditApprovalResult> {
    return new Promise((resolve) => {
      this.editResolvers.set(runId, resolve);
    });
  }

  resolveEditApprovals(runId: string, result: EditApprovalResult): void {
    this.editResolvers.get(runId)?.(result);
    this.editResolvers.delete(runId);
  }

  waitForTestRunApproval(runId: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.testRunResolvers.set(runId, resolve);
    });
  }

  resolveTestRunApproval(runId: string, approved: boolean): void {
    this.testRunResolvers.get(runId)?.(approved);
    this.testRunResolvers.delete(runId);
  }

  // D1-10: PR approval resolver — mirrors testRunResolvers pattern
  waitForPRApproval(runId: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.prResolvers.set(runId, resolve);
    });
  }

  resolvePRApproval(runId: string, approved: boolean): void {
    this.prResolvers.get(runId)?.(approved);
    this.prResolvers.delete(runId);
  }
}

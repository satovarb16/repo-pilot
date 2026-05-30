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

export class AgentRunner {
  private readonly emitters = new Map<string, EventEmitter>();
  private readonly planResolvers = new Map<string, (approved: boolean) => void>();
  private readonly editResolvers = new Map<string, (result: EditApprovalResult) => void>();
  private readonly testRunResolvers = new Map<string, (approved: boolean) => void>();
  // D1-10: PR approval resolvers — keyed by runId, same pattern as testRunResolvers
  private readonly prResolvers = new Map<string, (approved: boolean) => void>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly repoRoot: string,
    private readonly anthropicApiKey: string,
    private readonly mcpServerPath: string,
    private readonly dockerSocket?: string,
    private readonly dockerfilePath?: string,
  ) {}

  register(runId: string): void {
    this.emitters.set(runId, new EventEmitter());
  }

  // D1-10: token added as explicit param — never persisted, lifetime bound to the run
  async start(
    runId: string,
    repoPath: string,
    token?: string,
    owner?: string,
    repo?: string,
  ): Promise<void> {
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
    );

    // Fire and forget — errors are emitted via EventEmitter as run_failed
    sm.start()
      .catch(() => {})
      .finally(() => {
        this.emitters.delete(runId);
        this.planResolvers.delete(runId);
        this.editResolvers.delete(runId);
        this.testRunResolvers.delete(runId);
        // D1-10: clean up PR resolver in finally (no orphaned promise on failure)
        this.prResolvers.delete(runId);
      });
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

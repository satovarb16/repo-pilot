import { EventEmitter } from 'node:events';
import type { PrismaClient } from '@prisma/client';
import {
  AgentStateMachine,
  ClaudeService,
  MCPClientManager,
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

  constructor(
    private readonly prisma: PrismaClient,
    private readonly repoRoot: string,
    private readonly anthropicApiKey: string,
    private readonly mcpServerPath: string,
  ) {}

  async start(runId: string, repoPath: string): Promise<void> {
    const emitter = new EventEmitter();
    this.emitters.set(runId, emitter);

    const secretRedactor = new SecretRedactor();
    const claudeService = new ClaudeService(this.anthropicApiKey, secretRedactor);
    const mcpClientManager = new MCPClientManager(repoPath, this.mcpServerPath);

    const sm = new AgentStateMachine(
      runId,
      this.prisma,
      claudeService,
      mcpClientManager,
      repoPath,
      () => this.waitForPlanApproval(runId),
      () => this.waitForEditApprovals(runId),
      emitter,
    );

    // Fire and forget — errors are emitted via EventEmitter as run_failed
    sm.start()
      .catch(() => {})
      .finally(() => {
        this.emitters.delete(runId);
        this.planResolvers.delete(runId);
        this.editResolvers.delete(runId);
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
}

import { EventEmitter } from 'node:events';
import type { PrismaClient } from '@prisma/client';
import {
  AgentStateMachine,
  ClaudeService,
  MCPClientManager,
  SecretRedactor,
} from '@repo-pilot/agent-core';

export class AgentRunner {
  private readonly emitters = new Map<string, EventEmitter>();

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
    const sm = new AgentStateMachine(runId, this.prisma, claudeService, mcpClientManager, emitter);

    // Fire and forget — errors are emitted via EventEmitter as run_failed
    sm.start()
      .catch(() => {})
      .finally(() => {
        this.emitters.delete(runId);
      });
  }

  getEmitter(runId: string): EventEmitter | undefined {
    return this.emitters.get(runId);
  }
}

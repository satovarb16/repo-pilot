import { EventEmitter } from 'node:events';
import { PrismaClient } from '@prisma/client';
import type Anthropic from '@anthropic-ai/sdk';
import type { ClaudeService } from './claude-service.js';
import type { MCPClientManager } from './mcp-client-manager.js';

export type AgentSSEEvent =
  | { type: 'state_changed'; state: string }
  | { type: 'step_started'; stepType: string; description: string }
  | { type: 'step_completed'; stepType: string; durationMs: number }
  | { type: 'tool_called'; name: string; input: unknown; output: string }
  | { type: 'run_completed'; planJson: unknown }
  | { type: 'run_failed'; error: string }

const PHASE_1_TOOLS: Anthropic.Tool[] = [
  {
    name: 'list_files',
    description: 'List all files in the repository or a subdirectory.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Relative path (default: ".")' } },
    },
  },
  {
    name: 'read_file',
    description: 'Read the contents of a file. Sensitive files are blocked.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Relative path to the file' } },
      required: ['path'],
    },
  },
  {
    name: 'search_repo',
    description: 'Search for a string or regex in all files. Returns up to 100 matches.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'String or regex to search for' },
        path: { type: 'string', description: 'Subdirectory to scope search (default: ".")' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_diff',
    description: 'Get the current git diff.',
    input_schema: {
      type: 'object',
      properties: { staged: { type: 'boolean', description: 'Show staged changes' } },
    },
  },
];

export class AgentStateMachine {
  private stepCounter = 0;
  private queue: Promise<void> = Promise.resolve();
  private stepStartTimes = new Map<string, number>();

  constructor(
    private readonly runId: string,
    private readonly prisma: PrismaClient,
    private readonly claudeService: ClaudeService,
    private readonly mcpClientManager: MCPClientManager,
    private readonly emitter?: EventEmitter,
  ) {}

  start(): Promise<void> {
    this.queue = this.queue.then(() => this.run());
    return this.queue;
  }

  private emit(event: AgentSSEEvent): void {
    this.emitter?.emit('event', event);
  }

  private async run(): Promise<void> {
    let mcpStarted = false;

    try {
      const run = await this.prisma.agentRun.findUniqueOrThrow({
        where: { id: this.runId },
      });

      // idle → analyzing_repo
      await this.transition('analyzing_repo', 'analyze_repo', 'Analyzing repository structure');
      await this.mcpClientManager.start();
      mcpStarted = true;

      // Wrap tool executor to emit tool_called events
      const tracingExecutor = async (name: string, args: Record<string, unknown>): Promise<string> => {
        const output = await this.mcpClientManager.callTool(name, args);
        this.emit({ type: 'tool_called', name, input: args, output });
        return output;
      };

      const repoFiles = await tracingExecutor('list_files', {});
      await this.completeStep('analyze_repo');

      // analyzing_repo → planning
      await this.transition('planning', 'generate_plan', 'Generating implementation plan');
      const messages = await this.claudeService.sendWithTools(
        [
          {
            role: 'user',
            content: `Task: ${run.taskDescription}\n\nRepository files:\n${repoFiles}\n\nAnalyze the repository and produce a detailed implementation plan.`,
          },
        ],
        PHASE_1_TOOLS,
        tracingExecutor,
      );
      await this.completeStep('generate_plan');

      // planning → waiting_for_plan_approval
      await this.transition('waiting_for_plan_approval', 'save_plan', 'Waiting for plan approval');
      const lastMessage = messages[messages.length - 1];
      await this.prisma.agentRun.update({
        where: { id: this.runId },
        data: { planJson: lastMessage.content as object },
      });
      await this.completeStep('save_plan');

      this.emit({ type: 'run_completed', planJson: lastMessage.content });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.fail(message);
      this.emit({ type: 'run_failed', error: message });
      throw err;
    } finally {
      if (mcpStarted) await this.mcpClientManager.stop().catch(() => {});
    }
  }

  private async transition(state: string, stepType: string, description: string): Promise<void> {
    await this.prisma.agentRun.update({
      where: { id: this.runId },
      data: { currentState: state },
    });
    this.stepStartTimes.set(stepType, Date.now());
    await this.prisma.agentStep.create({
      data: {
        runId: this.runId,
        stepNumber: ++this.stepCounter,
        stepType,
        description,
        status: 'running',
      },
    });
    this.emit({ type: 'state_changed', state });
    this.emit({ type: 'step_started', stepType, description });
  }

  private async completeStep(stepType: string): Promise<void> {
    const startTime = this.stepStartTimes.get(stepType) ?? Date.now();
    const durationMs = Date.now() - startTime;
    await this.prisma.agentStep.updateMany({
      where: { runId: this.runId, stepType, status: 'running' },
      data: { status: 'completed', completedAt: new Date() },
    });
    this.emit({ type: 'step_completed', stepType, durationMs });
  }

  private async fail(errorMessage: string): Promise<void> {
    try {
      await this.prisma.agentRun.update({
        where: { id: this.runId },
        data: { currentState: 'failed' },
      });
      await this.prisma.agentStep.updateMany({
        where: { runId: this.runId, status: 'running' },
        data: { status: 'failed', errorMessage },
      });
    } catch {
      // best-effort — original error is re-thrown by caller
    }
  }
}

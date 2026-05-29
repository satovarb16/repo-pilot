import { PrismaClient } from '@prisma/client';
import type Anthropic from '@anthropic-ai/sdk';
import type { ClaudeService } from './claude-service.js';
import type { MCPClientManager } from './mcp-client-manager.js';

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

  constructor(
    private readonly runId: string,
    private readonly prisma: PrismaClient,
    private readonly claudeService: ClaudeService,
    private readonly mcpClientManager: MCPClientManager,
  ) {}

  start(): Promise<void> {
    this.queue = this.queue.then(() => this.run());
    return this.queue;
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
      const repoFiles = await this.mcpClientManager.callTool('list_files', {});
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
        (name, args) =>
          this.mcpClientManager.callTool(name, args as Record<string, unknown>),
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
    } catch (err) {
      await this.fail(err instanceof Error ? err.message : String(err));
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
    await this.prisma.agentStep.create({
      data: {
        runId: this.runId,
        stepNumber: ++this.stepCounter,
        stepType,
        description,
        status: 'running',
      },
    });
  }

  private async completeStep(stepType: string): Promise<void> {
    await this.prisma.agentStep.updateMany({
      where: { runId: this.runId, stepType, status: 'running' },
      data: { status: 'completed', completedAt: new Date() },
    });
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

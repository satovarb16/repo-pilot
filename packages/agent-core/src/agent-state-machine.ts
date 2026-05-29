import { EventEmitter } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { createPatch } from 'diff';
import type Anthropic from '@anthropic-ai/sdk';
import type { ClaudeService } from './claude-service.js';
import type { MCPClientManager } from './mcp-client-manager.js';
import { PathValidator } from './path-validator.js';

export type AgentSSEEvent =
  | { type: 'state_changed'; state: string }
  | { type: 'step_started'; stepType: string; description: string }
  | { type: 'step_completed'; stepType: string; durationMs: number }
  | { type: 'tool_called'; name: string; input: unknown; output: string }
  | { type: 'approval_required'; approvalType: 'plan'; planText: string }
  | { type: 'edit_proposed'; changeId: string; filePath: string; diff: string }
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

const PHASE_2_TOOLS: Anthropic.Tool[] = [
  ...PHASE_1_TOOLS,
  {
    name: 'propose_file_edit',
    description:
      'Propose a complete replacement of a file\'s content. The user must approve before the file is written to disk.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path to the file to edit' },
        content: { type: 'string', description: 'The complete new content of the file' },
      },
      required: ['path', 'content'],
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
    private readonly repoPath: string,
    private readonly waitForPlanApproval: () => Promise<boolean>,
    private readonly waitForEditApprovals: () => Promise<{ approved: string[]; rejected: string[] }>,
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

      const tracingExecutor = async (name: string, args: Record<string, unknown>): Promise<string> => {
        if (name === 'propose_file_edit') {
          return await this.handleProposeFileEdit(args);
        }
        const output = await this.mcpClientManager.callTool(name, args);
        this.emit({ type: 'tool_called', name, input: args, output });
        return output;
      };

      const repoFiles = await tracingExecutor('list_files', {});
      await this.completeStep('analyze_repo');

      // analyzing_repo → planning
      await this.transition('planning', 'generate_plan', 'Generating implementation plan');
      const planMessages = await this.claudeService.sendWithTools(
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
      const lastPlanMessage = planMessages[planMessages.length - 1];
      await this.prisma.agentRun.update({
        where: { id: this.runId },
        data: { planJson: lastPlanMessage.content as object },
      });
      await this.completeStep('save_plan');

      const planText = extractTextFromMessage(lastPlanMessage);
      this.emit({ type: 'approval_required', approvalType: 'plan', planText });

      const planApproved = await this.waitForPlanApproval();
      if (!planApproved) {
        throw new Error('Plan rejected by user');
      }

      // waiting_for_plan_approval → editing
      await this.transition('editing', 'edit_files', 'Implementing plan');
      await this.claudeService.sendWithTools(
        [
          ...planMessages,
          {
            role: 'user',
            content: 'The plan is approved. Now implement it by proposing the necessary file edits using the propose_file_edit tool.',
          },
        ],
        PHASE_2_TOOLS,
        tracingExecutor,
      );

      // Check for pending edits and gate on approval
      const pendingEdits = await this.prisma.fileChange.findMany({
        where: { runId: this.runId, approved: null },
      });

      if (pendingEdits.length > 0) {
        await this.transition('waiting_for_edit_approval', 'await_edit_approval', 'Waiting for edit approval');
        const { approved, rejected } = await this.waitForEditApprovals();
        await this.completeStep('await_edit_approval');

        const validator = new PathValidator(this.repoPath);
        for (const changeId of approved) {
          const fc = pendingEdits.find((e) => e.id === changeId);
          if (!fc || !fc.proposedContent) continue;
          const absPath = validator.validate(fc.filePath);
          await writeFile(absPath, fc.proposedContent, 'utf8');
          await this.prisma.fileChange.update({
            where: { id: changeId },
            data: { approved: true, writtenAt: new Date() },
          });
        }
        for (const changeId of rejected) {
          await this.prisma.fileChange.update({
            where: { id: changeId },
            data: { approved: false },
          });
        }
      }

      await this.completeStep('edit_files');

      this.emit({ type: 'run_completed', planJson: lastPlanMessage.content });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.emit({ type: 'run_failed', error: message });
      await this.fail(message);
      throw err;
    } finally {
      if (mcpStarted) await this.mcpClientManager.stop().catch(() => {});
    }
  }

  private async handleProposeFileEdit(args: Record<string, unknown>): Promise<string> {
    const filePath = args.path as string;
    const proposedContent = args.content as string;

    const validator = new PathValidator(this.repoPath);
    const absPath = validator.validate(filePath);

    let originalContent = '';
    try {
      originalContent = await readFile(absPath, 'utf8');
    } catch {
      // File doesn't exist yet — treat as new file, diff shows all additions
    }

    const diff = createPatch(filePath, originalContent, proposedContent, '', '');

    const fileChange = await this.prisma.fileChange.create({
      data: {
        runId: this.runId,
        filePath,
        changeType: originalContent === '' ? 'create' : 'edit',
        originalContent,
        proposedContent,
        diffContent: diff,
      },
    });

    this.emit({ type: 'edit_proposed', changeId: fileChange.id, filePath, diff });

    return JSON.stringify({
      changeId: fileChange.id,
      status: 'staged_for_approval',
      message: `Edit to ${filePath} staged. Awaiting user approval before writing to disk.`,
    });
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
    this.stepStartTimes.delete(stepType);
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

function extractTextFromMessage(message: Anthropic.MessageParam): string {
  const content = Array.isArray(message.content)
    ? message.content
    : [{ type: 'text', text: String(message.content) }];
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

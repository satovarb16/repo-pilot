import { EventEmitter } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { createPatch } from 'diff';
import type Anthropic from '@anthropic-ai/sdk';
import type { ClaudeService } from './claude-service.js';
import type { MCPClientManager } from './mcp-client-manager.js';
import { PathValidator } from './path-validator.js';
import type { SandboxRunner } from './sandbox-runner.js';
import type { AgentSSEEvent } from '@repo-pilot/shared';
import type { GitHubService } from './github-service.js';
import { composePRTitleAndBody } from './pr-composer.js';
import type { SecretRedactor } from './secret-redactor.js';

// Re-export so existing imports from agent-state-machine keep compiling
export type { AgentSSEEvent } from '@repo-pilot/shared';

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

// PHASE_3_TOOLS: same as PHASE_2_TOOLS (read tools + propose_file_edit).
// No run_tests tool — test execution is inline in the state machine (ADR-1).
const PHASE_3_TOOLS: Anthropic.Tool[] = [...PHASE_2_TOOLS];

export class AgentStateMachine {
  private stepCounter = 0;
  private queue: Promise<void> = Promise.resolve();
  private stepStartTimes = new Map<string, number>();
  // ADR-2: in-memory only; not persisted — run is not resumable across restarts
  private repairCount = 0;
  // Track whether the branch was pushed so we know whether to call deleteBranch on reject
  private branchPushed = false;
  // Phase 5 T05: cumulative token totals for the run
  private totalInputTokens = 0;
  private totalOutputTokens = 0;

  constructor(
    private readonly runId: string,
    private readonly prisma: PrismaClient,
    private readonly claudeService: ClaudeService,
    private readonly mcpClientManager: MCPClientManager,
    private readonly repoPath: string,
    private readonly waitForPlanApproval: () => Promise<boolean>,
    private readonly waitForEditApprovals: () => Promise<{ approved: string[]; rejected: string[] }>,
    private readonly sandboxRunner: SandboxRunner,
    private readonly testCommand: string,
    private readonly waitForTestRunApproval: () => Promise<boolean>,
    private readonly emitter?: EventEmitter,
    // D1-8: PR approval gate and delivery params (optional to keep existing callers working)
    private readonly waitForPRApproval?: () => Promise<boolean>,
    private readonly githubService?: GitHubService,
    private readonly githubToken?: string,
    private readonly owner?: string,
    private readonly repo?: string,
    // Phase 5 T04: optional SecretRedactor for tool input/output redaction at SSE boundary
    private readonly secretRedactor?: SecretRedactor,
  ) {}

  start(): Promise<void> {
    this.queue = this.queue.then(() => this.run());
    return this.queue;
  }

  // Phase 5 T05: accumulate token usage and emit SSE after each Claude call
  private onUsage(inputTokens: number, outputTokens: number): void {
    this.totalInputTokens += inputTokens;
    this.totalOutputTokens += outputTokens;
    this.emit({ type: 'token_usage', inputTokens: this.totalInputTokens, outputTokens: this.totalOutputTokens });
  }

  // Phase 5 T05: persist final token totals to DB on run end
  private async persistTokenTotals(): Promise<void> {
    if (this.totalInputTokens === 0 && this.totalOutputTokens === 0) return;
    try {
      await this.prisma.agentRun.update({
        where: { id: this.runId },
        data: { inputTokens: this.totalInputTokens, outputTokens: this.totalOutputTokens },
      });
    } catch {
      // Non-fatal — token persist failure must not shadow the main run result
    }
  }

  private emit(event: AgentSSEEvent): void {
    // Phase 5 T04: redact tool input/output before emitting to SSE consumers
    if (event.type === 'tool_called' && this.secretRedactor) {
      const redactJson = (value: unknown): unknown => {
        try {
          return JSON.parse(this.secretRedactor!.redact(JSON.stringify(value)));
        } catch {
          return value;
        }
      };
      event = { ...event, input: redactJson(event.input), output: this.secretRedactor.redact(event.output) };
    }
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
        undefined,
        (i, o) => this.onUsage(i, o),
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
            content:
              'The plan is approved. Now implement it by proposing the necessary file edits using the propose_file_edit tool.\n\nIMPORTANT: Only implement exactly what is described in the approved plan above. Do not make any additional changes, refactors, cleanup, or improvements that were not explicitly listed in the plan. Strict scope adherence is required.',
          },
        ],
        PHASE_2_TOOLS,
        tracingExecutor,
        undefined,
        (i, o) => this.onUsage(i, o),
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

      // Edits written → enter test run phase (Phase 3)
      await this.runTestPhase(lastPlanMessage);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.emit({ type: 'run_failed', error: message });
      await this.fail(message);
      throw err;
    } finally {
      if (mcpStarted) await this.mcpClientManager.stop().catch(() => {});
    }
  }

  // ---------------------------------------------------------------------------
  // Phase 3 — test run, review, and bounded repair loop
  // ---------------------------------------------------------------------------

  private async runTestPhase(lastPlanMessage: Anthropic.MessageParam): Promise<void> {
    // waiting_for_test_run_approval
    await this.transition('waiting_for_test_run_approval', 'await_test_approval', 'Waiting for test-run approval');
    this.emit({ type: 'approval_required', approvalType: 'test_run', command: this.testCommand });

    const approved = await this.waitForTestRunApproval();
    if (!approved) {
      // Graceful end — user chose not to run tests
      await this.completeStep('await_test_approval');
      await this.transition('complete', 'finalize', 'Run complete (tests skipped)');
      await this.completeStep('finalize');
      await this.persistTokenTotals();
      this.emit({ type: 'run_completed', planJson: lastPlanMessage.content });
      return;
    }
    await this.completeStep('await_test_approval');

    // running_tests
    await this.transition('running_tests', 'run_tests', `Running: ${this.testCommand}`);
    this.emit({ type: 'test_run_started', command: this.testCommand });

    const result = await this.sandboxRunner.run(
      { command: this.testCommand, repoPath: this.repoPath },
      (chunk) => this.emit({ type: 'test_output_chunk', runId: this.runId, chunk }),
    );

    const testRun = await this.prisma.testRun.create({
      data: {
        runId: this.runId,
        command: this.testCommand,
        status: result.exitCode === 0 ? 'passed' : 'failed',
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: result.durationMs,
        dockerImage: result.dockerImage,
      },
    });

    this.emit({
      type: 'test_run_completed',
      testRunId: testRun.id,
      status: testRun.status,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      sandboxed: result.sandboxed,
      stdout: result.stdout,
      stderr: result.stderr,
    });
    await this.completeStep('run_tests');

    // reviewing
    await this.transition('reviewing', 'review_tests', 'Reviewing test results');

    if (result.exitCode === 0) {
      // Emit repair_completed (success) if we are in a repair iteration
      if (this.repairCount > 0) {
        this.emit({ type: 'repair_completed', runId: this.runId, attempt: this.repairCount, success: true });
      }
      await this.completeStep('review_tests');

      // D1-8/D1-9: If a PR approval gate is wired, enter waiting_for_pr_approval
      if (this.waitForPRApproval) {
        await this.runPRPhase(lastPlanMessage);
        return;
      }

      await this.transition('complete', 'finalize', 'Run complete');
      await this.completeStep('finalize');
      await this.persistTokenTotals();
      this.emit({ type: 'run_completed', planJson: lastPlanMessage.content });
      return;
    }

    // Tests failed — check repair guard (ADR-2: max 2 attempts)
    if (this.repairCount >= 2) {
      // Emit repair_completed (failure) for the last attempt
      this.emit({ type: 'repair_completed', runId: this.runId, attempt: this.repairCount, success: false });
      await this.completeStep('review_tests');
      throw new Error('Tests failed after 2 repair attempts');
    }

    this.repairCount++;
    await this.completeStep('review_tests');

    // repairing
    await this.transition('repairing', `repair_${this.repairCount}`, `Repair attempt ${this.repairCount}/2`);
    this.emit({ type: 'repair_started', attempt: this.repairCount, maxAttempts: 2 });

    // Feed the failing output back to Claude and let it propose repair edits
    const repairMessages: Anthropic.MessageParam[] = [
      {
        role: 'user',
        content: `The tests failed. Exit code: ${result.exitCode}.\n\nSTDOUT:\n${result.stdout}\n\nSTDERR:\n${result.stderr}\n\nPlease analyze the failures and propose file edits to fix them.`,
      },
    ];

    const tracingExecutor = async (name: string, args: Record<string, unknown>): Promise<string> => {
      if (name === 'propose_file_edit') {
        return await this.handleProposeFileEdit(args);
      }
      const output = await this.mcpClientManager.callTool(name, args);
      this.emit({ type: 'tool_called', name, input: args, output });
      return output;
    };

    await this.claudeService.sendWithTools(repairMessages, PHASE_3_TOOLS, tracingExecutor, undefined, (i, o) => this.onUsage(i, o));

    // Re-run edit approval gate for repair edits
    const repairEdits = await this.prisma.fileChange.findMany({
      where: { runId: this.runId, approved: null },
    });

    if (repairEdits.length > 0) {
      await this.transition('waiting_for_edit_approval', 'await_repair_edit_approval', 'Waiting for repair edit approval');
      const { approved: approvedIds, rejected: rejectedIds } = await this.waitForEditApprovals();
      await this.completeStep('await_repair_edit_approval');

      const validator = new PathValidator(this.repoPath);
      for (const changeId of approvedIds) {
        const fc = repairEdits.find((e) => e.id === changeId);
        if (!fc || !fc.proposedContent) continue;
        const absPath = validator.validate(fc.filePath);
        await writeFile(absPath, fc.proposedContent, 'utf8');
        await this.prisma.fileChange.update({
          where: { id: changeId },
          data: { approved: true, writtenAt: new Date() },
        });
      }
      for (const changeId of rejectedIds) {
        await this.prisma.fileChange.update({
          where: { id: changeId },
          data: { approved: false },
        });
      }
    }

    await this.completeStep(`repair_${this.repairCount}`);

    // Recurse — re-enter waiting_for_test_run_approval for human gate on each attempt
    await this.runTestPhase(lastPlanMessage);
  }

  // ---------------------------------------------------------------------------
  // Phase 4 — PR approval gate and opening_pr execution sequence
  // ---------------------------------------------------------------------------

  private async runPRPhase(lastPlanMessage: Anthropic.MessageParam): Promise<void> {
    // Gather approved files for the PR body
    const approvedFiles = await this.prisma.fileChange.findMany({
      where: { runId: this.runId, approved: true },
      select: { filePath: true },
    });
    const changedFiles = approvedFiles.map((f) => f.filePath);

    // Resolve the run's task description for PR title/body
    const run = await this.prisma.agentRun.findUniqueOrThrow({ where: { id: this.runId } });
    const { title: prTitle, body: prBody } = composePRTitleAndBody(
      run.taskDescription,
      this.runId,
      changedFiles,
      true,
    );

    // Enter waiting_for_pr_approval and emit SSE
    await this.transition('waiting_for_pr_approval', 'await_pr_approval', 'Waiting for PR approval');
    this.emit({ type: 'approval_required', approvalType: 'pr', prTitle, prBody });

    const approved = await this.waitForPRApproval!();

    if (!approved) {
      // Reject path (ADR-5): delete branch best-effort only if it was pushed, then cancel
      if (this.branchPushed && this.githubService && this.owner && this.repo && run.branchName) {
        try {
          await this.githubService.deleteBranch(this.owner, this.repo, run.branchName, this.githubToken ?? '');
        } catch {
          // Non-fatal — deletion failure must not block the cancelled transition
        }
      }
      await this.completeStep('await_pr_approval');
      await this.cancel();
      this.emit({ type: 'run_cancelled' });
      return;
    }

    await this.completeStep('await_pr_approval');

    // approved → opening_pr
    await this.transition('opening_pr', 'open_pr', 'Opening pull request');

    try {
      // Ensure branch exists (createBranch is idempotent in our flow)
      const branchName = run.branchName ?? `repo-pilot/${this.runId}`;
      await this.githubService!.createBranch(this.repoPath, branchName);

      await this.githubService!.commitChanges(this.repoPath, this.runId, prTitle);

      await this.githubService!.pushBranch(
        this.repoPath,
        this.owner!,
        this.repo!,
        branchName,
        this.githubToken!,
      );
      this.branchPushed = true;

      const base = await this.githubService!.getDefaultBranch(this.owner!, this.repo!, this.githubToken!);

      const { url: prUrl, number: prNumber } = await this.githubService!.openPullRequest(
        this.owner!,
        this.repo!,
        branchName,
        base,
        prTitle,
        prBody,
        this.githubToken!,
      );

      // Persist PR record so Phase 5 / REST endpoints can read durable PR state
      await this.prisma.pullRequest.upsert({
        where: { runId: this.runId },
        create: {
          runId: this.runId,
          githubPrNumber: prNumber,
          githubPrUrl: prUrl,
          title: prTitle,
          body: prBody,
          branchName,
          status: 'open',
        },
        update: {
          githubPrNumber: prNumber,
          githubPrUrl: prUrl,
          status: 'open',
        },
      });

      await this.completeStep('open_pr');
      await this.transition('complete', 'finalize', 'Run complete');
      await this.completeStep('finalize');

      await this.persistTokenTotals();
      this.emit({ type: 'pr_opened', prUrl, prNumber });
      this.emit({ type: 'run_completed', planJson: lastPlanMessage.content, prUrl });
    } catch (err) {
      // Any failure in opening_pr → failed (standard error path handles state + SSE)
      throw err;
    }
  }

  /** Persist terminal `cancelled` state and close running steps — mirrors `fail()` */
  private async cancel(): Promise<void> {
    try {
      await this.prisma.agentRun.update({
        where: { id: this.runId },
        data: { currentState: 'cancelled' },
      });
      await this.prisma.agentStep.updateMany({
        where: { runId: this.runId, status: 'running' },
        data: { status: 'completed', completedAt: new Date() },
      });
      this.emit({ type: 'state_changed', state: 'cancelled' });
    } catch {
      // best-effort — caller must not be blocked
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

    const normalizedOriginal = originalContent.replace(/\r\n/g, '\n');
    const normalizedProposed = proposedContent.replace(/\r\n/g, '\n');

    console.log(`[propose_file_edit] path=${filePath} originalLen=${normalizedOriginal.length} proposedLen=${normalizedProposed.length} same=${normalizedOriginal === normalizedProposed}`);

    const diff = createPatch(filePath, normalizedOriginal, normalizedProposed, '', '');

    const fileChange = await this.prisma.fileChange.create({
      data: {
        runId: this.runId,
        filePath,
        changeType: normalizedOriginal === '' ? 'create' : 'edit',
        originalContent: normalizedOriginal,
        proposedContent: normalizedProposed,
        diffContent: diff,
      },
    });

    this.emit({ type: 'edit_proposed', changeId: fileChange.id, filePath, diff, originalContent: normalizedOriginal, proposedContent: normalizedProposed });

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
      // Phase 5 T05: persist token totals before marking the run failed
      await this.persistTokenTotals();
      await this.prisma.agentRun.update({
        where: { id: this.runId },
        data: { currentState: 'failed' },
      });
      await this.prisma.agentStep.updateMany({
        where: { runId: this.runId, status: 'running' },
        data: { status: 'failed', errorMessage },
      });
      // Emit so SSE consumers and tests see the state transition
      this.emit({ type: 'state_changed', state: 'failed' });
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

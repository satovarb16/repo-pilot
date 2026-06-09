import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PrismaClient } from '@prisma/client';
import { AgentStateMachine } from './agent-state-machine.js';
import type { AgentSSEEvent } from './agent-state-machine.js';
import type { SandboxRunner, TestRunResult } from './sandbox-runner.js';

// Default no-op approval callbacks for integration tests (plan always approved, no edits pending)
const noopPlanApproval = vi.fn().mockResolvedValue(true);
const noopEditApprovals = vi.fn().mockResolvedValue({ approved: [], rejected: [] });
const noopTestRunApproval = vi.fn().mockResolvedValue(true);

// Minimal SandboxRunner mock that returns a passing result
const makeMockSandboxRunner = (overrides?: Partial<TestRunResult>): SandboxRunner =>
  ({
    run: vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: 'Tests passed',
      stderr: '',
      durationMs: 500,
      sandboxed: false,
      timedOut: false,
      dockerImage: null,
      ...overrides,
    }),
  }) as unknown as SandboxRunner;

// Mock OllamaService and MCPClientManager — only DB interaction is real
const mockCallTool = vi.fn().mockResolvedValue('src/index.ts\npackage.json\nREADME.md');
const mockStart = vi.fn().mockResolvedValue(undefined);
const mockStop = vi.fn().mockResolvedValue(undefined);
const mockMCP = { start: mockStart, callTool: mockCallTool, stop: mockStop } as any;

// Return LLMMessage shapes (string content — OpenAI/Ollama native format)
const mockSendWithTools = vi.fn().mockResolvedValue([
  { role: 'user', content: 'Add a feature' },
  {
    role: 'assistant',
    content: '1. Write failing test\n2. Implement\n3. Commit',
  },
]);
const mockOllama = { sendWithTools: mockSendWithTools } as any;

const prisma = new PrismaClient();

let userId: string;
let repoId: string;
let runId: string;

beforeAll(async () => {
  const user = await prisma.user.create({ data: {} });
  userId = user.id;

  const repo = await prisma.repository.create({
    data: {
      userId,
      githubRepoId: 88888,
      owner: 'test-owner',
      name: 'test-repo',
      cloneUrl: 'https://github.com/test/test-repo',
      encryptedToken: 'fake-encrypted-token-for-tests',
    },
  });
  repoId = repo.id;
});

afterAll(async () => {
  await prisma.agentStep.deleteMany({ where: { run: { userId } } });
  await prisma.fileChange.deleteMany({ where: { run: { userId } } });
  await prisma.agentRun.deleteMany({ where: { userId } });
  await prisma.repository.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  vi.clearAllMocks();
  mockCallTool.mockResolvedValue('src/index.ts\npackage.json\nREADME.md');
  mockSendWithTools.mockResolvedValue([
    { role: 'user', content: 'Add a feature' },
    {
      role: 'assistant',
      content: '1. Write test\n2. Implement\n3. Commit',
    },
  ]);
  noopPlanApproval.mockResolvedValue(true);
  noopEditApprovals.mockResolvedValue({ approved: [], rejected: [] });

  const run = await prisma.agentRun.create({
    data: { userId, repoId, taskDescription: 'Add search feature', currentState: 'idle' },
  });
  runId = run.id;
});

afterEach(async () => {
  await prisma.agentStep.deleteMany({ where: { runId } });
  await prisma.fileChange.deleteMany({ where: { runId } });
  await prisma.testRun.deleteMany({ where: { runId } });
  await prisma.agentRun.deleteMany({ where: { id: runId } });
});

/** Helper — builds an SM with real DB and the default no-op approval callbacks */
function makeSM(emitter?: EventEmitter, sandboxRunner?: SandboxRunner) {
  return new AgentStateMachine(
    runId,
    prisma,
    mockOllama,
    mockMCP,
    '/tmp/repo',
    noopPlanApproval,
    noopEditApprovals,
    sandboxRunner ?? makeMockSandboxRunner(),
    'npm test',
    noopTestRunApproval,
    emitter,
  );
}

describe('AgentStateMachine', () => {
  it('reaches a terminal state after start() (not idle)', async () => {
    const sm = makeSM();
    await sm.start();

    const run = await prisma.agentRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run.currentState).not.toBe('idle');
  });

  it('creates AgentStep records for analyze_repo, generate_plan, save_plan', async () => {
    const sm = makeSM();
    await sm.start();

    const steps = await prisma.agentStep.findMany({ where: { runId }, orderBy: { stepNumber: 'asc' } });
    const stepTypes = steps.map((s) => s.stepType);
    expect(stepTypes).toContain('analyze_repo');
    expect(stepTypes).toContain('generate_plan');
    expect(stepTypes).toContain('save_plan');
    expect(steps.every((s) => s.status === 'completed')).toBe(true);
  });

  it('saves planJson to AgentRun', async () => {
    const sm = makeSM();
    await sm.start();

    const run = await prisma.agentRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run.planJson).not.toBeNull();
  });

  it('transitions to failed when MCPClientManager throws', async () => {
    mockCallTool.mockRejectedValueOnce(new Error('spawn failed'));

    const sm = makeSM();
    await expect(sm.start()).rejects.toThrow('spawn failed');

    const run = await prisma.agentRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run.currentState).toBe('failed');

    const failedStep = await prisma.agentStep.findFirst({
      where: { runId, status: 'failed' },
    });
    expect(failedStep?.errorMessage).toContain('spawn failed');
  });

  it('transitions to failed when OllamaService throws', async () => {
    mockSendWithTools.mockRejectedValueOnce(new Error('Ollama API error'));

    const sm = makeSM();
    await expect(sm.start()).rejects.toThrow('Claude API error');

    const run = await prisma.agentRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run.currentState).toBe('failed');
  });

  it('second start() call is queued, not interleaved', async () => {
    const sm = makeSM();
    const p1 = sm.start();
    const p2 = sm.start();
    await Promise.allSettled([p1, p2]);

    const steps = await prisma.agentStep.findMany({ where: { runId } });
    expect(steps.length).toBeGreaterThanOrEqual(3);
  });

  it('emits state_changed events including key states', async () => {
    const emitter = new EventEmitter();
    const events: AgentSSEEvent[] = [];
    emitter.on('event', (e: AgentSSEEvent) => events.push(e));

    const sm = makeSM(emitter);
    await sm.start();

    const stateEvents = events
      .filter((e) => e.type === 'state_changed')
      .map((e) => (e as { type: 'state_changed'; state: string }).state);

    expect(stateEvents).toContain('analyzing_repo');
    expect(stateEvents).toContain('planning');
    expect(stateEvents).toContain('waiting_for_plan_approval');
    expect(stateEvents).toContain('editing');
  });

  it('emits step_started and step_completed for core planning steps', async () => {
    const emitter = new EventEmitter();
    const events: AgentSSEEvent[] = [];
    emitter.on('event', (e: AgentSSEEvent) => events.push(e));

    const sm = makeSM(emitter);
    await sm.start();

    const started = events.filter((e) => e.type === 'step_started').map((e) => (e as any).stepType);
    const completed = events.filter((e) => e.type === 'step_completed').map((e) => (e as any).stepType);

    expect(started).toContain('analyze_repo');
    expect(started).toContain('generate_plan');
    expect(started).toContain('save_plan');
    expect(completed).toContain('analyze_repo');
    expect(completed).toContain('generate_plan');
    expect(completed).toContain('save_plan');
  });

  it('emits tool_called events for MCP tool calls', async () => {
    const emitter = new EventEmitter();
    const events: AgentSSEEvent[] = [];
    emitter.on('event', (e: AgentSSEEvent) => events.push(e));

    const sm = makeSM(emitter);
    await sm.start();

    const toolEvents = events.filter((e) => e.type === 'tool_called');
    expect(toolEvents.length).toBeGreaterThan(0);
    const first = toolEvents[0] as { type: 'tool_called'; name: string; input: unknown; output: string };
    expect(first.name).toBe('list_files');
  });

  it('emits run_completed with planJson on success', async () => {
    const emitter = new EventEmitter();
    const events: AgentSSEEvent[] = [];
    emitter.on('event', (e: AgentSSEEvent) => events.push(e));

    const sm = makeSM(emitter);
    await sm.start();

    const completedEvent = events.find((e) => e.type === 'run_completed') as
      | { type: 'run_completed'; planJson: unknown }
      | undefined;
    expect(completedEvent).toBeDefined();
    expect(completedEvent?.planJson).not.toBeNull();
  });

  it('emits run_failed on error', async () => {
    const emitter = new EventEmitter();
    const events: AgentSSEEvent[] = [];
    emitter.on('event', (e: AgentSSEEvent) => events.push(e));

    mockCallTool.mockRejectedValueOnce(new Error('mcp error'));

    const sm = makeSM(emitter);
    await expect(sm.start()).rejects.toThrow('mcp error');

    const failedEvent = events.find((e) => e.type === 'run_failed') as
      | { type: 'run_failed'; error: string }
      | undefined;
    expect(failedEvent).toBeDefined();
    expect(failedEvent?.error).toContain('mcp error');
  });
});

// ---------------------------------------------------------------------------
// Plan approval gate — unit tests with fully mocked Prisma + Claude + MCP
// ---------------------------------------------------------------------------

const makePrisma = (overrides?: object) => ({
  agentRun: {
    findUniqueOrThrow: vi.fn().mockResolvedValue({
      id: 'run-1',
      taskDescription: 'fix the bug',
      planJson: null,
    }),
    update: vi.fn().mockResolvedValue({}),
  },
  agentStep: {
    create: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({}),
  },
  fileChange: {
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ id: 'fc-1', filePath: 'src/foo.ts' }),
    update: vi.fn().mockResolvedValue({}),
  },
  testRun: {
    create: vi.fn().mockResolvedValue({
      id: 'tr-mock-1',
      command: 'npm test',
      status: 'passed',
      exitCode: 0,
    }),
  },
  pullRequest: {
    upsert: vi.fn().mockResolvedValue({}),
  },
  ...overrides,
});

// Returns LLMMessage shapes (string content — OllamaService native format)
const makeClaude = (planText = 'Step 1: analyze\nStep 2: edit') => ({
  sendWithTools: vi.fn().mockResolvedValue([
    { role: 'user', content: 'Task: fix the bug' },
    { role: 'assistant', content: planText },
  ]),
});

const makeMCP = () => ({
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
  callTool: vi.fn().mockResolvedValue('file1.ts\nfile2.ts'),
});

describe('AgentStateMachine plan approval gate', () => {
  it('emits approval_required with planText after generating plan', async () => {
    const emitter = new EventEmitter()
    const events: unknown[] = []
    emitter.on('event', (e) => events.push(e))

    const waitForPlanApproval = vi.fn().mockResolvedValue(true)
    const waitForEditApprovals = vi.fn().mockResolvedValue({ approved: [], rejected: [] })

    const sm = new AgentStateMachine(
      'run-1',
      makePrisma() as never,
      makeClaude() as never,
      makeMCP() as never,
      '/tmp/repo',
      waitForPlanApproval,
      waitForEditApprovals,
      makeMockSandboxRunner() as never,
      'npm test',
      noopTestRunApproval,
      emitter,
    )

    await sm.start()

    const approvalEvent = events.find(
      (e: any) => e.type === 'approval_required' && e.approvalType === 'plan',
    )
    expect(approvalEvent).toBeDefined()
    expect((approvalEvent as any).planText).toContain('Step 1')
    expect(waitForPlanApproval).toHaveBeenCalledOnce()
  })

  it('transitions to failed state when plan is rejected', async () => {
    const prismaFake = makePrisma()
    const waitForPlanApproval = vi.fn().mockResolvedValue(false)
    const waitForEditApprovals = vi.fn().mockResolvedValue({ approved: [], rejected: [] })

    const sm = new AgentStateMachine(
      'run-1',
      prismaFake as never,
      makeClaude() as never,
      makeMCP() as never,
      '/tmp/repo',
      waitForPlanApproval,
      waitForEditApprovals,
      makeMockSandboxRunner() as never,
      'npm test',
      noopTestRunApproval,
    )

    await expect(sm.start()).rejects.toThrow('Plan rejected')
    expect(prismaFake.agentRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { currentState: 'failed' } }),
    )
  })

  it('continues to editing state when plan is approved', async () => {
    const prismaFake = makePrisma()
    const waitForPlanApproval = vi.fn().mockResolvedValue(true)
    const waitForEditApprovals = vi.fn().mockResolvedValue({ approved: [], rejected: [] })
    const claude = makeClaude()

    const sm = new AgentStateMachine(
      'run-1',
      prismaFake as never,
      claude as never,
      makeMCP() as never,
      '/tmp/repo',
      waitForPlanApproval,
      waitForEditApprovals,
      makeMockSandboxRunner() as never,
      'npm test',
      noopTestRunApproval,
    )

    await sm.start()

    // sendWithTools called twice: once for planning, once for editing
    expect(claude.sendWithTools).toHaveBeenCalledTimes(2)
  })
})

// ---------------------------------------------------------------------------
// D1-3.1 — Phase 3 state machine tests (test run, repair loop, guards)
// These tests use fully mocked Prisma + Claude + MCP + SandboxRunner
// ---------------------------------------------------------------------------

// makePrismaWithTestRun now just uses makePrisma which already has testRun
const makePrismaWithTestRun = (overrides?: object) => makePrisma(overrides);

describe('AgentStateMachine Phase 3 — test run flow', () => {
  it('happy path: state sequence includes waiting_for_test_run_approval → running_tests → reviewing', async () => {
    const prismaFake = makePrismaWithTestRun()
    const emitter = new EventEmitter()
    const states: string[] = []
    emitter.on('event', (e: AgentSSEEvent) => {
      if (e.type === 'state_changed') states.push(e.state)
    })

    const waitForTestRunApproval = vi.fn().mockResolvedValue(true)

    const sm = new AgentStateMachine(
      'run-1',
      prismaFake as never,
      makeClaude() as never,
      makeMCP() as never,
      '/tmp/repo',
      vi.fn().mockResolvedValue(true),
      vi.fn().mockResolvedValue({ approved: [], rejected: [] }),
      makeMockSandboxRunner() as never,
      'npm test',
      waitForTestRunApproval,
      emitter,
    )

    await sm.start()

    expect(states).toContain('waiting_for_test_run_approval')
    expect(states).toContain('running_tests')
    expect(states).toContain('reviewing')
    expect(waitForTestRunApproval).toHaveBeenCalledOnce()
  })

  it('emits test_run_started and test_run_completed events', async () => {
    const prismaFake = makePrismaWithTestRun()
    const emitter = new EventEmitter()
    const events: AgentSSEEvent[] = []
    emitter.on('event', (e: AgentSSEEvent) => events.push(e))

    const sm = new AgentStateMachine(
      'run-1',
      prismaFake as never,
      makeClaude() as never,
      makeMCP() as never,
      '/tmp/repo',
      vi.fn().mockResolvedValue(true),
      vi.fn().mockResolvedValue({ approved: [], rejected: [] }),
      makeMockSandboxRunner() as never,
      'npm test',
      vi.fn().mockResolvedValue(true),
      emitter,
    )

    await sm.start()

    expect(events.some((e) => e.type === 'test_run_started')).toBe(true)
    expect(events.some((e) => e.type === 'test_run_completed')).toBe(true)
  })

  it('user rejection at test-run gate ends gracefully without failing', async () => {
    const prismaFake = makePrismaWithTestRun()
    const emitter = new EventEmitter()
    const events: AgentSSEEvent[] = []
    emitter.on('event', (e: AgentSSEEvent) => events.push(e))

    const sm = new AgentStateMachine(
      'run-1',
      prismaFake as never,
      makeClaude() as never,
      makeMCP() as never,
      '/tmp/repo',
      vi.fn().mockResolvedValue(true),
      vi.fn().mockResolvedValue({ approved: [], rejected: [] }),
      makeMockSandboxRunner() as never,
      'npm test',
      vi.fn().mockResolvedValue(false), // user rejects test run
      emitter,
    )

    // Should NOT throw — rejection is a graceful end
    await sm.start()

    // run_completed should fire (graceful end)
    expect(events.some((e) => e.type === 'run_completed')).toBe(true)
  })

  it('repair loop: fail once → repairing state → run again → complete', async () => {
    const prismaFake = makePrismaWithTestRun()
    const emitter = new EventEmitter()
    const states: string[] = []
    emitter.on('event', (e: AgentSSEEvent) => {
      if (e.type === 'state_changed') states.push(e.state)
    })

    // First run fails, second passes
    const failingSandbox = {
      run: vi.fn()
        .mockResolvedValueOnce({
          exitCode: 1, stdout: '', stderr: 'Error', durationMs: 100,
          sandboxed: false, timedOut: false, dockerImage: null,
        })
        .mockResolvedValueOnce({
          exitCode: 0, stdout: 'Pass', stderr: '', durationMs: 100,
          sandboxed: false, timedOut: false, dockerImage: null,
        }),
    } as unknown as SandboxRunner

    // testRun.create returns failed then passed
    const prismaRepair = makePrisma({
      testRun: {
        create: vi.fn()
          .mockResolvedValueOnce({ id: 'tr-1', status: 'failed', exitCode: 1 })
          .mockResolvedValueOnce({ id: 'tr-2', status: 'passed', exitCode: 0 }),
      },
    })

    const sm = new AgentStateMachine(
      'run-1',
      prismaRepair as never,
      makeClaude() as never,
      makeMCP() as never,
      '/tmp/repo',
      vi.fn().mockResolvedValue(true),
      vi.fn().mockResolvedValue({ approved: [], rejected: [] }),
      failingSandbox,
      'npm test',
      vi.fn().mockResolvedValue(true),
      emitter,
    )

    await sm.start()

    expect(states).toContain('repairing')
    expect(states).toContain('reviewing')
    // Should end in complete, not failed
    const lastState = states[states.length - 1]
    expect(lastState).toBe('complete')
  })

  it('repair guard: repairCount >= 2 → transitions to failed', async () => {
    // Always fails
    const alwaysFailSandbox = {
      run: vi.fn().mockResolvedValue({
        exitCode: 1, stdout: '', stderr: 'Fail', durationMs: 100,
        sandboxed: false, timedOut: false, dockerImage: null,
      }),
    } as unknown as SandboxRunner

    const prismaRepair = makePrisma({
      testRun: {
        create: vi.fn().mockResolvedValue({ id: 'tr-1', status: 'failed', exitCode: 1 }),
      },
    })

    const sm = new AgentStateMachine(
      'run-1',
      prismaRepair as never,
      makeClaude() as never,
      makeMCP() as never,
      '/tmp/repo',
      vi.fn().mockResolvedValue(true),
      vi.fn().mockResolvedValue({ approved: [], rejected: [] }),
      alwaysFailSandbox,
      'npm test',
      vi.fn().mockResolvedValue(true),
    )

    await expect(sm.start()).rejects.toThrow(/repair/i)
  })

  it('emits repair_completed after each repair iteration', async () => {
    const prismaFake = makePrismaWithTestRun({
      testRun: {
        create: vi.fn()
          .mockResolvedValueOnce({ id: 'tr-1', status: 'failed', exitCode: 1 })
          .mockResolvedValueOnce({ id: 'tr-2', status: 'passed', exitCode: 0 }),
      },
    })
    const emitter = new EventEmitter()
    const events: AgentSSEEvent[] = []
    emitter.on('event', (e: AgentSSEEvent) => events.push(e))

    const failingSandbox = {
      run: vi.fn()
        .mockResolvedValueOnce({
          exitCode: 1, stdout: '', stderr: 'Error', durationMs: 100,
          sandboxed: false, timedOut: false, dockerImage: null,
        })
        .mockResolvedValueOnce({
          exitCode: 0, stdout: 'Pass', stderr: '', durationMs: 100,
          sandboxed: false, timedOut: false, dockerImage: null,
        }),
    } as unknown as SandboxRunner

    const sm = new AgentStateMachine(
      'run-1',
      prismaFake as never,
      makeClaude() as never,
      makeMCP() as never,
      '/tmp/repo',
      vi.fn().mockResolvedValue(true),
      vi.fn().mockResolvedValue({ approved: [], rejected: [] }),
      failingSandbox,
      'npm test',
      vi.fn().mockResolvedValue(true),
      emitter,
    )

    await sm.start()

    const repairCompletedEvents = events.filter((e) => e.type === 'repair_completed') as Array<{
      type: 'repair_completed'; runId: string; attempt: number; success: boolean
    }>
    expect(repairCompletedEvents.length).toBeGreaterThanOrEqual(1)
    // First repair iteration failed → second run passed → repair_completed with success: true on pass
    const successEvent = repairCompletedEvents.find((e) => e.success === true)
    expect(successEvent).toBeDefined()
  })

  it('emits test_output_chunk events during test run', async () => {
    const prismaFake = makePrismaWithTestRun()
    const emitter = new EventEmitter()
    const events: AgentSSEEvent[] = []
    emitter.on('event', (e: AgentSSEEvent) => events.push(e))

    // SandboxRunner that calls onChunk
    const chunkingSandbox = {
      run: vi.fn().mockImplementation(async (_opts: unknown, onChunk?: (c: string) => void) => {
        onChunk?.('chunk A');
        onChunk?.('chunk B');
        return {
          exitCode: 0, stdout: 'chunk A chunk B', stderr: '',
          durationMs: 50, sandboxed: false, timedOut: false, dockerImage: null,
        };
      }),
    } as unknown as SandboxRunner

    const sm = new AgentStateMachine(
      'run-1',
      prismaFake as never,
      makeClaude() as never,
      makeMCP() as never,
      '/tmp/repo',
      vi.fn().mockResolvedValue(true),
      vi.fn().mockResolvedValue({ approved: [], rejected: [] }),
      chunkingSandbox,
      'npm test',
      vi.fn().mockResolvedValue(true),
      emitter,
    )

    await sm.start()

    const chunkEvents = events.filter((e) => e.type === 'test_output_chunk') as Array<{
      type: 'test_output_chunk'; runId: string; chunk: string
    }>
    expect(chunkEvents.length).toBe(2)
    expect(chunkEvents[0].chunk).toBe('chunk A')
    expect(chunkEvents[1].chunk).toBe('chunk B')
    expect(chunkEvents[0].runId).toBe('run-1')
  })

  it('repairCount starts at 0 per new instance', () => {
    const sm = new AgentStateMachine(
      'run-1',
      makePrismaWithTestRun() as never,
      makeClaude() as never,
      makeMCP() as never,
      '/tmp/repo',
      vi.fn().mockResolvedValue(true),
      vi.fn().mockResolvedValue({ approved: [], rejected: [] }),
      makeMockSandboxRunner() as never,
      'npm test',
      vi.fn().mockResolvedValue(true),
    )
    // Access private field via cast — this is a white-box invariant test
    expect((sm as any).repairCount).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// D1-8 + D1-9 — PR approval gate and opening_pr execution sequence
// These tests use fully mocked GitHubService so no real git/Octokit calls are made
// ---------------------------------------------------------------------------

/** Minimal GitHubService stub — all methods return happy defaults */
const makeGitHubService = (overrides?: {
  getDefaultBranch?: ReturnType<typeof vi.fn>;
  commitChanges?: ReturnType<typeof vi.fn>;
  pushBranch?: ReturnType<typeof vi.fn>;
  openPullRequest?: ReturnType<typeof vi.fn>;
  deleteBranch?: ReturnType<typeof vi.fn>;
  createBranch?: ReturnType<typeof vi.fn>;
}) => ({
  cloneRepo: vi.fn(),
  createBranch: overrides?.createBranch ?? vi.fn().mockResolvedValue(undefined),
  getDefaultBranch: overrides?.getDefaultBranch ?? vi.fn().mockResolvedValue('main'),
  commitChanges: overrides?.commitChanges ?? vi.fn().mockResolvedValue({ commitSha: 'sha123' }),
  pushBranch: overrides?.pushBranch ?? vi.fn().mockResolvedValue(undefined),
  openPullRequest:
    overrides?.openPullRequest ??
    vi.fn().mockResolvedValue({ url: 'https://github.com/o/r/pull/1', number: 1 }),
  deleteBranch: overrides?.deleteBranch ?? vi.fn().mockResolvedValue(undefined),
})

/** Build a full SM with PR approval params */
function makeSMWithPR(opts: {
  waitForPRApproval: () => Promise<boolean>;
  githubService?: ReturnType<typeof makeGitHubService>;
  emitter?: EventEmitter;
}) {
  return new AgentStateMachine(
    'run-1',
    makePrisma() as never,
    makeClaude() as never,
    makeMCP() as never,
    '/tmp/repo',
    vi.fn().mockResolvedValue(true),       // waitForPlanApproval
    vi.fn().mockResolvedValue({ approved: [], rejected: [] }), // waitForEditApprovals
    makeMockSandboxRunner() as never,
    'npm test',
    vi.fn().mockResolvedValue(true),       // waitForTestRunApproval (approve tests)
    opts.emitter,
    opts.waitForPRApproval,
    opts.githubService as never ?? makeGitHubService() as never,
    'test-github-token',
    'test-owner',
    'test-repo',
  )
}

describe('AgentStateMachine PR approval gate (D1-8)', () => {
  it('transitions to waiting_for_pr_approval after reviewing with passing tests', async () => {
    const emitter = new EventEmitter()
    const states: string[] = []
    emitter.on('event', (e: AgentSSEEvent) => {
      if (e.type === 'state_changed') states.push(e.state)
    })

    let resolveApproval!: (v: boolean) => void
    const waitForPRApproval = vi.fn().mockImplementation(
      () => new Promise<boolean>((res) => { resolveApproval = res }),
    )

    const sm = makeSMWithPR({ waitForPRApproval, emitter })

    // Start async, then resolve PR approval
    const runPromise = sm.start()
    await vi.waitFor(() => expect(waitForPRApproval).toHaveBeenCalled(), { timeout: 5000 })
    resolveApproval(true)
    await runPromise

    expect(states).toContain('waiting_for_pr_approval')
  })

  it('emits approval_required with approvalType pr when entering waiting_for_pr_approval', async () => {
    const emitter = new EventEmitter()
    const events: AgentSSEEvent[] = []
    emitter.on('event', (e: AgentSSEEvent) => events.push(e))

    let resolveApproval!: (v: boolean) => void
    const waitForPRApproval = vi.fn().mockImplementation(
      () => new Promise<boolean>((res) => { resolveApproval = res }),
    )

    const sm = makeSMWithPR({ waitForPRApproval, emitter })
    const runPromise = sm.start()
    await vi.waitFor(() => expect(waitForPRApproval).toHaveBeenCalled(), { timeout: 5000 })
    resolveApproval(true)
    await runPromise

    const prApprovalEvent = events.find(
      (e) => e.type === 'approval_required' && (e as any).approvalType === 'pr',
    )
    expect(prApprovalEvent).toBeDefined()
    expect((prApprovalEvent as any).prTitle).toBeDefined()
    expect((prApprovalEvent as any).prBody).toBeDefined()
  })

  it('transitions to cancelled and emits run_cancelled when PR is rejected', async () => {
    const emitter = new EventEmitter()
    const states: string[] = []
    const events: AgentSSEEvent[] = []
    emitter.on('event', (e: AgentSSEEvent) => {
      if (e.type === 'state_changed') states.push(e.state)
      events.push(e)
    })

    const sm = makeSMWithPR({
      waitForPRApproval: vi.fn().mockResolvedValue(false),
      emitter,
    })

    await sm.start()

    expect(states).toContain('cancelled')
    expect(events.some((e) => e.type === 'run_cancelled')).toBe(true)
    // cancelled is terminal — no 'opening_pr' state
    expect(states).not.toContain('opening_pr')
  })

  it('cancelled is terminal — no further state transitions after cancelled', async () => {
    const emitter = new EventEmitter()
    const states: string[] = []
    emitter.on('event', (e: AgentSSEEvent) => {
      if (e.type === 'state_changed') states.push(e.state)
    })

    const sm = makeSMWithPR({
      waitForPRApproval: vi.fn().mockResolvedValue(false),
      emitter,
    })

    await sm.start()

    const cancelledIdx = states.indexOf('cancelled')
    expect(cancelledIdx).toBeGreaterThanOrEqual(0)
    // No states come after cancelled
    expect(states.slice(cancelledIdx + 1)).toHaveLength(0)
  })
})

describe('AgentStateMachine opening_pr execution sequence (D1-9)', () => {
  it('full happy path: opening_pr → complete, emits pr_opened and run_completed with prUrl', async () => {
    const emitter = new EventEmitter()
    const states: string[] = []
    const events: AgentSSEEvent[] = []
    emitter.on('event', (e: AgentSSEEvent) => {
      if (e.type === 'state_changed') states.push(e.state)
      events.push(e)
    })

    const gh = makeGitHubService()
    const sm = makeSMWithPR({
      waitForPRApproval: vi.fn().mockResolvedValue(true),
      githubService: gh,
      emitter,
    })

    await sm.start()

    expect(states).toContain('opening_pr')
    expect(states).toContain('complete')
    const prOpened = events.find((e) => e.type === 'pr_opened')
    expect(prOpened).toBeDefined()
    expect((prOpened as any).prUrl).toBe('https://github.com/o/r/pull/1')
    expect((prOpened as any).prNumber).toBe(1)
    const runCompleted = events.find((e) => e.type === 'run_completed')
    expect((runCompleted as any).prUrl).toBe('https://github.com/o/r/pull/1')
  })

  it('calls createBranch → commitChanges → pushBranch → openPullRequest in sequence on approve', async () => {
    const gh = makeGitHubService()

    const sm = makeSMWithPR({
      waitForPRApproval: vi.fn().mockResolvedValue(true),
      githubService: gh,
    })

    await sm.start()

    expect(gh.createBranch).toHaveBeenCalled()
    expect(gh.commitChanges).toHaveBeenCalled()
    expect(gh.pushBranch).toHaveBeenCalled()
    expect(gh.openPullRequest).toHaveBeenCalled()
  })

  it('transitions to failed when commitChanges throws; openPullRequest NOT called', async () => {
    const gh = makeGitHubService({
      commitChanges: vi.fn().mockRejectedValue(new Error('commit failed')),
    })

    const emitter = new EventEmitter()
    const states: string[] = []
    emitter.on('event', (e: AgentSSEEvent) => {
      if (e.type === 'state_changed') states.push(e.state)
    })

    const sm = makeSMWithPR({
      waitForPRApproval: vi.fn().mockResolvedValue(true),
      githubService: gh,
      emitter,
    })

    await expect(sm.start()).rejects.toThrow('commit failed')
    expect(states).toContain('failed')
    expect(gh.openPullRequest).not.toHaveBeenCalled()
  })

  it('transitions to failed when pushBranch throws; openPullRequest NOT called', async () => {
    const gh = makeGitHubService({
      pushBranch: vi.fn().mockRejectedValue(new Error('push failed')),
    })

    const emitter = new EventEmitter()
    const states: string[] = []
    emitter.on('event', (e: AgentSSEEvent) => {
      if (e.type === 'state_changed') states.push(e.state)
    })

    const sm = makeSMWithPR({
      waitForPRApproval: vi.fn().mockResolvedValue(true),
      githubService: gh,
      emitter,
    })

    await expect(sm.start()).rejects.toThrow('push failed')
    expect(states).toContain('failed')
    expect(gh.openPullRequest).not.toHaveBeenCalled()
  })

  it('deleteBranch NOT called on rejection when branch was never pushed', async () => {
    const gh = makeGitHubService()

    const sm = makeSMWithPR({
      waitForPRApproval: vi.fn().mockResolvedValue(false),
      githubService: gh,
    })

    await sm.start()

    // branchPushed is false (push never happened since approval was rejected before opening_pr)
    expect(gh.deleteBranch).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Phase 5 T04 — SecretRedactor injection: tool_called input/output redaction
// ---------------------------------------------------------------------------
describe('AgentStateMachine Phase 5 T04 — tool_called redaction', () => {
  it('redacts secrets in tool_called input before SSE emission', async () => {
    const emitter = new EventEmitter()
    const events: AgentSSEEvent[] = []
    emitter.on('event', (e: AgentSSEEvent) => events.push(e))

    // Inject a secret via the MCP callTool stub output — but more importantly test input
    // We override the tool call so the input contains a known Stripe key
    const secretKey = 'sk_live_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef'
    const mcpWithSecret = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      // Return the secret in the output as well
      callTool: vi.fn().mockResolvedValue(`files: ${secretKey}`),
    }

    // Use a claude mock that triggers a tool call with a secret in the input
    const claudeWithToolCall = {
      sendWithTools: vi.fn().mockImplementation(
        async (
          _msgs: unknown,
          _tools: unknown,
          executor: (name: string, args: Record<string, unknown>) => Promise<string>,
        ) => {
          // Simulate Claude calling a tool with a secret in args
          await executor('read_file', { path: `secret=${secretKey}` })
          return [
            { role: 'user', content: 'task' },
            { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
          ]
        },
      ),
    }

    const { SecretRedactor } = await import('./secret-redactor.js')
    const redactor = new SecretRedactor()

    const sm = new AgentStateMachine(
      'run-1',
      makePrisma() as never,
      claudeWithToolCall as never,
      mcpWithSecret as never,
      '/tmp/repo',
      vi.fn().mockResolvedValue(true),
      vi.fn().mockResolvedValue({ approved: [], rejected: [] }),
      makeMockSandboxRunner() as never,
      'npm test',
      vi.fn().mockResolvedValue(true),
      emitter,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      redactor,
    )

    await sm.start()

    const toolEvents = events.filter((e) => e.type === 'tool_called') as Array<{
      type: 'tool_called'; name: string; input: unknown; output: string
    }>
    expect(toolEvents.length).toBeGreaterThan(0)

    const allToolJson = JSON.stringify(toolEvents)
    expect(allToolJson).not.toContain(secretKey)
    expect(allToolJson).toContain('[REDACTED]')
  })

  it('does not affect tool_called events when no secrets are present', async () => {
    const emitter = new EventEmitter()
    const events: AgentSSEEvent[] = []
    emitter.on('event', (e: AgentSSEEvent) => events.push(e))

    const { SecretRedactor } = await import('./secret-redactor.js')
    const redactor = new SecretRedactor()

    const sm = new AgentStateMachine(
      'run-1',
      makePrisma() as never,
      makeClaude() as never,
      makeMCP() as never,
      '/tmp/repo',
      vi.fn().mockResolvedValue(true),
      vi.fn().mockResolvedValue({ approved: [], rejected: [] }),
      makeMockSandboxRunner() as never,
      'npm test',
      vi.fn().mockResolvedValue(true),
      emitter,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      redactor,
    )

    await sm.start()

    const toolEvents = events.filter((e) => e.type === 'tool_called')
    expect(toolEvents.length).toBeGreaterThan(0)
    // No secrets → output should remain unchanged (e.g. 'file1.ts\nfile2.ts')
    const first = toolEvents[0] as { output: string }
    expect(first.output).toContain('file1.ts')
  })
})

// ---------------------------------------------------------------------------
// Phase 5 T05 — Token accumulation, token_usage SSE emission, DB persistence
// ---------------------------------------------------------------------------
describe('AgentStateMachine Phase 5 T05 — token accumulation and emission', () => {
  it('emits token_usage SSE event after each onUsage callback with running totals', async () => {
    const emitter = new EventEmitter()
    const events: AgentSSEEvent[] = []
    emitter.on('event', (e: AgentSSEEvent) => events.push(e))

    // Claude mock that triggers onUsage twice (two API calls: plan + edit)
    const claudeWithUsage = {
      sendWithTools: vi.fn().mockImplementation(
        async (
          _msgs: unknown,
          _tools: unknown,
          _executor: unknown,
          _system: unknown,
          onUsage?: (i: number, o: number) => void,
        ) => {
          onUsage?.(100, 50)
          return [
            { role: 'user', content: 'task' },
            { role: 'assistant', content: [{ type: 'text', text: 'plan done' }] },
          ]
        },
      ),
    }

    const sm = new AgentStateMachine(
      'run-1',
      makePrisma() as never,
      claudeWithUsage as never,
      makeMCP() as never,
      '/tmp/repo',
      vi.fn().mockResolvedValue(true),
      vi.fn().mockResolvedValue({ approved: [], rejected: [] }),
      makeMockSandboxRunner() as never,
      'npm test',
      vi.fn().mockResolvedValue(true),
      emitter,
    )

    await sm.start()

    const tokenEvents = events.filter((e) => e.type === 'token_usage') as Array<{
      type: 'token_usage'; inputTokens: number; outputTokens: number
    }>
    expect(tokenEvents.length).toBeGreaterThan(0)

    // First event should have 100/50 (from plan)
    expect(tokenEvents[0].inputTokens).toBe(100)
    expect(tokenEvents[0].outputTokens).toBe(50)

    // Second event should have 200/100 (cumulative after edit)
    if (tokenEvents.length >= 2) {
      expect(tokenEvents[1].inputTokens).toBe(200)
      expect(tokenEvents[1].outputTokens).toBe(100)
    }
  })

  it('persists final token totals on prisma.agentRun.update at run_completed', async () => {
    const prismaFake = makePrisma()

    const claudeWithUsage = {
      sendWithTools: vi.fn().mockImplementation(
        async (
          _msgs: unknown,
          _tools: unknown,
          _executor: unknown,
          _system: unknown,
          onUsage?: (i: number, o: number) => void,
        ) => {
          onUsage?.(200, 80)
          return [
            { role: 'user', content: 'task' },
            { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
          ]
        },
      ),
    }

    const sm = new AgentStateMachine(
      'run-1',
      prismaFake as never,
      claudeWithUsage as never,
      makeMCP() as never,
      '/tmp/repo',
      vi.fn().mockResolvedValue(true),
      vi.fn().mockResolvedValue({ approved: [], rejected: [] }),
      makeMockSandboxRunner() as never,
      'npm test',
      vi.fn().mockResolvedValue(true),
    )

    await sm.start()

    // Verify prisma.agentRun.update was called with token data at some point
    const updateCalls = (prismaFake.agentRun.update as ReturnType<typeof vi.fn>).mock.calls
    const tokenUpdateCall = updateCalls.find(
      (call: unknown[]) =>
        (call[0] as { data?: { inputTokens?: unknown } })?.data?.inputTokens !== undefined,
    )
    expect(tokenUpdateCall).toBeDefined()

    const updateData = (tokenUpdateCall![0] as { data: { inputTokens: number; outputTokens: number } }).data
    // sendWithTools is called twice (plan + edit), each fires onUsage(200, 80), total 400/160
    expect(updateData.inputTokens).toBe(400)
    expect(updateData.outputTokens).toBe(160)
  })
})

// ---------------------------------------------------------------------------
// D1-13 — Security: token never surfaces in SSE payloads
// ---------------------------------------------------------------------------
describe('security invariants (D1-13)', () => {
  it('no SSE event payload contains the PAT string', async () => {
    const TEST_PAT = 'ghp_supersecrettoken1234567890abcdef'
    const emitter = new EventEmitter()
    const events: AgentSSEEvent[] = []
    emitter.on('event', (e: AgentSSEEvent) => events.push(e))

    const sm = new AgentStateMachine(
      'run-1',
      makePrisma() as never,
      makeClaude() as never,
      makeMCP() as never,
      '/tmp/repo',
      vi.fn().mockResolvedValue(true),
      vi.fn().mockResolvedValue({ approved: [], rejected: [] }),
      makeMockSandboxRunner() as never,
      'npm test',
      vi.fn().mockResolvedValue(true),
      emitter,
      vi.fn().mockResolvedValue(true),
      makeGitHubService() as never,
      TEST_PAT,
      'owner',
      'repo',
    )

    await sm.start()

    // Serialize all events and assert the PAT never appears
    const allEventJson = JSON.stringify(events)
    expect(allEventJson).not.toContain(TEST_PAT)
  })
})

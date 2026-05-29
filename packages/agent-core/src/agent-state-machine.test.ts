import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PrismaClient } from '@prisma/client';
import { AgentStateMachine } from './agent-state-machine.js';
import type { AgentSSEEvent } from './agent-state-machine.js';

// Default no-op approval callbacks for integration tests (plan always approved, no edits pending)
const noopPlanApproval = vi.fn().mockResolvedValue(true);
const noopEditApprovals = vi.fn().mockResolvedValue({ approved: [], rejected: [] });

// Mock ClaudeService and MCPClientManager — only DB interaction is real
const mockCallTool = vi.fn().mockResolvedValue('src/index.ts\npackage.json\nREADME.md');
const mockStart = vi.fn().mockResolvedValue(undefined);
const mockStop = vi.fn().mockResolvedValue(undefined);
const mockMCP = { start: mockStart, callTool: mockCallTool, stop: mockStop } as any;

const mockSendWithTools = vi.fn().mockResolvedValue([
  { role: 'user', content: 'Add a feature' },
  {
    role: 'assistant',
    content: [{ type: 'text', text: '1. Write failing test\n2. Implement\n3. Commit' }],
  },
]);
const mockClaude = { sendWithTools: mockSendWithTools } as any;

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
      content: [{ type: 'text', text: '1. Write test\n2. Implement\n3. Commit' }],
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
  await prisma.agentRun.deleteMany({ where: { id: runId } });
});

/** Helper — builds an SM with real DB and the default no-op approval callbacks */
function makeSM(emitter?: EventEmitter) {
  return new AgentStateMachine(
    runId,
    prisma,
    mockClaude,
    mockMCP,
    '/tmp/repo',
    noopPlanApproval,
    noopEditApprovals,
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

  it('transitions to failed when ClaudeService throws', async () => {
    mockSendWithTools.mockRejectedValueOnce(new Error('Claude API error'));

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
  },
  ...overrides,
});

const makeClaude = (planText = 'Step 1: analyze\nStep 2: edit') => ({
  sendWithTools: vi.fn().mockResolvedValue([
    { role: 'user', content: 'Task: fix the bug' },
    { role: 'assistant', content: [{ type: 'text', text: planText }] },
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
    )

    await sm.start()

    // sendWithTools called twice: once for planning, once for editing
    expect(claude.sendWithTools).toHaveBeenCalledTimes(2)
  })
})

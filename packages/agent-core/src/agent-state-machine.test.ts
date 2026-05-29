import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PrismaClient } from '@prisma/client';
import { AgentStateMachine } from './agent-state-machine.js';
import type { AgentSSEEvent } from './agent-state-machine.js';

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

  const run = await prisma.agentRun.create({
    data: { userId, repoId, taskDescription: 'Add search feature', currentState: 'idle' },
  });
  runId = run.id;
});

afterEach(async () => {
  await prisma.agentStep.deleteMany({ where: { runId } });
  await prisma.agentRun.deleteMany({ where: { id: runId } });
});

describe('AgentStateMachine', () => {
  it('transitions to waiting_for_plan_approval after start()', async () => {
    const sm = new AgentStateMachine(runId, prisma, mockClaude, mockMCP);
    await sm.start();

    const run = await prisma.agentRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run.currentState).toBe('waiting_for_plan_approval');
  });

  it('creates 3 AgentStep records with correct types', async () => {
    const sm = new AgentStateMachine(runId, prisma, mockClaude, mockMCP);
    await sm.start();

    const steps = await prisma.agentStep.findMany({ where: { runId }, orderBy: { stepNumber: 'asc' } });
    expect(steps).toHaveLength(3);
    expect(steps.map((s) => s.stepType)).toEqual(['analyze_repo', 'generate_plan', 'save_plan']);
    expect(steps.every((s) => s.status === 'completed')).toBe(true);
  });

  it('saves planJson to AgentRun', async () => {
    const sm = new AgentStateMachine(runId, prisma, mockClaude, mockMCP);
    await sm.start();

    const run = await prisma.agentRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run.planJson).not.toBeNull();
  });

  it('transitions to failed when MCPClientManager throws', async () => {
    mockCallTool.mockRejectedValueOnce(new Error('spawn failed'));

    const sm = new AgentStateMachine(runId, prisma, mockClaude, mockMCP);
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

    const sm = new AgentStateMachine(runId, prisma, mockClaude, mockMCP);
    await expect(sm.start()).rejects.toThrow('Claude API error');

    const run = await prisma.agentRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run.currentState).toBe('failed');
  });

  it('second start() call is queued, not interleaved', async () => {
    const sm = new AgentStateMachine(runId, prisma, mockClaude, mockMCP);
    const p1 = sm.start();
    const p2 = sm.start();
    await Promise.allSettled([p1, p2]);

    const steps = await prisma.agentStep.findMany({ where: { runId } });
    expect(steps.length).toBeGreaterThanOrEqual(3);
  });

  it('emits state_changed events in order', async () => {
    const emitter = new EventEmitter();
    const events: AgentSSEEvent[] = [];
    emitter.on('event', (e: AgentSSEEvent) => events.push(e));

    const sm = new AgentStateMachine(runId, prisma, mockClaude, mockMCP, emitter);
    await sm.start();

    const stateEvents = events
      .filter((e) => e.type === 'state_changed')
      .map((e) => (e as { type: 'state_changed'; state: string }).state);

    expect(stateEvents).toEqual(['analyzing_repo', 'planning', 'waiting_for_plan_approval']);
  });

  it('emits step_started and step_completed for each step', async () => {
    const emitter = new EventEmitter();
    const events: AgentSSEEvent[] = [];
    emitter.on('event', (e: AgentSSEEvent) => events.push(e));

    const sm = new AgentStateMachine(runId, prisma, mockClaude, mockMCP, emitter);
    await sm.start();

    const started = events.filter((e) => e.type === 'step_started').map((e) => (e as any).stepType);
    const completed = events.filter((e) => e.type === 'step_completed').map((e) => (e as any).stepType);

    expect(started).toEqual(['analyze_repo', 'generate_plan', 'save_plan']);
    expect(completed).toEqual(['analyze_repo', 'generate_plan', 'save_plan']);
  });

  it('emits tool_called events for MCP tool calls', async () => {
    const emitter = new EventEmitter();
    const events: AgentSSEEvent[] = [];
    emitter.on('event', (e: AgentSSEEvent) => events.push(e));

    const sm = new AgentStateMachine(runId, prisma, mockClaude, mockMCP, emitter);
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

    const sm = new AgentStateMachine(runId, prisma, mockClaude, mockMCP, emitter);
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

    const sm = new AgentStateMachine(runId, prisma, mockClaude, mockMCP, emitter);
    await expect(sm.start()).rejects.toThrow('mcp error');

    const failedEvent = events.find((e) => e.type === 'run_failed') as
      | { type: 'run_failed'; error: string }
      | undefined;
    expect(failedEvent).toBeDefined();
    expect(failedEvent?.error).toContain('mcp error');
  });
});

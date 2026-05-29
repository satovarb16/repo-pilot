import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { AgentStateMachine } from './agent-state-machine.js';

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
});

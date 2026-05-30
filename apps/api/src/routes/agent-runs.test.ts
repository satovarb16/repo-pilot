import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import Fastify, { type FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { EncryptionService, type GitHubService } from '@repo-pilot/agent-core';
import { agentRunsRoute } from './agent-runs.js';
import { ensureDevUser, DEV_USER_ID } from '../services/dev-user.js';
import type { AgentRunner } from '../services/agent-runner.js';

const prisma = new PrismaClient();

// Shared mock for AgentRunner — includes all methods used across all test suites
const agentRunner = {
  register: vi.fn(),
  start: vi.fn().mockResolvedValue(undefined),
  getEmitter: vi.fn<() => EventEmitter | undefined>(),
  resolvePlanApproval: vi.fn(),
  resolveEditApprovals: vi.fn(),
  resolveTestRunApproval: vi.fn(),
  resolvePRApproval: vi.fn(),
};

describe('Agent run routes', () => {
  let app: FastifyInstance;
  let testRepoId: string;
  const createdRunIds: string[] = [];

  const mockGithubService = {
    cloneRepo: vi.fn().mockResolvedValue('/tmp/test-clone'),
  };

  beforeAll(async () => {
    const rawKey = process.env.TOKEN_ENCRYPTION_KEY ?? '';
    const encryptionKey = /^[0-9a-fA-F]{64}$/.test(rawKey) ? rawKey : '0'.repeat(64);
    const encryption = new EncryptionService(encryptionKey);

    await ensureDevUser(prisma);

    const repo = await prisma.repository.upsert({
      where: { userId_githubRepoId: { userId: DEV_USER_ID, githubRepoId: 99999 } },
      create: {
        userId: DEV_USER_ID,
        githubRepoId: 99999,
        owner: 'test-owner',
        name: 'test-repo-for-runs',
        cloneUrl: 'https://github.com/test-owner/test-repo-for-runs',
        encryptedToken: encryption.encrypt('test-pat'),
      },
      update: {},
    });
    testRepoId = repo.id;

    app = Fastify();
    await app.register(agentRunsRoute, {
      prisma,
      encryption,
      agentRunner: agentRunner as unknown as AgentRunner,
      githubService: mockGithubService as unknown as GitHubService,
    });
    await app.ready();
  });

  afterAll(async () => {
    // Delete all runs for this repo first to satisfy FK constraints
    await prisma.agentRun.deleteMany({ where: { repoId: testRepoId } });
    await prisma.repository.deleteMany({ where: { id: testRepoId } });
    await prisma.$disconnect();
    await app.close();
  });

  describe('POST /api/v1/agent/runs', () => {
    it('creates an agent run and returns 201 with runId', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/agent/runs',
        payload: {
          repositoryId: testRepoId,
          taskDescription: 'Fix the login bug',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json<{ runId: string }>();
      expect(typeof body.runId).toBe('string');
      expect(body.runId.length).toBeGreaterThan(0);
      createdRunIds.push(body.runId);
    });

    it('returns 400 when taskDescription is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/agent/runs',
        payload: { repositoryId: testRepoId },
      });
      expect(response.statusCode).toBe(400);
    });

    it('returns 400 when repositoryId is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/agent/runs',
        payload: { taskDescription: 'Fix the login bug' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('returns 404 when repository does not exist', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/agent/runs',
        payload: {
          repositoryId: 'nonexistent-repo-id',
          taskDescription: 'Fix the login bug',
        },
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /api/v1/agent/runs/:id/stream', () => {
    it('returns 404 when no active emitter for run', async () => {
      agentRunner.getEmitter.mockReturnValueOnce(undefined);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/agent/runs/nonexistent-run-id/stream',
      });

      expect(response.statusCode).toBe(404);
    });

    it('streams SSE events and closes on run_completed', async () => {
      const emitter = new EventEmitter();
      agentRunner.getEmitter.mockReturnValueOnce(emitter);

      setImmediate(() => {
        emitter.emit('event', { type: 'state_changed', state: 'analyzing_repo' });
        emitter.emit('event', { type: 'run_completed', planJson: [] });
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/agent/runs/test-run-id/stream',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/event-stream');
      expect(response.body).toContain(
        'data: {"type":"state_changed","state":"analyzing_repo"}',
      );
      expect(response.body).toContain('data: {"type":"run_completed","planJson":[]}');
    });

    it('streams SSE events and closes on run_failed', async () => {
      const emitter = new EventEmitter();
      agentRunner.getEmitter.mockReturnValueOnce(emitter);

      setImmediate(() => {
        emitter.emit('event', { type: 'run_failed', error: 'Something went wrong' });
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/agent/runs/test-run-id/stream',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/event-stream');
      expect(response.body).toContain(
        'data: {"type":"run_failed","error":"Something went wrong"}',
      );
    });
  });
});

// Approval routes — separate app instance to keep setup isolated
describe('POST /api/v1/agent/runs/:runId/approve-plan', () => {
  let app: FastifyInstance;
  let approvalRepoId: string;
  const approvalRunIds = ['run-plan-1', 'run-plan-2', 'run-1'];

  beforeEach(() => vi.clearAllMocks())

  beforeAll(async () => {
    const rawKey = process.env.TOKEN_ENCRYPTION_KEY ?? '';
    const encryptionKey = /^[0-9a-fA-F]{64}$/.test(rawKey) ? rawKey : '0'.repeat(64);
    const encryption = new EncryptionService(encryptionKey);

    await ensureDevUser(prisma);

    // Create a repo so AgentRun FK constraint is satisfied
    const repo = await prisma.repository.create({
      data: {
        userId: DEV_USER_ID,
        githubRepoId: 77771,
        owner: 'test-owner',
        name: 'test-repo-plan-approval',
        cloneUrl: 'https://github.com/test-owner/test-repo-plan-approval',
        encryptedToken: encryption.encrypt('test-pat'),
      },
    });
    approvalRepoId = repo.id;

    // Ensure AgentRun rows exist for each run used in tests
    for (const runId of approvalRunIds) {
      await prisma.agentRun.upsert({
        where: { id: runId },
        create: { id: runId, userId: DEV_USER_ID, repoId: approvalRepoId, taskDescription: 'test', status: 'running', currentState: 'waiting_for_plan_approval' },
        update: {},
      });
    }

    app = Fastify();
    await app.register(agentRunsRoute, {
      prisma,
      encryption,
      agentRunner: agentRunner as unknown as AgentRunner,
      githubService: { cloneRepo: vi.fn() } as unknown as GitHubService,
    });
    await app.ready();
  });

  afterAll(async () => {
    for (const runId of approvalRunIds) {
      await prisma.agentRun.deleteMany({ where: { id: runId } });
    }
    await prisma.repository.deleteMany({ where: { id: approvalRepoId } });
    await app.close();
  });

  it('returns 200 and resolves plan approval when action is approve', async () => {
    const runId = 'run-plan-1'
    const resolveSpy = vi.spyOn(agentRunner, 'resolvePlanApproval')

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/agent/runs/${runId}/approve-plan`,
      payload: { action: 'approve' },
    })

    expect(res.statusCode).toBe(200)
    expect(resolveSpy).toHaveBeenCalledWith(runId, true)
  })

  it('returns 200 and resolves with false when action is reject', async () => {
    const runId = 'run-plan-2'
    const resolveSpy = vi.spyOn(agentRunner, 'resolvePlanApproval')

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/agent/runs/${runId}/approve-plan`,
      payload: { action: 'reject' },
    })

    expect(res.statusCode).toBe(200)
    expect(resolveSpy).toHaveBeenCalledWith(runId, false)
  })

  it('returns 400 for invalid action', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/runs/run-1/approve-plan',
      payload: { action: 'maybe' },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('PATCH /api/v1/agent/runs/:runId/file-changes/:changeId', () => {
  let app: FastifyInstance;
  let editRepoId: string;
  const editRunIds = ['run-edit-1', 'run-edit-2', 'run-edit-3', 'other-run'];

  beforeEach(() => vi.clearAllMocks())

  beforeAll(async () => {
    const rawKey = process.env.TOKEN_ENCRYPTION_KEY ?? '';
    const encryptionKey = /^[0-9a-fA-F]{64}$/.test(rawKey) ? rawKey : '0'.repeat(64);
    const encryption = new EncryptionService(encryptionKey);

    await ensureDevUser(prisma);

    // Create a repo so AgentRun FK constraint is satisfied
    const repo = await prisma.repository.create({
      data: {
        userId: DEV_USER_ID,
        githubRepoId: 77772,
        owner: 'test-owner',
        name: 'test-repo-edit-approval',
        cloneUrl: 'https://github.com/test-owner/test-repo-edit-approval',
        encryptedToken: encryption.encrypt('test-pat'),
      },
    });
    editRepoId = repo.id;

    // Ensure AgentRun rows exist for FK constraints
    for (const runId of editRunIds) {
      await prisma.agentRun.upsert({
        where: { id: runId },
        create: { id: runId, userId: DEV_USER_ID, repoId: editRepoId, taskDescription: 'test', status: 'running', currentState: 'waiting_for_edit_approval' },
        update: {},
      });
    }

    app = Fastify();
    await app.register(agentRunsRoute, {
      prisma,
      encryption,
      agentRunner: agentRunner as unknown as AgentRunner,
      githubService: { cloneRepo: vi.fn() } as unknown as GitHubService,
    });
    await app.ready();
  });

  afterAll(async () => {
    await prisma.fileChange.deleteMany({ where: { runId: { in: [...editRunIds, 'wrong-run'] } } });
    for (const runId of editRunIds) {
      await prisma.agentRun.deleteMany({ where: { id: runId } });
    }
    await prisma.repository.deleteMany({ where: { id: editRepoId } });
    await app.close();
  });

  it('approves a file change and resolves edit approvals when all edits are decided', async () => {
    const runId = 'run-edit-1'
    const changeId = 'change-1'

    // Seed the DB with one pending FileChange
    await prisma.fileChange.create({
      data: {
        id: changeId,
        runId,
        filePath: 'src/foo.ts',
        changeType: 'edit',
        originalContent: 'old',
        proposedContent: 'new',
        diffContent: '--- old\n+++ new',
      },
    })

    const resolveSpy = vi.spyOn(agentRunner, 'resolveEditApprovals')

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/agent/runs/${runId}/file-changes/${changeId}`,
      payload: { action: 'approve' },
    })

    expect(res.statusCode).toBe(200)
    // All edits resolved → resolveEditApprovals called
    expect(resolveSpy).toHaveBeenCalledWith(runId, {
      approved: [changeId],
      rejected: [],
    })
  })

  it('rejects a file change and resolves approvals', async () => {
    const runId = 'run-edit-2'
    const changeId = 'change-2'

    await prisma.fileChange.create({
      data: {
        id: changeId,
        runId,
        filePath: 'src/bar.ts',
        changeType: 'edit',
        originalContent: 'old',
        proposedContent: 'new',
        diffContent: '',
      },
    })

    const resolveSpy = vi.spyOn(agentRunner, 'resolveEditApprovals')

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/agent/runs/${runId}/file-changes/${changeId}`,
      payload: { action: 'reject' },
    })

    expect(res.statusCode).toBe(200)
    expect(resolveSpy).toHaveBeenCalledWith(runId, {
      approved: [],
      rejected: [changeId],
    })
  })

  it('returns 400 for invalid action', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/agent/runs/run-1/file-changes/change-1',
      payload: { action: 'maybe' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 404 when changeId does not belong to runId', async () => {
    const changeId = 'change-other'
    await prisma.fileChange.create({
      data: {
        id: changeId,
        runId: 'other-run',
        filePath: 'src/baz.ts',
        changeType: 'edit',
      },
    })

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/agent/runs/wrong-run/file-changes/${changeId}`,
      payload: { action: 'approve' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('does not call resolveEditApprovals when some file changes are still pending', async () => {
    const runId = 'run-edit-3'
    const changeId1 = 'change-3a'
    const changeId2 = 'change-3b'

    // Create the AgentRun
    await prisma.agentRun.upsert({
      where: { id: runId },
      update: {},
      create: { id: runId, userId: DEV_USER_ID, repoId: editRepoId, taskDescription: 'partial test', status: 'running', currentState: 'editing' },
    })

    // Seed two pending FileChanges
    await prisma.fileChange.createMany({
      data: [
        {
          id: changeId1,
          runId,
          filePath: 'src/a.ts',
          changeType: 'edit',
          originalContent: 'a',
          proposedContent: 'a2',
          diffContent: '',
        },
        {
          id: changeId2,
          runId,
          filePath: 'src/b.ts',
          changeType: 'edit',
          originalContent: 'b',
          proposedContent: 'b2',
          diffContent: '',
        },
      ],
    })

    const resolveSpy = vi.spyOn(agentRunner, 'resolveEditApprovals')

    // Approve only the first change — second is still pending
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/agent/runs/${runId}/file-changes/${changeId1}`,
      payload: { action: 'approve' },
    })

    expect(res.statusCode).toBe(200)
    expect(resolveSpy).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// D1-4.3 — Phase 3 route tests
// ---------------------------------------------------------------------------
describe('POST /api/v1/agent/runs/:runId/approve-test-run', () => {
  let app: FastifyInstance
  let testRunRepoId: string
  const testRunRunIds = ['run-tr-1', 'run-tr-2', 'run-tr-3']

  beforeEach(() => vi.clearAllMocks())

  beforeAll(async () => {
    const rawKey = process.env.TOKEN_ENCRYPTION_KEY ?? ''
    const encryptionKey = /^[0-9a-fA-F]{64}$/.test(rawKey) ? rawKey : '0'.repeat(64)
    const encryption = new EncryptionService(encryptionKey)

    await ensureDevUser(prisma)

    const repo = await prisma.repository.create({
      data: {
        userId: DEV_USER_ID,
        githubRepoId: 77773,
        owner: 'test-owner',
        name: 'test-repo-test-run',
        cloneUrl: 'https://github.com/test-owner/test-repo-test-run',
        encryptedToken: encryption.encrypt('test-pat'),
      },
    })
    testRunRepoId = repo.id

    for (const runId of testRunRunIds) {
      await prisma.agentRun.upsert({
        where: { id: runId },
        create: { id: runId, userId: DEV_USER_ID, repoId: testRunRepoId, taskDescription: 'test', status: 'running', currentState: 'waiting_for_test_run_approval' },
        update: {},
      })
    }

    app = Fastify()
    await app.register(agentRunsRoute, {
      prisma,
      encryption,
      agentRunner: agentRunner as unknown as AgentRunner,
      githubService: { cloneRepo: vi.fn() } as unknown as GitHubService,
    })
    await app.ready()
  })

  afterAll(async () => {
    for (const runId of testRunRunIds) {
      await prisma.agentRun.deleteMany({ where: { id: runId } })
    }
    await prisma.repository.deleteMany({ where: { id: testRunRepoId } })
    await app.close()
  })

  it('returns 200 and resolves approval when action is approve', async () => {
    const runId = 'run-tr-1'
    const resolveSpy = vi.spyOn(agentRunner, 'resolveTestRunApproval')

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/agent/runs/${runId}/approve-test-run`,
      payload: { action: 'approve' },
    })

    expect(res.statusCode).toBe(200)
    expect(resolveSpy).toHaveBeenCalledWith(runId, true)
  })

  it('returns 200 and resolves with false when action is reject', async () => {
    const runId = 'run-tr-2'
    const resolveSpy = vi.spyOn(agentRunner, 'resolveTestRunApproval')

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/agent/runs/${runId}/approve-test-run`,
      payload: { action: 'reject' },
    })

    expect(res.statusCode).toBe(200)
    expect(resolveSpy).toHaveBeenCalledWith(runId, false)
  })

  it('returns 400 for invalid action', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/runs/run-tr-3/approve-test-run',
      payload: { action: 'maybe' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 404 for unknown runId', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/runs/nonexistent-run/approve-test-run',
      payload: { action: 'approve' },
    })
    expect(res.statusCode).toBe(404)
  })
})

describe('GET /api/v1/agent/runs/:id/test-results', () => {
  let app: FastifyInstance
  let trRepoId: string
  const trRunIds = ['run-get-tr-1', 'run-get-tr-2']

  beforeEach(() => vi.clearAllMocks())

  beforeAll(async () => {
    const rawKey = process.env.TOKEN_ENCRYPTION_KEY ?? ''
    const encryptionKey = /^[0-9a-fA-F]{64}$/.test(rawKey) ? rawKey : '0'.repeat(64)
    const encryption = new EncryptionService(encryptionKey)

    await ensureDevUser(prisma)

    const repo = await prisma.repository.create({
      data: {
        userId: DEV_USER_ID,
        githubRepoId: 77774,
        owner: 'test-owner',
        name: 'test-repo-get-tr',
        cloneUrl: 'https://github.com/test-owner/test-repo-get-tr',
        encryptedToken: encryption.encrypt('test-pat'),
      },
    })
    trRepoId = repo.id

    for (const runId of trRunIds) {
      await prisma.agentRun.upsert({
        where: { id: runId },
        create: { id: runId, userId: DEV_USER_ID, repoId: trRepoId, taskDescription: 'test', status: 'running', currentState: 'reviewing' },
        update: {},
      })
    }

    app = Fastify()
    await app.register(agentRunsRoute, {
      prisma,
      encryption,
      agentRunner: agentRunner as unknown as AgentRunner,
      githubService: { cloneRepo: vi.fn() } as unknown as GitHubService,
    })
    await app.ready()
  })

  afterAll(async () => {
    await prisma.testRun.deleteMany({ where: { runId: { in: trRunIds } } })
    for (const runId of trRunIds) {
      await prisma.agentRun.deleteMany({ where: { id: runId } })
    }
    await prisma.repository.deleteMany({ where: { id: trRepoId } })
    await app.close()
  })

  it('returns 200 with ordered TestRun array', async () => {
    const runId = 'run-get-tr-1'
    // Seed test runs
    await prisma.testRun.createMany({
      data: [
        { runId, command: 'npm test', status: 'failed', exitCode: 1, stdout: 'err', stderr: '' },
        { runId, command: 'npm test', status: 'passed', exitCode: 0, stdout: 'ok', stderr: '' },
      ],
    })

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/agent/runs/${runId}/test-results`,
    })

    expect(res.statusCode).toBe(200)
    const body = res.json<{ testRuns: unknown[] }>()
    expect(body.testRuns).toHaveLength(2)
    expect((body.testRuns[0] as any).exitCode).toBe(1)
    expect((body.testRuns[1] as any).exitCode).toBe(0)
  })

  it('returns 200 with empty array when no test runs', async () => {
    const runId = 'run-get-tr-2'
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/agent/runs/${runId}/test-results`,
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ testRuns: unknown[] }>()
    expect(body.testRuns).toHaveLength(0)
  })

  it('returns 404 for unknown runId', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/agent/runs/nonexistent-run/test-results',
    })
    expect(res.statusCode).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// D1-11 — POST /approve-pr and /reject-pr routes
// ---------------------------------------------------------------------------
describe('POST /api/v1/agent/runs/:runId/approve-pr and reject-pr', () => {
  let app: FastifyInstance
  let prRepoId: string
  const prRunIds = ['run-pr-1', 'run-pr-2', 'run-pr-3', 'run-pr-4']

  beforeEach(() => vi.clearAllMocks())

  beforeAll(async () => {
    const rawKey = process.env.TOKEN_ENCRYPTION_KEY ?? ''
    const encryptionKey = /^[0-9a-fA-F]{64}$/.test(rawKey) ? rawKey : '0'.repeat(64)
    const encryption = new EncryptionService(encryptionKey)

    await ensureDevUser(prisma)

    const repo = await prisma.repository.create({
      data: {
        userId: DEV_USER_ID,
        githubRepoId: 77778,
        owner: 'test-owner',
        name: 'test-repo-pr-approval',
        cloneUrl: 'https://github.com/test-owner/test-repo-pr-approval',
        encryptedToken: encryption.encrypt('test-pat'),
      },
    })
    prRepoId = repo.id

    for (const runId of prRunIds) {
      await prisma.agentRun.upsert({
        where: { id: runId },
        create: {
          id: runId,
          userId: DEV_USER_ID,
          repoId: prRepoId,
          taskDescription: 'test',
          status: 'running',
          currentState: 'waiting_for_pr_approval',
        },
        update: {},
      })
    }

    app = Fastify()
    await app.register(agentRunsRoute, {
      prisma,
      encryption,
      agentRunner: agentRunner as unknown as AgentRunner,
      githubService: { cloneRepo: vi.fn() } as unknown as GitHubService,
    })
    await app.ready()
  })

  afterAll(async () => {
    for (const runId of prRunIds) {
      await prisma.agentRun.deleteMany({ where: { id: runId } })
    }
    await prisma.repository.deleteMany({ where: { id: prRepoId } })
    await app.close()
  })

  it('approve-pr returns 200 and calls resolvePRApproval(true)', async () => {
    const runId = 'run-pr-1'
    const spy = vi.spyOn(agentRunner, 'resolvePRApproval')

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/agent/runs/${runId}/approve-pr`,
    })

    expect(res.statusCode).toBe(200)
    expect(spy).toHaveBeenCalledWith(runId, true)
  })

  it('reject-pr returns 200 and calls resolvePRApproval(false)', async () => {
    const runId = 'run-pr-2'
    const spy = vi.spyOn(agentRunner, 'resolvePRApproval')

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/agent/runs/${runId}/reject-pr`,
    })

    expect(res.statusCode).toBe(200)
    expect(spy).toHaveBeenCalledWith(runId, false)
  })

  it('approve-pr returns 409 when run is not in waiting_for_pr_approval state', async () => {
    // Create a run in 'complete' state
    const completedRun = await prisma.agentRun.create({
      data: {
        userId: DEV_USER_ID,
        repoId: prRepoId,
        taskDescription: 'done task',
        status: 'completed',
        currentState: 'complete',
      },
    })

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/agent/runs/${completedRun.id}/approve-pr`,
    })

    expect(res.statusCode).toBe(409)
    await prisma.agentRun.delete({ where: { id: completedRun.id } })
  })

  it('reject-pr returns 409 when run is not in waiting_for_pr_approval state', async () => {
    const completedRun = await prisma.agentRun.create({
      data: {
        userId: DEV_USER_ID,
        repoId: prRepoId,
        taskDescription: 'done task',
        status: 'completed',
        currentState: 'complete',
      },
    })

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/agent/runs/${completedRun.id}/reject-pr`,
    })

    expect(res.statusCode).toBe(409)
    await prisma.agentRun.delete({ where: { id: completedRun.id } })
  })

  it('approve-pr returns 404 for unknown runId', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/runs/nonexistent-run-pr/approve-pr',
    })
    expect(res.statusCode).toBe(404)
  })

  it('reject-pr returns 404 for unknown runId', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agent/runs/nonexistent-run-pr/reject-pr',
    })
    expect(res.statusCode).toBe(404)
  })
})

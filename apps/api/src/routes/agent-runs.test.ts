import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import Fastify, { type FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { EncryptionService, type GitHubService } from '@repo-pilot/agent-core';
import { agentRunsRoute } from './agent-runs.js';
import { ensureDevUser, DEV_USER_ID } from '../services/dev-user.js';
import type { AgentRunner } from '../services/agent-runner.js';

const prisma = new PrismaClient();

describe('Agent run routes', () => {
  let app: FastifyInstance;
  let testRepoId: string;
  const createdRunIds: string[] = [];

  const mockAgentRunner = {
    start: vi.fn<[string, string], Promise<void>>().mockResolvedValue(undefined),
    getEmitter: vi.fn<[string], EventEmitter | undefined>(),
  };

  const mockGithubService = {
    cloneRepo: vi.fn<[string, string, string], Promise<string>>().mockResolvedValue('/tmp/test-clone'),
  };

  beforeAll(async () => {
    const rawKey = process.env.TOKEN_ENCRYPTION_KEY ?? '';
    const encryptionKey = /^[0-9a-fA-F]{64}$/.test(rawKey) ? rawKey : '0'.repeat(64);
    const encryption = new EncryptionService(encryptionKey);

    await ensureDevUser(prisma);

    const repo = await prisma.repository.create({
      data: {
        userId: DEV_USER_ID,
        githubRepoId: 88888,
        owner: 'test-owner',
        name: 'test-repo-for-runs',
        cloneUrl: 'https://github.com/test-owner/test-repo-for-runs',
        encryptedToken: encryption.encrypt('test-pat'),
      },
    });
    testRepoId = repo.id;

    app = Fastify();
    await app.register(agentRunsRoute, {
      prisma,
      encryption,
      agentRunner: mockAgentRunner as unknown as AgentRunner,
      githubService: mockGithubService as unknown as GitHubService,
    });
    await app.ready();
  });

  afterAll(async () => {
    for (const id of createdRunIds) {
      await prisma.agentRun.deleteMany({ where: { id } });
    }
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
      mockAgentRunner.getEmitter.mockReturnValueOnce(undefined);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/agent/runs/nonexistent-run-id/stream',
      });

      expect(response.statusCode).toBe(404);
    });

    it('streams SSE events and closes on run_completed', async () => {
      const emitter = new EventEmitter();
      mockAgentRunner.getEmitter.mockReturnValueOnce(emitter);

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
      mockAgentRunner.getEmitter.mockReturnValueOnce(emitter);

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

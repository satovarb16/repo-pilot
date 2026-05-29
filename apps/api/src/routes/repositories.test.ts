import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { EncryptionService } from '@repo-pilot/agent-core';
import { repositoriesRoute } from './repositories.js';
import { ensureDevUser } from '../services/dev-user.js';

const prisma = new PrismaClient();

describe('Repository routes', () => {
  let app: FastifyInstance;
  const createdRepoIds: string[] = [];

  beforeAll(async () => {
    // Instantiate inside beforeAll so TOKEN_ENCRYPTION_KEY is available from setupFiles.
    // Use a valid 64-char hex fallback for environments without a real key.
    const rawKey = process.env.TOKEN_ENCRYPTION_KEY ?? '';
    const encryptionKey = /^[0-9a-fA-F]{64}$/.test(rawKey) ? rawKey : '0'.repeat(64);
    const encryption = new EncryptionService(encryptionKey);

    await ensureDevUser(prisma);

    app = Fastify();
    await app.register(repositoriesRoute, { prisma, encryption });
    await app.ready();
  });

  afterAll(async () => {
    for (const id of createdRepoIds) {
      await prisma.repository.deleteMany({ where: { id } });
    }
    await prisma.$disconnect();
    await app.close();
  });

  describe('POST /api/v1/repositories', () => {
    it('creates a repository and returns 201', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/repositories',
        payload: {
          githubRepoId: 12345,
          owner: 'test-owner',
          name: 'test-repo',
          cloneUrl: 'https://github.com/test-owner/test-repo',
          pat: 'ghp_testtoken123',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json<{ id: string; owner: string; name: string; cloneUrl: string; cloneStatus: string; createdAt: string }>();
      expect(typeof body.id).toBe('string');
      expect(body.owner).toBe('test-owner');
      expect(body.name).toBe('test-repo');
      expect(body.cloneUrl).toBe('https://github.com/test-owner/test-repo');
      expect(typeof body.cloneStatus).toBe('string');
      expect(typeof body.createdAt).toBe('string');
      expect(body).not.toHaveProperty('encryptedToken');
      expect(body).not.toHaveProperty('pat');
      createdRepoIds.push(body.id);
    });

    it('returns 400 for missing required fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/repositories',
        payload: { owner: 'test-owner' },
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /api/v1/repositories', () => {
    it('returns 200 with list of repositories', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/v1/repositories' });
      expect(response.statusCode).toBe(200);
      const body = response.json<{ repositories: unknown[] }>();
      expect(Array.isArray(body.repositories)).toBe(true);
    });

    it('never includes encryptedToken in response', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/v1/repositories' });
      const body = response.json<{ repositories: Record<string, unknown>[] }>();
      for (const repo of body.repositories) {
        expect(repo).not.toHaveProperty('encryptedToken');
      }
    });
  });
});

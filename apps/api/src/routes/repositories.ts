import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { EncryptionService } from '@repo-pilot/agent-core';
import { DEV_USER_ID } from '../services/dev-user.js';

const createRepoBody = z.object({
  githubRepoId: z.number().int().positive(),
  owner: z.string().min(1),
  name: z.string().min(1),
  cloneUrl: z.string().url(),
  pat: z.string().min(1),
});

interface RepositoriesRouteOptions {
  prisma: PrismaClient;
  encryption: EncryptionService;
}

export async function repositoriesRoute(
  app: FastifyInstance,
  opts: RepositoriesRouteOptions,
): Promise<void> {
  const { prisma, encryption } = opts;

  app.post('/api/v1/repositories', async (request, reply) => {
    const result = createRepoBody.safeParse(request.body);
    if (!result.success) {
      return reply.code(400).send({ error: result.error.flatten() });
    }

    const { githubRepoId, owner, name, cloneUrl, pat } = result.data;
    const encryptedToken = encryption.encrypt(pat);

    const repo = await prisma.repository.create({
      data: {
        userId: DEV_USER_ID,
        githubRepoId,
        owner,
        name,
        cloneUrl,
        encryptedToken,
      },
      select: {
        id: true,
        owner: true,
        name: true,
        cloneUrl: true,
        cloneStatus: true,
        createdAt: true,
      },
    });

    return reply.code(201).send(repo);
  });

  app.get('/api/v1/repositories', async (_request, reply) => {
    const repositories = await prisma.repository.findMany({
      where: { userId: DEV_USER_ID },
      select: {
        id: true,
        owner: true,
        name: true,
        cloneUrl: true,
        cloneStatus: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return reply.send({ repositories });
  });
}

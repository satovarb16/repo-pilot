import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { EncryptionService, GitHubService } from '@repo-pilot/agent-core';
import type { AgentSSEEvent } from '@repo-pilot/agent-core';
import { DEV_USER_ID } from '../services/dev-user.js';
import type { AgentRunner } from '../services/agent-runner.js';

const createRunBody = z.object({
  repositoryId: z.string().min(1),
  taskDescription: z.string().min(1),
});

interface AgentRunsRouteOptions {
  prisma: PrismaClient;
  encryption: EncryptionService;
  agentRunner: AgentRunner;
  githubService: GitHubService;
}

export async function agentRunsRoute(
  app: FastifyInstance,
  opts: AgentRunsRouteOptions,
): Promise<void> {
  const { prisma, encryption, agentRunner, githubService } = opts;

  app.post('/api/v1/agent/runs', async (request, reply) => {
    const result = createRunBody.safeParse(request.body);
    if (!result.success) {
      return reply.code(400).send({ error: result.error.flatten() });
    }

    const { repositoryId, taskDescription } = result.data;

    const repository = await prisma.repository.findFirst({
      where: { id: repositoryId, userId: DEV_USER_ID },
    });
    if (!repository) {
      return reply.code(404).send({ error: 'Repository not found' });
    }

    const decryptedToken = encryption.decrypt(repository.encryptedToken);

    const agentRun = await prisma.agentRun.create({
      data: {
        userId: DEV_USER_ID,
        repoId: repositoryId,
        taskDescription,
        status: 'running',
        currentState: 'idle',
      },
      select: { id: true },
    });

    const runId = agentRun.id;

    // Fire and forget: clone repo then start agent loop
    ;(async () => {
      const repoPath = await githubService.cloneRepo(repository.cloneUrl, repository.id, decryptedToken);
      await agentRunner.start(runId, repoPath);
    })().catch(() => {
      // Errors surface via EventEmitter as run_failed
    });

    return reply.code(201).send({ runId });
  });

  app.get<{ Params: { id: string } }>(
    '/api/v1/agent/runs/:id/stream',
    async (request, reply) => {
      const { id: runId } = request.params;

      const emitter = agentRunner.getEmitter(runId);
      if (!emitter) {
        return reply.code(404).send({ error: 'Run not found or not active' });
      }

      reply.hijack();
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      return new Promise<void>((resolve) => {
        const onEvent = (data: AgentSSEEvent) => {
          reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
          if (data.type === 'run_completed' || data.type === 'run_failed') {
            emitter.off('event', onEvent);
            reply.raw.end();
            resolve();
          }
        };

        emitter.on('event', onEvent);

        request.raw.on('close', () => {
          emitter.off('event', onEvent);
          resolve();
        });
      });
    },
  );
}

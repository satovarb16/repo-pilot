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
  agentRunner: AgentRunner & {
    resolveTestRunApproval?: (runId: string, approved: boolean) => void;
  };
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

    // Register emitter before clone so the SSE stream can attach immediately
    agentRunner.register(runId);

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
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
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

  // Plan approval
  const planApprovalBody = z.object({
    action: z.enum(['approve', 'reject']),
  });

  app.post<{ Params: { runId: string } }>(
    '/api/v1/agent/runs/:runId/approve-plan',
    async (request, reply) => {
      const result = planApprovalBody.safeParse(request.body);
      if (!result.success) {
        return reply.code(400).send({ error: result.error.flatten() });
      }
      const { runId } = request.params;
      const run = await prisma.agentRun.findFirst({ where: { id: runId }, select: { id: true } });
      if (!run) {
        return reply.code(404).send({ error: 'Run not found' });
      }
      agentRunner.resolvePlanApproval(runId, result.data.action === 'approve');
      return reply.send({ ok: true });
    },
  );

  // Phase 3: Test-run approval
  const testRunApprovalBody = z.object({
    action: z.enum(['approve', 'reject']),
  });

  app.post<{ Params: { runId: string } }>(
    '/api/v1/agent/runs/:runId/approve-test-run',
    async (request, reply) => {
      const result = testRunApprovalBody.safeParse(request.body);
      if (!result.success) {
        return reply.code(400).send({ error: result.error.flatten() });
      }
      const { runId } = request.params;
      const run = await prisma.agentRun.findFirst({ where: { id: runId }, select: { id: true } });
      if (!run) {
        return reply.code(404).send({ error: 'Run not found' });
      }
      agentRunner.resolveTestRunApproval?.(runId, result.data.action === 'approve');
      return reply.send({ ok: true });
    },
  );

  // Phase 3: Test results — durable history (survives SSE disconnect / page reload)
  app.get<{ Params: { id: string } }>(
    '/api/v1/agent/runs/:id/test-results',
    async (request, reply) => {
      const { id: runId } = request.params;
      const run = await prisma.agentRun.findFirst({ where: { id: runId }, select: { id: true } });
      if (!run) {
        return reply.code(404).send({ error: 'Run not found' });
      }
      const testRuns = await prisma.testRun.findMany({
        where: { runId },
        orderBy: { createdAt: 'asc' },
      });
      return reply.send({ testRuns });
    },
  );

  // File change approval — one at a time; resolves edit gate when all decided
  const fileChangeBody = z.object({
    action: z.enum(['approve', 'reject']),
  });

  app.patch<{ Params: { runId: string; changeId: string } }>(
    '/api/v1/agent/runs/:runId/file-changes/:changeId',
    async (request, reply) => {
      const result = fileChangeBody.safeParse(request.body);
      if (!result.success) {
        return reply.code(400).send({ error: result.error.flatten() });
      }

      const { runId, changeId } = request.params;
      const approved = result.data.action === 'approve';

      // Verify the change belongs to this run
      const fc = await prisma.fileChange.findFirst({
        where: { id: changeId, runId },
      });
      if (!fc) {
        return reply.code(404).send({ error: 'File change not found' });
      }

      if (fc.approved !== null) {
        return reply.code(409).send({ error: 'File change already decided' });
      }

      // Record decision and atomically check if all edits are decided
      const { remaining, allChanges } = await prisma.$transaction(async (tx) => {
        await tx.fileChange.update({
          where: { id: changeId },
          data: { approved },
        });
        const remaining = await tx.fileChange.count({
          where: { runId, approved: null },
        });
        const allChanges = remaining === 0
          ? await tx.fileChange.findMany({ where: { runId } })
          : [];
        return { remaining, allChanges };
      });

      if (remaining === 0) {
        const approvedIds = allChanges.filter((c) => c.approved === true).map((c) => c.id);
        const rejectedIds = allChanges.filter((c) => c.approved === false).map((c) => c.id);
        agentRunner.resolveEditApprovals(runId, { approved: approvedIds, rejected: rejectedIds });
      }

      return reply.send({ ok: true });
    },
  );
}

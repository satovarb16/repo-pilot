import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { PrismaClient } from '@prisma/client';
import { EncryptionService, GitHubService } from '@repo-pilot/agent-core';
import { parseEnv } from './env.js';
import { healthRoute } from './routes/health.js';
import { repositoriesRoute } from './routes/repositories.js';
import { agentRunsRoute } from './routes/agent-runs.js';
import { ensureDevUser } from './services/dev-user.js';
import { AgentRunner } from './services/agent-runner.js';

const env = parseEnv();

const prisma = new PrismaClient();
const encryption = new EncryptionService(env.TOKEN_ENCRYPTION_KEY);
const githubService = new GitHubService(env.REPO_ROOT);
const agentRunner = new AgentRunner(prisma, env.REPO_ROOT, env.ANTHROPIC_API_KEY, env.MCP_SERVER_PATH);

await ensureDevUser(prisma);

const app = Fastify({ logger: true });

app.register(cors);
app.register(helmet);
app.register(healthRoute);
app.register(repositoriesRoute, { prisma, encryption });
app.register(agentRunsRoute, { prisma, encryption, agentRunner, githubService });

await app.listen({ port: env.PORT, host: '0.0.0.0' });

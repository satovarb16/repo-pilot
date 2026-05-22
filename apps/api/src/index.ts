import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { parseEnv } from './env.js';
import { healthRoute } from './routes/health.js';

const env = parseEnv();

const app = Fastify({ logger: true });

app.register(cors);
app.register(helmet);
app.register(healthRoute);

await app.listen({ port: env.PORT, host: '0.0.0.0' });

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { healthRoute } from './health.js';

describe('GET /health', () => {
  const app = Fastify();

  beforeAll(async () => {
    await app.register(healthRoute);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
  });

  it('returns status ok', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    const body = response.json<{ status: string; uptime: number }>();
    expect(body.status).toBe('ok');
  });

  it('returns uptime as a number', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    const body = response.json<{ status: string; uptime: number }>();
    expect(typeof body.uptime).toBe('number');
    expect(body.uptime).toBeGreaterThanOrEqual(0);
  });
});

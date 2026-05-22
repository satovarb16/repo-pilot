# Phase 0 — Monorepo Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the full RepoPilot monorepo scaffold — workspace root, all package stubs, Fastify API skeleton, Next.js 15 shell, Vitest, Docker Compose, and Prisma schema — so every package compiles, tests pass, and both apps start.

**Architecture:** Turborepo monorepo with pnpm workspaces. Manual workspace root + `create-next-app` for `apps/web`. Three stub packages (`shared`, `agent-core`, `mcp-server`) with no logic yet. Fastify API validates env at startup, exposes `GET /health`, and holds a Prisma singleton. No business logic anywhere.

**Tech Stack:** pnpm 9, Turborepo 2, TypeScript 5 (strict, NodeNext), Next.js 15, Fastify 4, Prisma 5, Zod 3, Vitest 3, PostgreSQL 16 (Docker), shadcn/ui (new-york/zinc), next-themes.

**Spec:** `docs/superpowers/specs/2026-05-22-phase-0-scaffold-design.md`

---

## File Map

```
# Root
package.json                          workspace root, turbo scripts
pnpm-workspace.yaml                   apps/* packages/*
turbo.json                            build/test/lint/typecheck pipeline
tsconfig.base.json                    shared strict TS config
.env.example                          documents all required vars
.gitignore                            add /tmp/repo-pilot/ and .atl/
vitest.workspace.ts                   root vitest workspace

# packages/shared
packages/shared/package.json
packages/shared/tsconfig.json
packages/shared/src/index.ts          empty re-export stub
packages/shared/src/index.test.ts     smoke test
packages/shared/vitest.config.ts

# packages/agent-core
packages/agent-core/package.json
packages/agent-core/tsconfig.json
packages/agent-core/src/index.ts      empty stub
packages/agent-core/src/index.test.ts smoke test
packages/agent-core/vitest.config.ts

# packages/mcp-server
packages/mcp-server/package.json
packages/mcp-server/tsconfig.json
packages/mcp-server/src/index.ts      empty stub
packages/mcp-server/src/index.test.ts smoke test
packages/mcp-server/vitest.config.ts

# prisma
prisma/schema.prisma                  datasource + generator, no models

# docker
docker/docker-compose.yml             postgres:16
docker/Dockerfile.sandbox             stub for Phase 4

# apps/api
apps/api/package.json
apps/api/tsconfig.json
apps/api/src/env.ts                   zod schema + parseEnv() function
apps/api/src/env.test.ts              unit tests for env validation
apps/api/src/db.ts                    prisma client singleton
apps/api/src/routes/health.ts         GET /health handler
apps/api/src/routes/health.test.ts    route integration test
apps/api/src/index.ts                 server bootstrap
apps/api/vitest.config.ts

# apps/web  (scaffolded by create-next-app, then modified)
apps/web/                             created by create-next-app
apps/web/components/layout/Sidebar.tsx
apps/web/components/layout/MainPanel.tsx
apps/web/components/layout/RightPanel.tsx
apps/web/app/layout.tsx               modified — ThemeProvider + shell
apps/web/app/page.tsx                 modified — renders MainPanel
```

---

## Task 1: Workspace Root Config

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `turbo.json`
- Create: `tsconfig.base.json`
- Create: `.env.example`
- Modify: `.gitignore`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "repo-pilot",
  "private": true,
  "scripts": {
    "dev": "turbo dev",
    "build": "turbo build",
    "test": "turbo test",
    "lint": "turbo lint",
    "typecheck": "turbo typecheck"
  },
  "devDependencies": {
    "turbo": "^2",
    "typescript": "^5",
    "vitest": "^3"
  },
  "engines": {
    "node": ">=20",
    "pnpm": ">=9"
  },
  "packageManager": "pnpm@9.0.0"
}
```

- [ ] **Step 2: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

- [ ] **Step 3: Create `turbo.json`**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "!.next/cache/**", "dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "test": {
      "dependsOn": ["^build"],
      "outputs": ["coverage/**"]
    },
    "lint": {},
    "typecheck": {}
  }
}
```

- [ ] **Step 4: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

- [ ] **Step 5: Create `.env.example`**

```bash
# PostgreSQL connection string
DATABASE_URL=postgresql://repopilot:repopilot@localhost:5432/repopilot

# Claude API key — get from https://console.anthropic.com
ANTHROPIC_API_KEY=sk-ant-api03-...

# AES-256-GCM key for encrypting GitHub PATs (32 random bytes, base64-encoded)
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
TOKEN_ENCRYPTION_KEY=base64-encoded-32-bytes-here

# API server port (optional, default: 3001)
PORT=3001

# Base path for local repository clones (optional)
REPO_ROOT=/tmp/repo-pilot/clones
```

- [ ] **Step 6: Append to `.gitignore`**

Add these lines to the existing `.gitignore`:

```
# Repo clones
/tmp/repo-pilot/

# Agent tooling cache
.atl/
```

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-workspace.yaml turbo.json tsconfig.base.json .env.example .gitignore
git commit -m "chore: add workspace root config"
```

---

## Task 2: Stub Packages (shared, agent-core, mcp-server)

All three packages follow the same pattern. Complete one, then repeat for the other two.

**Files (repeat pattern for `agent-core` and `mcp-server`):**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/index.ts`
- Create: `packages/shared/src/index.test.ts`
- Create: `packages/shared/vitest.config.ts`

- [ ] **Step 1: Write the failing smoke test for `shared`**

```ts
// packages/shared/src/index.test.ts
import { describe, it, expect } from 'vitest';
import * as shared from './index.js';

describe('shared', () => {
  it('exports a module without throwing', () => {
    expect(shared).toBeDefined();
  });
});
```

- [ ] **Step 2: Create `packages/shared/package.json`**

```json
{
  "name": "@repo-pilot/shared",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "devDependencies": {
    "typescript": "*",
    "vitest": "*"
  }
}
```

- [ ] **Step 3: Create `packages/shared/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create `packages/shared/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
  },
});
```

- [ ] **Step 5: Create `packages/shared/src/index.ts`**

```ts
// Shared TypeScript types — populated in Phase 1+
export {};
```

- [ ] **Step 6: Run test to verify it passes**

```bash
pnpm --filter @repo-pilot/shared test
```

Expected: 1 test passes.

- [ ] **Step 7: Repeat Steps 1–6 for `agent-core`**

Same structure. Replace all `shared` references with `agent-core`. Package name: `@repo-pilot/agent-core`.

```ts
// packages/agent-core/src/index.ts
// AgentStateMachine and related services — implemented in Phase 1+
export {};
```

```ts
// packages/agent-core/src/index.test.ts
import { describe, it, expect } from 'vitest';
import * as agentCore from './index.js';

describe('agent-core', () => {
  it('exports a module without throwing', () => {
    expect(agentCore).toBeDefined();
  });
});
```

- [ ] **Step 8: Repeat Steps 1–6 for `mcp-server`**

Same structure. Package name: `@repo-pilot/mcp-server`.

```ts
// packages/mcp-server/src/index.ts
// MCP server (stdio transport) — implemented in Phase 2+
export {};
```

```ts
// packages/mcp-server/src/index.test.ts
import { describe, it, expect } from 'vitest';
import * as mcpServer from './index.js';

describe('mcp-server', () => {
  it('exports a module without throwing', () => {
    expect(mcpServer).toBeDefined();
  });
});
```

- [ ] **Step 9: Commit**

```bash
git add packages/
git commit -m "chore: add shared, agent-core, mcp-server stub packages"
```

---

## Task 3: Prisma Schema + Docker

**Files:**
- Create: `prisma/schema.prisma`
- Create: `docker/docker-compose.yml`
- Create: `docker/Dockerfile.sandbox`

- [ ] **Step 1: Create `prisma/schema.prisma`**

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

// Models added in Phase 1
```

- [ ] **Step 2: Create `docker/docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: repopilot
      POSTGRES_USER: repopilot
      POSTGRES_PASSWORD: repopilot
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

- [ ] **Step 3: Create `docker/Dockerfile.sandbox`**

```dockerfile
FROM node:20-alpine
# Sandboxed test execution environment — implemented in Phase 4
```

- [ ] **Step 4: Commit**

```bash
git add prisma/ docker/
git commit -m "chore: add prisma schema stub and docker compose"
```

---

## Task 4: API Package Setup + Env Validation (TDD)

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/vitest.config.ts`
- Create: `apps/api/src/env.ts`
- Create: `apps/api/src/env.test.ts`

- [ ] **Step 1: Write the failing env validation tests**

```ts
// apps/api/src/env.test.ts
import { describe, it, expect } from 'vitest';
import { envSchema, parseEnv } from './env.js';

describe('envSchema', () => {
  it('parses valid env vars', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: 'postgresql://localhost/test',
      ANTHROPIC_API_KEY: 'sk-ant-test',
      TOKEN_ENCRYPTION_KEY: 'test-key',
    });
    expect(result.success).toBe(true);
  });

  it('applies default PORT of 3001', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: 'postgresql://localhost/test',
      ANTHROPIC_API_KEY: 'sk-ant-test',
      TOKEN_ENCRYPTION_KEY: 'test-key',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.PORT).toBe(3001);
    }
  });

  it('applies default REPO_ROOT', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: 'postgresql://localhost/test',
      ANTHROPIC_API_KEY: 'sk-ant-test',
      TOKEN_ENCRYPTION_KEY: 'test-key',
    });
    if (result.success) {
      expect(result.data.REPO_ROOT).toBe('/tmp/repo-pilot/clones');
    }
  });

  it('rejects when DATABASE_URL is missing', () => {
    const result = envSchema.safeParse({
      ANTHROPIC_API_KEY: 'sk-ant-test',
      TOKEN_ENCRYPTION_KEY: 'test-key',
    });
    expect(result.success).toBe(false);
  });

  it('rejects when DATABASE_URL is empty string', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: '',
      ANTHROPIC_API_KEY: 'sk-ant-test',
      TOKEN_ENCRYPTION_KEY: 'test-key',
    });
    expect(result.success).toBe(false);
  });

  it('rejects when ANTHROPIC_API_KEY is missing', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: 'postgresql://localhost/test',
      TOKEN_ENCRYPTION_KEY: 'test-key',
    });
    expect(result.success).toBe(false);
  });

  it('rejects when TOKEN_ENCRYPTION_KEY is missing', () => {
    const result = envSchema.safeParse({
      DATABASE_URL: 'postgresql://localhost/test',
      ANTHROPIC_API_KEY: 'sk-ant-test',
    });
    expect(result.success).toBe(false);
  });
});

describe('parseEnv', () => {
  it('returns typed env when all required vars are present', () => {
    const result = parseEnv({
      DATABASE_URL: 'postgresql://localhost/test',
      ANTHROPIC_API_KEY: 'sk-ant-test',
      TOKEN_ENCRYPTION_KEY: 'test-key',
    });
    expect(result.DATABASE_URL).toBe('postgresql://localhost/test');
    expect(result.PORT).toBe(3001);
  });

  it('throws ZodError when required vars are missing', () => {
    expect(() => parseEnv({})).toThrow();
  });
});
```

- [ ] **Step 2: Create `apps/api/package.json`**

```json
{
  "name": "@repo-pilot/api",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "fastify": "^4",
    "@fastify/cors": "^8",
    "@fastify/helmet": "^11",
    "@prisma/client": "^5",
    "zod": "^3",
    "pino": "^9"
  },
  "devDependencies": {
    "typescript": "*",
    "tsx": "^4",
    "vitest": "*",
    "prisma": "^5",
    "@types/node": "^20"
  },
  "prisma": {
    "schema": "../../prisma/schema.prisma"
  }
}
```

- [ ] **Step 3: Create `apps/api/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create `apps/api/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
  },
});
```

- [ ] **Step 5: Run tests to verify they fail**

First install dependencies:

```bash
pnpm install
```

Then run:

```bash
pnpm --filter @repo-pilot/api test
```

Expected: FAIL — `Cannot find module './env.js'`

- [ ] **Step 6: Create `apps/api/src/env.ts`**

```ts
import { z } from 'zod';

export const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  TOKEN_ENCRYPTION_KEY: z.string().min(1),
  PORT: z.coerce.number().default(3001),
  REPO_ROOT: z.string().default('/tmp/repo-pilot/clones'),
});

export type Env = z.infer<typeof envSchema>;

// Accept an explicit env map so tests can call parseEnv({ ... }) without
// touching process.env, and the server calls parseEnv() with no args.
export function parseEnv(raw: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(raw);
}
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
pnpm --filter @repo-pilot/api test
```

Expected: 9 tests pass.

- [ ] **Step 8: Commit**

```bash
git add apps/api/
git commit -m "feat(api): add package scaffold and env validation"
```

---

## Task 5: API Health Route (TDD)

**Files:**
- Create: `apps/api/src/routes/health.ts`
- Create: `apps/api/src/routes/health.test.ts`

- [ ] **Step 1: Write the failing health route test**

```ts
// apps/api/src/routes/health.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @repo-pilot/api test
```

Expected: FAIL — `Cannot find module './health.js'`

- [ ] **Step 3: Create `apps/api/src/routes/health.ts`**

```ts
import type { FastifyInstance } from 'fastify';

export async function healthRoute(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({
    status: 'ok',
    uptime: process.uptime(),
  }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @repo-pilot/api test
```

Expected: 12 tests pass (9 env + 3 health).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/
git commit -m "feat(api): add GET /health route"
```

---

## Task 6: API Server Bootstrap + Prisma Singleton

**Files:**
- Create: `apps/api/src/db.ts`
- Create: `apps/api/src/index.ts`

- [ ] **Step 1: Run `prisma generate`**

Copy `.env.example` to `.env` and fill in your local values (DATABASE_URL pointing at the Docker postgres), then:

```bash
pnpm --filter @repo-pilot/api exec prisma generate
```

Expected: `✔ Generated Prisma Client` (even with no models, the client generates successfully).

- [ ] **Step 2: Create `apps/api/src/db.ts`**

```ts
import { PrismaClient } from '@prisma/client';

// Singleton prevents multiple PrismaClient instances during tsx hot reload.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db;
}
```

- [ ] **Step 3: Create `apps/api/src/index.ts`**

```ts
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
```

- [ ] **Step 4: Start Docker and verify the server runs**

```bash
docker compose -f docker/docker-compose.yml up -d
pnpm --filter @repo-pilot/api dev
```

In another terminal:

```bash
curl http://localhost:3001/health
```

Expected output:

```json
{"status":"ok","uptime":1.234}
```

- [ ] **Step 5: Run full test suite**

```bash
pnpm --filter @repo-pilot/api test
```

Expected: 12 tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/db.ts apps/api/src/index.ts
git commit -m "feat(api): add server bootstrap and prisma singleton"
```

---

## Task 7: Frontend Scaffold (create-next-app + shadcn + next-themes)

**Files:**
- Create: `apps/web/` (via create-next-app)

- [ ] **Step 1: Scaffold with create-next-app**

```bash
pnpm create next-app apps/web \
  --typescript \
  --tailwind \
  --eslint \
  --app \
  --no-src-dir \
  --import-alias "@/*"
```

When prompted about Turbopack for `next dev`, select **Yes**.

- [ ] **Step 2: Verify it starts**

```bash
pnpm --filter web dev
```

Expected: Next.js dev server starts at `http://localhost:3000`. Default Next.js home page renders. Stop the server.

- [ ] **Step 3: Init shadcn/ui**

Run from the monorepo root (shadcn detects the Next.js app in `apps/web`):

```bash
pnpm --filter web dlx shadcn@latest init
```

If shadcn can't auto-detect the project root, `cd apps/web` first, run `pnpm dlx shadcn@latest init`, then `cd ../..` before continuing.

When prompted:
- Style: **New York**
- Base color: **Zinc**
- CSS variables: **Yes**

- [ ] **Step 4: Add required shadcn components**

```bash
pnpm --filter web dlx shadcn@latest add button separator scroll-area
```

Expected: components added to `apps/web/components/ui/`.

- [ ] **Step 5: Install next-themes**

```bash
pnpm --filter web add next-themes
```

- [ ] **Step 6: Commit**

Run from monorepo root:

```bash
git add apps/web/
git commit -m "feat(web): scaffold Next.js 15 app with shadcn and next-themes"
```

---

## Task 8: Frontend Three-Panel Shell

**Files:**
- Create: `apps/web/components/layout/Sidebar.tsx`
- Create: `apps/web/components/layout/MainPanel.tsx`
- Create: `apps/web/components/layout/RightPanel.tsx`
- Modify: `apps/web/app/layout.tsx`
- Modify: `apps/web/app/page.tsx`

- [ ] **Step 1: Create `apps/web/components/layout/Sidebar.tsx`**

```tsx
export function Sidebar() {
  return (
    <aside className="w-64 border-r border-border flex flex-col shrink-0">
      <div className="p-4 border-b border-border">
        <h1 className="text-sm font-semibold tracking-tight">RepoPilot</h1>
      </div>
      <div className="flex-1 overflow-auto p-4">
        {/* Repos and runs list — Phase 1+ */}
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Create `apps/web/components/layout/MainPanel.tsx`**

```tsx
export function MainPanel() {
  return (
    <main className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-auto p-6">
        {/* Task composer, plan card, step timeline — Phase 1+ */}
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Create `apps/web/components/layout/RightPanel.tsx`**

```tsx
export function RightPanel() {
  return (
    <aside className="w-96 border-l border-border flex flex-col shrink-0">
      <div className="flex-1 overflow-auto p-4">
        {/* Tool trace, diff viewer, test output — Phase 1+ */}
      </div>
    </aside>
  );
}
```

- [ ] **Step 4: Replace `apps/web/app/layout.tsx`**

```tsx
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { ThemeProvider } from 'next-themes';
import { Sidebar } from '@/components/layout/Sidebar';
import { RightPanel } from '@/components/layout/RightPanel';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'RepoPilot',
  description: 'Human-in-the-loop agentic developer assistant',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className} bg-background text-foreground`}>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          <div className="flex h-screen overflow-hidden">
            <Sidebar />
            {children}
            <RightPanel />
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 5: Replace `apps/web/app/page.tsx`**

```tsx
import { MainPanel } from '@/components/layout/MainPanel';

export default function Home() {
  return <MainPanel />;
}
```

- [ ] **Step 6: Start the dev server and verify the layout**

```bash
pnpm --filter web dev
```

Open `http://localhost:3000`. You should see the three-panel layout: a narrow left sidebar, a wide center panel, and a narrower right panel. Dark background by default. No content in any panel — that's correct.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/ apps/web/app/layout.tsx apps/web/app/page.tsx
git commit -m "feat(web): add three-panel layout shell"
```

---

## Task 9: Root Vitest Workspace

**Files:**
- Create: `vitest.workspace.ts`

- [ ] **Step 1: Create `vitest.workspace.ts`**

```ts
import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/shared/vitest.config.ts',
  'packages/agent-core/vitest.config.ts',
  'packages/mcp-server/vitest.config.ts',
  'apps/api/vitest.config.ts',
]);
```

Note: `apps/web` is excluded — Next.js compilation is verified via `next build`, not Vitest.

- [ ] **Step 2: Run the full workspace test suite**

```bash
pnpm test
```

Expected: All tests pass across all four packages (shared, agent-core, mcp-server, api).

- [ ] **Step 3: Run typecheck across all packages**

```bash
pnpm typecheck
```

Expected: No TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add vitest.workspace.ts
git commit -m "chore: add root vitest workspace"
```

---

## Task 10: Final Verification

Run each success criterion from the spec.

- [ ] **`pnpm install` completes without errors**

```bash
pnpm install
```

Expected: No errors, lockfile updated.

- [ ] **`pnpm typecheck` passes across all packages**

```bash
pnpm typecheck
```

Expected: Exit 0, no errors.

- [ ] **`pnpm test` passes**

```bash
pnpm test
```

Expected: All tests green across shared, agent-core, mcp-server, api.

- [ ] **Docker postgres starts**

```bash
docker compose -f docker/docker-compose.yml up -d
docker compose -f docker/docker-compose.yml ps
```

Expected: `postgres` container in state `running`.

- [ ] **`prisma generate` succeeds**

```bash
pnpm --filter @repo-pilot/api exec prisma generate
```

Expected: `✔ Generated Prisma Client`

- [ ] **API health check returns 200**

```bash
pnpm --filter @repo-pilot/api dev &
sleep 3
curl -s http://localhost:3001/health | grep '"status":"ok"'
```

Expected: `{"status":"ok","uptime":...}`

- [ ] **Frontend shell renders**

```bash
pnpm --filter web dev
```

Open `http://localhost:3000`. Three-panel layout renders. Dark mode active. No console errors.

- [ ] **Both apps start together**

```bash
pnpm dev
```

Expected: Both `api` (port 3001) and `web` (port 3000) start concurrently via Turborepo.

- [ ] **Final commit**

```bash
git add -A
git status  # verify nothing unexpected
git commit -m "chore: phase 0 complete — monorepo scaffold verified"
```

# Phase 0 — Monorepo Scaffold Design

**Date:** 2026-05-22
**Status:** Approved
**Scope:** Workspace root, all package stubs, Fastify API skeleton, Next.js 15 shell, Vitest setup, Docker Compose, Prisma schema stub.

---

## 1. Goals

Working monorepo where:
- TypeScript compiles across all packages
- Fastify API starts, validates env, connects to PostgreSQL, and responds to `GET /health`
- Next.js 15 frontend starts with a three-panel layout shell
- `pnpm test` passes (smoke tests) across all packages
- `docker-compose up` brings up a local PostgreSQL instance

No business logic in Phase 0. Structure only.

---

## 2. Scaffold Approach

Manual workspace root + generators. The root config is simple enough to write by hand. `create-next-app` handles Tailwind + shadcn wiring for `apps/web`. The three packages (`mcp-server`, `agent-core`, `shared`) are stubs — a `package.json` and `tsconfig.json` each, no logic yet.

---

## 3. Workspace Root

**Files:**

| File | Purpose |
|---|---|
| `package.json` | pnpm workspace root. Scripts: `dev`, `build`, `lint`, `typecheck`, `test` |
| `pnpm-workspace.yaml` | Globs: `apps/*`, `packages/*` |
| `turbo.json` | Pipeline: `build` (dependency-aware), `test`, `lint`, `typecheck` (independent) |
| `tsconfig.base.json` | Shared strict TypeScript config all packages extend |
| `.env.example` | Documents all required env vars with placeholder values |
| `.gitignore` | Blocks `.env*`, `node_modules`, `.turbo`, clone directories |

**TypeScript base config (`tsconfig.base.json`):**
- `strict: true`
- `target: ES2022`
- `module: NodeNext`
- `moduleResolution: NodeNext`
- `esModuleInterop: true`
- `skipLibCheck: true`

---

## 4. Package Structure

```
apps/
  web/              Next.js 15 App Router frontend
  api/              Fastify 4 backend API
packages/
  shared/           Shared TypeScript types (no runtime deps)
  agent-core/       Stub — AgentStateMachine will live here (Phase 1+)
  mcp-server/       Stub — MCP server will live here (Phase 2+)
prisma/
  schema.prisma     PostgreSQL datasource + client generator, no models yet
docker/
  docker-compose.yml   PostgreSQL 16
  Dockerfile.sandbox   Stub for Phase 4 sandboxed test execution
```

Each package's `tsconfig.json` extends `../../tsconfig.base.json` and sets its own `outDir` and `rootDir`.

---

## 5. Backend — `apps/api`

### Dependencies

**Runtime:** `fastify`, `@fastify/cors`, `@fastify/helmet`, `pino`, `@prisma/client`, `zod`
**Dev:** `typescript`, `tsx`, `vitest`, `prisma`, `@types/node`

### Source Structure

```
apps/api/src/
  index.ts       Server bootstrap — registers plugins, routes, starts listener
  env.ts         Zod schema for env vars; parsed and exported as typed object
  db.ts          Prisma client singleton
  routes/
    health.ts    GET /health route handler
```

### Startup Sequence

1. Parse and validate env vars via Zod at process entry — hard fail if any required var is missing
2. Initialize Prisma client singleton (`src/db.ts`)
3. Register `@fastify/cors` and `@fastify/helmet`
4. Register routes
5. Listen on `PORT` (default `3001`)

### Env Vars (Phase 0)

| Var | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | yes | — | PostgreSQL connection string |
| `ANTHROPIC_API_KEY` | yes | — | Claude API key |
| `TOKEN_ENCRYPTION_KEY` | yes | — | AES-256-GCM key for PAT storage |
| `PORT` | no | `3001` | API listen port |
| `REPO_ROOT` | no | `/tmp/repo-pilot/clones` | Base path for local repo clones |

### Routes (Phase 0)

`GET /health` — Returns `{ status: "ok", uptime: number }`. No auth. This is the only route in Phase 0.

---

## 6. Frontend — `apps/web`

### Setup

- Scaffolded with `create-next-app` (Next.js 15, TypeScript, Tailwind CSS, App Router, no src/ dir)
- shadcn/ui init: style `new-york`, base color `zinc`
- Dark mode via `next-themes`: class-based, default dark
- shadcn components installed in Phase 0: `button`, `separator`, `scroll-area`

### Three-Panel Shell

```
┌──────────────┬─────────────────────────────┬───────────────────┐
│   Sidebar    │         Main Panel          │   Right Panel     │
│  (repos +    │   (task composer, timeline) │  (tool trace,     │
│   runs)      │                             │   diff viewer)    │
│   w-64       │         flex-1              │      w-96         │
└──────────────┴─────────────────────────────┴───────────────────┘
```

**Components (`components/layout/`):**
- `Sidebar.tsx` — left panel, empty placeholder
- `MainPanel.tsx` — center panel, empty placeholder
- `RightPanel.tsx` — right panel, empty placeholder

All panels are structural shells only. No API calls, no state, no SSE in Phase 0.

**Layout wiring:**
- `app/layout.tsx` — wraps everything in `ThemeProvider` (next-themes), renders the three-panel shell
- `app/page.tsx` — renders `<MainPanel />` content area (empty for now)

---

## 7. Testing

### Vitest Setup

- Root `vitest.workspace.ts` references all packages
- Each package has a `vitest.config.ts` extending the shared TypeScript config
- Phase 0: one smoke test per package verifying the module loads without errors
- `pnpm test` at root runs all packages via Turborepo

### Smoke Tests

| Package | Test |
|---|---|
| `apps/api` | Server module imports without throwing; env validation rejects invalid input |
| `apps/web` | Build completes without errors (via `next build` in CI) |
| `packages/shared` | Type exports resolve correctly |
| `packages/agent-core` | Module imports without throwing |
| `packages/mcp-server` | Module imports without throwing |

---

## 8. Docker & Database

### `docker/docker-compose.yml`

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

### `docker/Dockerfile.sandbox`

Stub only in Phase 0:
```dockerfile
FROM node:20-alpine
# Sandbox execution environment — implemented in Phase 4
```

### `prisma/schema.prisma`

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

---

## 9. Success Criteria

Phase 0 is complete when:

- [ ] `pnpm install` completes without errors
- [ ] `pnpm typecheck` passes across all packages
- [ ] `pnpm test` passes (all smoke tests green)
- [ ] `docker-compose up` starts PostgreSQL
- [ ] `pnpm prisma generate` succeeds
- [ ] `pnpm --filter api dev` starts and `GET /health` returns `200`
- [ ] `pnpm --filter web dev` starts and the three-panel shell renders in the browser
- [ ] `pnpm dev` starts both apps concurrently via Turborepo

---

## 10. Out of Scope for Phase 0

- Any business logic (agent, MCP tools, GitHub integration)
- Database models or migrations
- Authentication
- Real UI content beyond the layout shell
- SSE, WebSocket, or real-time features
- Docker sandbox implementation

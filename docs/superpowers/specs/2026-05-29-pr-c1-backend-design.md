# PR C1 — Backend: GitHubService + API Routes

**Date:** 2026-05-29  
**Branch:** `feat/phase-1-pr-c1-backend`  
**Depends on:** PR #10 (agent-core merged to main)

---

## Goal

Wire the agent loop end-to-end on the backend: connect a GitHub repo (PAT-based), clone it locally, start an `AgentStateMachine` run, and stream real-time trace events to the client over SSE. No frontend in this PR — testable via curl/Postman.

**Acceptance criteria:** `POST /api/v1/agent/runs` clones a real GitHub repo, starts the agent, and `GET /api/v1/agent/runs/:id/stream` emits tool calls and state transitions in real time.

---

## Deferred to future

- **GitHub OAuth App** — PAT is used now. OAuth is the target for the production product. When implemented, `EncryptionService` and the `Repository.encryptedToken` column stay the same; only the token acquisition flow changes.
- **Incremental `git fetch`** — re-clone on every run (delete + clone) for now. Optimize to fetch+reset later if clone time becomes a bottleneck.
- **Authentication** — no auth layer in PR C1. A single dev user is created on API startup if none exists (`User.upsert` with a fixed seed ID). All endpoints operate under this user. Real auth (JWT/session) is a Phase 5 concern.
- **Emitter lost on server restart** — if the API process restarts while a run is in progress, the in-memory `EventEmitter` is lost. SSE clients that reconnect will get the current DB state (step history) but won't receive future events. Acceptable for local dev; fix with persistent event log in a later phase.

---

## Architecture

```
POST /api/v1/agent/runs
  → validate body (Zod)
  → load Repository + decrypt PAT (EncryptionService)
  → GitHubService.cloneRepo() — delete if exists, then fresh clone
  → create AgentRun record (status: "running")
  → new AgentStateMachine(runId, prisma, claudeService, mcpClientManager, emitter)
  → sm.start() — fire and forget (no await)
  → respond { runId } immediately

GET /api/v1/agent/runs/:id/stream
  → set SSE headers
  → attach EventEmitter listener
  → pipe events to client until run_completed or run_failed
  → close connection
```

---

## 1. GitHubService

**File:** `packages/agent-core/src/github-service.ts`  
**Tests:** `packages/agent-core/src/github-service.test.ts`

### Methods

```typescript
export class GitHubService {
  constructor(private readonly repoRoot: string) {}

  async cloneRepo(cloneUrl: string, repoId: string, token: string): Promise<string>
  async fetchIssue(owner: string, repo: string, issueNumber: number, token: string): Promise<GitHubIssue>
  async createBranch(repoPath: string, branchName: string): Promise<void>
}

export interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  labels: string[];
}
```

### Clone behavior

1. Compute `repoPath = path.join(repoRoot, repoId)`
2. If `repoPath` exists → delete it entirely (`fs.rm(repoPath, { recursive: true, force: true })`)
3. Clone: `git clone https://x-access-token:{token}@{host}/{owner}/{repo}.git {repoPath}`
4. Return `repoPath`

Token is injected into the HTTPS URL — no `.gitconfig` mutation, no credential helper needed.

### Error types

```typescript
export class GitHubCloneError extends Error {}
export class GitHubIssueNotFoundError extends Error {}
export class GitHubBranchError extends Error {}
```

### Dependencies

- `simple-git` — for clone and branch operations
- `@octokit/rest` — for issue fetch

Add both to `packages/agent-core/package.json` dependencies.

### Tests

Integration tests — real network calls against `github.com/satovarb16/repo-pilot`:

| Test | What it verifies |
|---|---|
| `cloneRepo` on a real repo | Directory created, `package.json` present |
| `cloneRepo` called twice on same repoId | Delete + re-clone, no error, fresh state |
| `cloneRepo` with invalid token | Throws `GitHubCloneError` |
| `fetchIssue` on a known issue | Returns correct title, state, labels |
| `fetchIssue` on non-existent issue | Throws `GitHubIssueNotFoundError` |
| `createBranch` on local clone | Branch exists after call |

Tests require `GITHUB_TEST_TOKEN` env var (read-only PAT with `repo` scope). Skip gracefully if not set.

---

## 2. AgentStateMachine — EventEmitter integration

**File:** `packages/agent-core/src/agent-state-machine.ts` (modify)

Add an optional `EventEmitter` parameter to the constructor:

```typescript
import { EventEmitter } from 'node:events';

export class AgentStateMachine {
  constructor(
    private readonly runId: string,
    private readonly prisma: PrismaClient,
    private readonly claudeService: ClaudeService,
    private readonly mcpClientManager: MCPClientManager,
    private readonly emitter?: EventEmitter,
  ) {}
}
```

Emit events at each key point in `run()`:

```typescript
this.emitter?.emit('event', { type: 'state_changed', state: 'analyzing_repo' });
this.emitter?.emit('event', { type: 'step_started', stepType: 'analyze_repo', description: '...' });
this.emitter?.emit('event', { type: 'tool_called', name, input: args, output: result });
this.emitter?.emit('event', { type: 'step_completed', stepType: 'analyze_repo', durationMs });
this.emitter?.emit('event', { type: 'run_completed', planJson });
this.emitter?.emit('event', { type: 'run_failed', error: message });
```

The `tool_called` event requires intercepting `mcpClientManager.callTool` — wrap the executor passed to `claudeService.sendWithTools` to emit before/after each call.

`emitter` is optional — existing tests pass `undefined` and behavior is unchanged.

### SSE Event types

```typescript
export type AgentSSEEvent =
  | { type: 'state_changed'; state: string }
  | { type: 'step_started'; stepType: string; description: string }
  | { type: 'step_completed'; stepType: string; durationMs: number }
  | { type: 'tool_called'; name: string; input: unknown; output: string }
  | { type: 'run_completed'; planJson: unknown }
  | { type: 'run_failed'; error: string }
```

Export `AgentSSEEvent` from `packages/agent-core/src/index.ts`.

---

## 3. API Routes

**App:** `apps/api/src/`

### New files

```
apps/api/src/
  routes/
    repositories.ts   — POST/GET /api/v1/repositories
    agent-runs.ts     — POST /api/v1/agent/runs + GET /api/v1/agent/runs/:id/stream
  services/
    agent-runner.ts   — wires GitHubService + AgentStateMachine + EventEmitter per run
```

### Repository routes

**`POST /api/v1/repositories`**

```typescript
// Body
{ githubRepoId: number, owner: string, name: string, cloneUrl: string, pat: string }

// Response 201
{ id: string, owner: string, name: string, cloneStatus: string }
```

- Validates body with Zod
- Encrypts `pat` with `EncryptionService` using `TOKEN_ENCRYPTION_KEY` from env
- Creates `Repository` record in DB
- Returns repository (never returns the PAT)

**`GET /api/v1/repositories`**

```typescript
// Response 200
{ repositories: Array<{ id, owner, name, cloneUrl, cloneStatus, createdAt }> }
```

- Returns all repositories (no PAT fields)

### Agent run routes

**`POST /api/v1/agent/runs`**

```typescript
// Body
{ repositoryId: string, taskDescription: string }

// Response 201
{ runId: string }
```

- Validates body
- Loads `Repository` from DB, decrypts PAT
- Creates `AgentRun` record (`status: "running"`, `currentState: "idle"`)
- Calls `agentRunner.start(runId, repository, taskDescription)` — fire and forget
- Returns `{ runId }` immediately

**`GET /api/v1/agent/runs/:id/stream`**

SSE endpoint — `Content-Type: text/event-stream`.

```
data: {"type":"state_changed","state":"analyzing_repo"}

data: {"type":"tool_called","name":"list_files","input":{},"output":"src/index.ts\n..."}

data: {"type":"run_completed","planJson":[...]}
```

- Attaches to the `EventEmitter` for the run (stored in `agentRunner` by `runId`)
- Pipes all `AgentSSEEvent` as `data: {json}\n\n`
- Closes on `run_completed` or `run_failed`
- If run not found → 404
- If run already finished → sends last known state immediately and closes

### AgentRunner service

```typescript
// apps/api/src/services/agent-runner.ts
export class AgentRunner {
  private readonly emitters = new Map<string, EventEmitter>();

  async start(runId: string, repo: Repository, taskDescription: string): Promise<void>
  getEmitter(runId: string): EventEmitter | undefined
}
```

`start()` creates the `EventEmitter`, stores it by `runId`, builds `MCPClientManager` + `ClaudeService` + `AgentStateMachine`, calls `sm.start()`, and removes the emitter from the map on `run_completed`/`run_failed`.

`ANTHROPIC_API_KEY`, `REPO_ROOT`, and `TOKEN_ENCRYPTION_KEY` are read from env at startup.

---

## 4. Environment variables

Add to `.env.example`:

```
ANTHROPIC_API_KEY=sk-ant-...
TOKEN_ENCRYPTION_KEY=32-byte-hex-string
REPO_ROOT=/tmp/repo-pilot/clones
GITHUB_TEST_TOKEN=ghp_...   # only for tests, read-only PAT
```

---

## 5. Dependencies to add

| Package | Where | Why |
|---|---|---|
| `simple-git` | `packages/agent-core` | Clone + branch operations |
| `@octokit/rest` | `packages/agent-core` | GitHub API (issue fetch) |

---

## 6. Testing strategy

### GitHubService (integration, real network)
- Requires `GITHUB_TEST_TOKEN` env var
- Tests against `github.com/satovarb16/repo-pilot`
- Skipped in CI if token not available

### AgentStateMachine EventEmitter (unit)
- Mock emitter, verify correct events emitted in correct order
- Existing 6 tests unchanged (emitter is optional)

### API routes (integration, real DB)
- `POST /api/v1/repositories` — creates record, PAT never returned
- `POST /api/v1/agent/runs` — returns runId, run created in DB
- `GET /api/v1/agent/runs/:id/stream` — SSE events received in correct order (mock AgentRunner)

---

## Security invariants

- PAT encrypted at rest with AES-256-GCM before DB insert — never stored or logged in plaintext
- Token injected into clone URL in memory — never written to `.gitconfig` or any file
- `REPO_ROOT` validated on every file operation (PathValidator already enforces this in MCP server)
- SSE endpoint does not expose PAT or encryption key in any event payload

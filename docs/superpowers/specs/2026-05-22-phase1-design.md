# Phase 1 Design: MCP Server, Repo Analysis Agent, and GitHub Connect

**Date:** 2026-05-22  
**Phase:** 1 of 5  
**Status:** Approved

---

## Goal

Phase 1 takes RepoPilot from a monorepo scaffold (Phase 0) to a working agent that connects to a real GitHub repository, analyzes it through a real MCP server, and produces a structured plan visible in the UI. No inline tool implementations — MCP protocol from day one.

**Acceptance criteria:** Connect AlgoArena repo. Submit "explain the structure of this repo." Agent uses real MCP tools (`list_files`, `read_file`, `search_repo`), produces a plan, plan appears in the UI. Tool trace shows real MCP calls with inputs and outputs.

---

## Delivery Strategy

Phase 1 is split into 5 vertical PRs. Each PR has its own branch, its own test suite, and delivers a clearly observable result before the next PR begins.

| PR | Branch | Contents | Observable result |
|----|--------|----------|-------------------|
| 1 | `feat/phase-1-foundation` | Prisma schema (full §11 migration) + `shared/types.ts` + SecretRedactor + PathValidator + EncryptionService | All unit tests pass; `pnpm prisma migrate dev` creates all tables |
| 2 | `feat/phase-1-mcp-server` | MCP server: 5 read tools + 3 resources + 2 prompts, stdio transport | `node packages/mcp-server/dist/index.js` responds correctly to MCP calls |
| 3 | `feat/phase-1-agent-core` | ClaudeService + MCPClientManager + AgentStateMachine (idle → analyzing_repo → planning → waiting_for_plan_approval) | State machine tests pass; ClaudeService executes a real tool call |
| 4 | `feat/phase-1-api` | GitHubService (clone + issue fetch) + `POST /api/agent/runs` + `GET /api/agent/runs/:id` + `GET /api/agent/runs` | `curl POST /api/agent/runs` creates a run and transitions to `analyzing_repo` in DB |
| 5 | `feat/phase-1-frontend` | Repo connection card + task composer + step timeline (polling 2s) + plan card | Full Phase 1 demo visible in the browser |

---

## Architecture

### Packages involved

- **`packages/shared`** — TypeScript types shared across all packages and apps
- **`packages/mcp-server`** — `repo-agent-mcp-server`, spawned as a child process by the API
- **`packages/agent-core`** — AgentStateMachine, ClaudeService, MCPClientManager, SecretRedactor, PathValidator, EncryptionService
- **`apps/api`** — Fastify routes, AgentOrchestrator, GitHubService
- **`apps/web`** — Next.js frontend components for Phase 1

### Runtime topology

```
Browser (polling GET every 2s)
    ↕ REST
Fastify API
    → AgentOrchestrator
        → AgentStateMachine (persists transitions to DB via Prisma)
        → ClaudeService (Anthropic SDK, tool use)
            ↕ tool calls
        → MCPClientManager (spawns child process over stdio)
            ↕ MCP stdio protocol
        → repo-agent-mcp-server
            → local repo clone (REPO_ROOT)
```

---

## Data Flow (Agent Loop, Phase 1)

```
1. User → POST /api/agent/runs { repoId, taskDescription }
         → creates AgentRun in DB (status: "created", state: "idle")
         → AgentOrchestrator.start(runId)

2. AgentOrchestrator
         → AgentStateMachine: idle → analyzing_repo
         → persists AgentStep "analyze" in DB
         → MCPClientManager spawns repo-agent-mcp-server (child process, stdio)
         → ClaudeService.sendWithTools(analyze_repo_prompt, tools: [list_files, search_repo, read_file])

3. Claude API ↔ MCPClientManager (tool call loop)
         → Claude calls list_files / search_repo / read_file
         → MCPClientManager translates to MCP stdio calls
         → MCP server executes and returns results
         → SecretRedactor applied before result reaches Claude
         → Claude produces plan JSON

4. AgentStateMachine: analyzing_repo → planning → waiting_for_plan_approval
         → planJson saved to AgentRun.planJson
         → AgentStep "plan" persisted as completed

5. Frontend → GET /api/agent/runs/:id (polling every 2s)
         → sees currentState: "waiting_for_plan_approval"
         → renders plan card with Approve / Reject buttons
```

---

## PR 1 — Foundation

### Prisma Schema Migration

Apply the full schema from architecture.md §11. All 9 models: `User`, `Repository`, `AgentRun`, `AgentStep`, `ToolCall`, `Approval`, `FileChange`, `TestRun`, `PullRequest`. Migration name: `phase1_full_schema`.

### `packages/shared/src/types.ts`

Exported types:

```typescript
type AgentRunStatus = "created" | "running" | "waiting" | "complete" | "failed"
type AgentState = "idle" | "analyzing_repo" | "planning" | "waiting_for_plan_approval" | ...
type ApprovalType = "plan" | "edit" | "test-run" | "pr"
type ToolPermissionLevel = "read" | "write-pending" | "destructive"

// API response shapes
interface AgentRunResponse { id, repoId, taskDescription, status, currentState, planJson, steps, createdAt, updatedAt }
interface AgentStepResponse { id, stepNumber, stepType, description, status, errorMessage, createdAt, completedAt }
```

### `packages/agent-core/src/secret-redactor.ts`

Regex patterns (applied in order):

```
/^[A-Z_]+=.*/gm               → .env key=value lines
/sk-[a-zA-Z0-9]{32,}/g        → OpenAI/Stripe-style keys
/ghp_[a-zA-Z0-9]{36}/g        → GitHub PATs
/-----BEGIN.*PRIVATE KEY-----/ → Private key headers
/Bearer [a-zA-Z0-9\-._~+/]+=*/g → Bearer tokens
```

All matches replaced with `[REDACTED]`. Redaction events logged (not the content).

### `packages/agent-core/src/path-validator.ts`

```typescript
function validatePath(inputPath: string, repoRoot: string): string {
  const resolved = path.resolve(repoRoot, inputPath)
  if (!resolved.startsWith(path.resolve(repoRoot))) {
    throw new Error("Path traversal attempt blocked.")
  }
  return resolved
}
```

Runs before every file operation. Fails closed — no exceptions.

### `packages/agent-core/src/encryption-service.ts`

AES-256-GCM encrypt/decrypt for PAT storage. Key from `TOKEN_ENCRYPTION_KEY` env var. Methods: `encrypt(plaintext): string`, `decrypt(ciphertext): string`.

---

## PR 2 — MCP Server

**Package:** `packages/mcp-server`  
**Transport:** stdio  
**SDK:** `@modelcontextprotocol/sdk`  
**Startup:** receives `REPO_ROOT` env var; all tool calls validate paths against it.

### Tools

| Tool | Permission | Input | Output |
|------|-----------|-------|--------|
| `list_files` | read | `{ directory: string }` | `{ entries: [{ name, type, path }] }` |
| `search_repo` | read | `{ query: string, fileGlob?: string }` | `{ matches: [{ file, lineNumber, lineContent }] }` — uses ripgrep |
| `read_file` | read | `{ path: string }` | `{ content: string, lineCount: number, language: string }` — SecretRedactor applied |
| `get_github_issue` | read | `{ issueNumber: number }` | `{ number, title, body, labels, state }` |
| `get_diff` | read | `{}` | `{ diff: string, filesChanged: number, insertions: number, deletions: number }` |

Hard-coded blocklist: `.env*`, `*.pem`, `*.key`, `id_rsa`, `id_ed25519`, `secrets.json`, `credentials.json`, `.npmrc`, `.netrc`.

### Resources

| URI | Mime | Source |
|-----|------|--------|
| `repo://README.md` | `text/markdown` | local clone |
| `repo://package.json` | `application/json` | local clone |
| `repo://open-issues` | `application/json` | GitHub API proxy via backend |

### Prompts

- `analyze_repo_prompt` — args: `{ task: string }`. Primes Claude to read repo structure first, then produce a plan.
- `fix_bug_prompt` — args: `{ task: string, relevantFiles: string[] }`. Focused on targeted changes with file context.

---

## PR 3 — Agent Core

### `ClaudeService`

Wraps `@anthropic-ai/sdk`. Single method for Phase 1:

```typescript
sendWithTools(prompt: string, tools: Tool[], messages: Message[]): Promise<ClaudeResponse>
```

- Applies `SecretRedactor` to all tool call results before returning to Claude
- Logs token usage after each call
- Retries once on rate limit (exponential backoff)

### `MCPClientManager`

Spawns `repo-agent-mcp-server` as a child process over stdio. Wraps each tool call with:
- Correlation ID for request/response matching
- Timeout (30s per tool call)
- Logging (tool name, duration, success/error)
- Graceful teardown on agent completion or error

### `AgentStateMachine` (Phase 1 states)

States implemented in Phase 1:

```
idle → analyzing_repo → planning → waiting_for_plan_approval
```

Each transition:
1. Updates `AgentRun.currentState` in DB
2. Creates/updates `AgentStep` record with status and timestamps
3. Emits event for `AgentOrchestrator` to act on

Failure handling: any unrecoverable error transitions to an implicit `failed` state, persists `errorMessage`.

---

## PR 4 — API Routes

### `GitHubService`

- `cloneRepo(repoUrl: string, token: string, destPath: string): Promise<void>` — uses `simple-git`
- `fetchIssues(owner: string, repo: string, token: string): Promise<Issue[]>` — uses Octokit
- Token is always decrypted by `EncryptionService` before use; never logged

### Routes

```
POST /api/v1/repos/connect
  Body:    { repoUrl, patToken }
  Returns: { repoId, status: "cloning" }
  Logic:   Validate PAT via GitHub API, encrypt token, persist Repository, fire-and-forget async clone (no queue — single-user MVP)

GET  /api/v1/repos
  Returns: [{ id, owner, name, status, lastSynced }]

POST /api/v1/agent/runs
  Body:    { repoId, taskDescription }
  Returns: { runId, status: "created" }
  Logic:   Creates AgentRun, starts AgentOrchestrator

GET  /api/v1/agent/runs
  Returns: [{ id, repoId, taskDescription, status, createdAt }]

GET  /api/v1/agent/runs/:id
  Returns: Full run object with currentState, steps[]
```

---

## PR 5 — Frontend

### Components

**Repo Connection Card** (`apps/web/src/components/repo-connection-card.tsx`)  
Fields: GitHub repo URL, PAT input (masked). Clone button. Shows clone status badge.

**Task Composer** (`apps/web/src/components/task-composer.tsx`)  
Textarea with placeholder. "Start Agent" button. Warning if task < 20 chars.

**Step Timeline** (`apps/web/src/components/step-timeline.tsx`)  
Polls `GET /api/agent/runs/:id` every 2s. Shows each `AgentStep` with status icon (pending / running / completed / failed).

**Plan Card** (`apps/web/src/components/plan-card.tsx`)  
Renders `AgentRun.planJson` as a numbered list. "Approve Plan" and "Reject" buttons (wired up in Phase 2).

### Data fetching

Simple polling with `useEffect` + `setInterval` — no SWR, no React Query in Phase 1. SSE is introduced in Phase 2.

---

## Error Handling

| Failure point | Behavior |
|---|---|
| MCP child process crashes | `MCPClientManager` detects exit event → state machine transitions to `failed` → error persisted in `AgentStep.errorMessage` |
| Claude API error / rate limit | `ClaudeService` retries 1x with backoff → if still failing, transitions to `failed` |
| GitHub clone fails (bad PAT, repo not found) | `GitHubService` throws descriptive error → API returns 400, run not created |
| `validatePath()` detects traversal | Throws immediately → tool call returns error to agent → filesystem never touched |
| `SecretRedactor` finds sensitive content | Replaces with `[REDACTED]`, logs occurrence, continues |
| Plan JSON malformed from Claude | State machine retries planning call 1x → if still malformed, transitions to `failed` |
| DB connection lost | Prisma throws → bubbles to route handler → 500 returned to client |

**Principle:** Fail closed. Ambiguous or failed state → stop and report, never continue.

---

## Testing Strategy

Strict TDD Mode is active. Tests are written before implementation for each PR.

| PR | Test type | What is covered |
|----|-----------|----------------|
| 1 | Unit | SecretRedactor — all regex patterns (.env, PAT, private key, bearer token) |
| 1 | Unit | PathValidator — `../` traversal, absolute paths outside REPO_ROOT, valid paths |
| 1 | Unit | EncryptionService — encrypt/decrypt round-trip, invalid key behavior |
| 2 | Integration | Each MCP tool handler against a real local repo fixture (no mocked FS) |
| 2 | Integration | Resources — README.md, package.json read from fixture repo |
| 3 | Unit | AgentStateMachine — all Phase 1 state transitions and failure paths |
| 3 | Unit | ClaudeService — tool call with mocked Anthropic SDK |
| 3 | Integration | MCPClientManager — spawn, tool call round-trip, teardown |
| 4 | Integration | GitHubService — clone and issue fetch (mocked Octokit) |
| 4 | Integration | POST /api/agent/runs → run created + state machine starts |
| 5 | Manual | Visual verification in browser before PR is opened |

MCP server integration tests use a local repo fixture, not a mocked filesystem. This matches the CLAUDE.md constraint and catches real path resolution issues.

---

## Security Constraints (Phase 1)

- `ANTHROPIC_API_KEY` — Anthropic API, pay-per-use. Claude Pro/Max subscriptions are consumer products and do not provide API access. Document in README with Bedrock/Vertex migration path.
- `TOKEN_ENCRYPTION_KEY` — AES-256-GCM key for PAT storage. Never logged. Never sent to Claude.
- `REPO_ROOT` — base path for local clones. MCP server never touches anything outside this path.
- All file reads go through `validatePath()` and the blocklist check before any filesystem access.
- `SecretRedactor` runs on all content before it reaches the Claude API.

---

## Known Risks

| Risk | Mitigation |
|------|-----------|
| MCP stdio framing issues | Add correlation IDs and timeouts in MCPClientManager; log all frames during dev |
| Child process lifecycle leaks | Explicit teardown on agent completion AND error; test spawn/teardown in isolation |
| Claude tool use format changes between SDK versions | Pin exact `@anthropic-ai/sdk` version; add integration test that does a real tool call |
| Async state machine race conditions | All state transitions go through a single async queue; no concurrent transitions |
| GitHub clone timing for large repos | Clone is async; API returns immediately with `status: "cloning"`; poll for ready state |

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

RepoPilot is a human-in-the-loop agentic developer assistant. It connects to a GitHub repo, accepts natural-language coding tasks, and orchestrates a structured agent loop using the Claude API as the reasoning engine and a custom MCP server as the tool layer. The full architecture and phased implementation plan are in `docs/architecture.md`.

## Monorepo Structure

Turborepo monorepo managed with `pnpm` workspaces:

```
apps/
  web/          Next.js 15 App Router frontend
  api/          Fastify 4.x backend API
packages/
  mcp-server/   repo-agent-mcp-server (stdio transport, spawned as child process)
  agent-core/   AgentStateMachine, ClaudeService, SecretRedactor, path validator
  shared/       Shared TypeScript types across all packages
prisma/
  schema.prisma PostgreSQL schema (managed by Prisma)
docker/
  docker-compose.yml    PostgreSQL + API
  Dockerfile.sandbox    Isolated test execution environment
```

## Common Commands

```bash
# Start all apps in dev mode
pnpm dev

# Run a specific app
pnpm --filter web dev
pnpm --filter api dev

# Database
pnpm prisma migrate dev --name <name>
pnpm prisma generate
pnpm prisma studio

# Tests (run from workspace root or specific package)
pnpm test
pnpm --filter agent-core test

# Build
pnpm build
pnpm --filter <package-name> build

# Lint / type check
pnpm lint
pnpm typecheck
```

## Architecture

### Request Flow

Browser → Fastify API (REST + SSE) → AgentOrchestrator → MCPClientManager (stdio) → repo-agent-mcp-server → local repo clone / Docker sandbox / Claude API / GitHub API

The frontend stays live via SSE (`GET /api/v1/agent/runs/:id/stream`), not polling.

### Key Backend Services

- **AgentOrchestrator** — owns the `AgentStateMachine` per run; drives Claude API calls, MCP sessions, approval gates, and DB state transitions
- **MCPClientManager** — spawns `repo-agent-mcp-server` as a child process over stdio; wraps all tool calls with logging and error handling
- **GitHubService** (Octokit) — clone, branch create, commit, PR. All write operations are gated by approval checks before this service is invoked
- **SecretRedactor** — applied to all file contents and tool outputs before forwarding to Claude API; regex-based patterns for `.env`, GitHub PATs, private key blocks, bearer tokens, etc.
- **SandboxRunner** — builds a Docker image from the local clone, mounts proposed changes, runs the test command, collects output, destroys the container

### Agent State Machine

`idle → analyzing_repo → planning → waiting_for_plan_approval → editing → waiting_for_edit_approval → waiting_for_test_run_approval → running_tests → reviewing → waiting_for_pr_approval → opening_pr → complete`

Failed tests trigger `repairing` (max 2 iterations) before `failed`. Every state transition is persisted to `AgentStep` in the database.

### MCP Server

Runs as a sidecar process with `REPO_ROOT` env var. Operates on the local clone.

- **Read tools** (`list_files`, `read_file`, `search_repo`, `get_diff`, `get_github_issue`) — auto-approved, work directly on the clone
- **Write tools** (`propose_file_edit`, `write_file`) — `propose_file_edit` stages a `FileChange` record and requests approval; `write_file` validates the `changeId` is approved in the DB before writing
- **Destructive tools** (`create_branch`, `commit_changes`, `open_pull_request`) — require explicit PR approval; branches are always prefixed `repo-pilot/{run-id}`

### Security Invariants

- `write_file` checks approval status in the database as the authoritative source — not just in-memory state
- `validatePath()` runs before every file operation; fails closed on `../` traversal, absolute paths outside `REPO_ROOT`
- Hard-coded blocklist of files never read: `.env*`, `*.pem`, `*.key`, `id_rsa`, `secrets.json`, etc.
- GitHub PAT stored AES-256-GCM encrypted; never logged, never sent to Claude
- Docker sandbox runs with `--network none`; containers destroyed after test completion; test commands must match an allowlist
- Agent never commits to `main` or `master`

### Frontend Stack

Next.js 15 App Router, TypeScript, Tailwind CSS, shadcn/ui, `react-diff-viewer-continued`. Three-panel dashboard: left sidebar (repos/runs), center (task composer, plan card, step timeline, approval gates), right panel (tool trace, diff viewer, test output).

## Branch & Documentation Strategy

- Branch naming: `feat/phase-{N}-{slice-label}` → PR → merge → delete branch
  - Phases with a single PR use a short descriptor (e.g. `feat/phase-0-scaffold`, `feat/phase-1-agent-core`)
  - Phases split into backend/frontend slices use `pr-{slice}-{layer}` (e.g. `feat/phase-2-pr-d1-backend`, `feat/phase-2-pr-d2-frontend`)
- Documentation (`docs/`) is updated **after** the phase, task, or feature is fully done and stable — never speculatively
- `CLAUDE.md` phases section must be updated when a PR is merged — not before

## Implementation Phases

Development follows 5 phases defined in `docs/architecture.md` §14:

0. Monorepo scaffold + DB + layout shell ✓
1. MCP server + repo analysis agent + GitHub clone ✓
   - PR #5 ✓: shared types, SecretRedactor, PathValidator, EncryptionService
   - PR #7 ✓: MCP server (list_files, read_file, search_repo, get_diff, get_github_issue)
   - PR #10 ✓: MCPClientManager, ClaudeService, AgentStateMachine, GitHubService
   - PR #11 ✓: Backend API routes (repos, agent runs, SSE stream)
   - PR #12 ✓: Frontend — Zustand store, ConnectRepoDialog, TaskComposer, TraceLog
2. File edit proposals + diff viewer + SSE ✓
   - PR #13/#14 ✓: propose_file_edit, write_file, approval endpoints, SSE
   - PR #15 ✓: PlanApprovalCard, FileEditApproval, DiffViewer, MainPanel wiring
3. Docker-sandboxed test runner + repair loop ✓
   - PR #16 ✓ (D1 backend): SandboxRunner, run_tests MCP tool, repair loop, test approval gate
   - PR #17 ✓ (D2 frontend): TestApprovalCard, TestOutputPanel, SSE wiring, MainPanel conditional rendering
4. Branch, commit, PR integration
5. Trace viewer, security hardening, demo polish

The first 10 concrete implementation tasks are listed in §15.

## Environment Variables

See `.env.example` (to be created). Critical vars:

- `DATABASE_URL` — PostgreSQL connection string
- `ANTHROPIC_API_KEY` — Claude API key
- `TOKEN_ENCRYPTION_KEY` — AES-256-GCM key for PAT storage
- `REPO_ROOT` — base path for local repo clones (e.g. `/tmp/repo-pilot/clones`)

## Testing & CI/CD

### Testing Strategy

- Unit tests live alongside source files (`*.test.ts`) in each package
- Integration tests live in `tests/` at the package root
- Run all tests from workspace root: `pnpm test`
- Run tests for a specific package: `pnpm --filter <package-name> test`
- Agent-core has the highest test coverage requirement — all state transitions and security invariants must be covered
- MCP server tool handlers must have integration tests against a real local repo fixture (not mocked FS)
- Do not mock the database in integration tests; use a dedicated test database via `DATABASE_URL` env override

### CI/CD Pipeline

- All PRs must pass lint, typecheck, and tests before merge
- `pnpm lint && pnpm typecheck && pnpm test` is the required gate
- Docker sandbox image is built and smoke-tested in CI using the `Dockerfile.sandbox`
- No direct commits to `main`; all changes go through PRs
- Environment secrets (`ANTHROPIC_API_KEY`, `TOKEN_ENCRYPTION_KEY`) are injected via CI secrets — never hardcoded

## Frontend Design Style

The web UI follows a **clean, minimal, and stylish with personality** design language:

- Generous whitespace — let the content breathe; avoid cramped layouts
- Neutral base palette (slate/zinc grays) with one intentional accent color used sparingly
- Typography-forward: hierarchy through font weight and size, not decorative elements
- Subtle animations and transitions — present but never distracting
- Personality through micro-details: thoughtful empty states, sharp iconography, precise spacing
- shadcn/ui components are the baseline; customize them to match this aesthetic rather than using defaults as-is
- Avoid gradients, drop shadows, and visual noise unless they serve a clear purpose
- Every UI element should feel intentional — if you can't justify why it's there, remove it

## Code Comments

This project overrides the global "no comments by default" rule. Add a brief orientation comment every ~20 lines so someone unfamiliar with the codebase can follow the flow without tracing every call.

- Do **not** explain what the code does if well-named identifiers already make it clear
- Do **not** add comments that will rot (e.g. referencing a specific issue number or caller name)
- Do add a short line when the logic would surprise a competent developer on first read

## Tooling

This project uses the **gentle-ai SDD workflow** (see global CLAUDE.md for the full skill list and model assignments).

Project-specific overrides:
- **Strict TDD mode is active** — every `sdd-apply` must follow test RED → implement GREEN. Do not skip.
- Run `pnpm --filter @repo-pilot/agent-core build` before restarting the API after any change to `packages/agent-core` — the API imports from `dist/`, not source.
- `code-review` before every push; `security-review` before merging anything that touches approval gates, secret redaction, or path validation.

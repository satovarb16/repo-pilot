# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

RepoPilot is a human-in-the-loop agentic developer assistant. It connects to a GitHub repo, accepts natural-language coding tasks, and orchestrates a structured agent loop using the Claude API as the reasoning engine and a custom MCP server as the tool layer. The full architecture and phased implementation plan are in `docs/architecture.md`.

## Monorepo Structure

Turborepo monorepo managed with `pnpm` workspaces:

```
apps/
  web/          Next.js 14 App Router frontend
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

Next.js 14 App Router, TypeScript, Tailwind CSS, shadcn/ui, `react-diff-viewer-continued`. Three-panel dashboard: left sidebar (repos/runs), center (task composer, plan card, step timeline, approval gates), right panel (tool trace, diff viewer, test output).

## Implementation Phases

Development follows 6 phases defined in `docs/architecture.md` §14:

0. Monorepo scaffold + DB + layout shell
1. Local-only repo analysis agent (inline tools, no MCP yet)
2. MCP server with read-only tools + GitHub clone
3. File edit proposals + diff viewer + SSE
4. Docker-sandboxed test runner + repair loop
5. Branch, commit, PR integration
6. Trace viewer, security hardening, demo polish

The first 10 concrete implementation tasks are listed in §15.

## Environment Variables

See `.env.example` (to be created). Critical vars:

- `DATABASE_URL` — PostgreSQL connection string
- `ANTHROPIC_API_KEY` — Claude API key
- `TOKEN_ENCRYPTION_KEY` — AES-256-GCM key for PAT storage
- `REPO_ROOT` — base path for local repo clones (e.g. `/tmp/repo-pilot/clones`)

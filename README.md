# RepoPilot

RepoPilot is a human-in-the-loop agentic developer assistant. You give it a natural-language coding task and a GitHub repository; it inspects the codebase, produces a structured plan for your approval, proposes file edits (with a per-file diff you approve before anything is written), runs your test suite inside a Docker sandbox, and opens a pull request — all with explicit approval gates at every destructive step. No file is written, no test is run, and no commit is made without your say-so.

## Prerequisites

### Ollama (local LLM runtime)

RepoPilot uses [Ollama](https://ollama.com) as its LLM backend instead of a cloud API. You need Ollama running locally before starting the server.

1. Install Ollama: https://ollama.com/download
2. Pull a tool-capable model:
   ```bash
   ollama pull qwen2.5-coder:7b
   ```
   `qwen2.5-coder:7b` is the default model. For better results on complex repos, use `qwen2.5-coder:14b` or `qwen2.5-coder:32b` (set via `OLLAMA_MODEL` env var).
3. Verify Ollama is running: `curl http://localhost:11434/api/tags`

### Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `TOKEN_ENCRYPTION_KEY` | Yes | — | AES-256-GCM key for PAT storage |
| `MCP_SERVER_PATH` | Yes | — | Absolute path to the built MCP server (`packages/mcp-server/dist/index.js`) |
| `OLLAMA_BASE_URL` | No | `http://localhost:11434` | Ollama server URL |
| `OLLAMA_MODEL` | No | `qwen2.5-coder:7b` | Model name (must support function calling/tool use) |
| `REPO_ROOT` | No | `/tmp/repo-pilot/clones` | Base path for local repo clones |
| `MAX_CONCURRENT_RUNS` | No | `2` | Max simultaneous agent runs (`0` = unlimited) |
| `DOCKER_SOCKET` | No | — | Docker socket path for sandboxed test execution |

> Note: `ANTHROPIC_API_KEY` is no longer used and should be removed from your `.env` file.

## Key Features

- **Real MCP server** — tool calls go through a proper stdio MCP sidecar process, not inline function wrappers
- **Approval gates at every step** — plan, per-file edit, test run, and PR each require explicit user approval
- **Secret redaction** — all file contents and tool outputs are scrubbed of `.env` values, PATs, private keys, and bearer tokens before reaching the LLM
- **Docker-sandboxed test execution** — tests run in an isolated container with `--network none`; the container is destroyed after the run
- **Full tool trace viewer** — every MCP call is shown with its inputs, outputs, and duration so you can audit exactly what the agent did
- **PostgreSQL audit log** — all tool calls, approvals, diffs, and state transitions are persisted for the lifetime of each run

## Architecture

```
Browser (Next.js)
    │  REST + SSE
    ▼
Fastify API  ──  AgentOrchestrator (state machine)
    │                    │
    │  stdio/IPC         ▼
    └──────────▶  repo-agent-mcp-server
                         │
              ┌──────────┼──────────┐
              ▼          ▼          ▼
        Local clone   Docker    Ollama API
        (file ops)   sandbox   (local LLM)
                                    │
                               GitHub API
                               (Octokit)
```

The agent follows a strict state machine: `analyzing_repo → planning → waiting_for_plan_approval → editing → waiting_for_edit_approval → running_tests → reviewing → waiting_for_pr_approval → opening_pr → complete`. Every transition is logged to the database.

See [`docs/architecture.md`](docs/architecture.md) for the full system diagram, state machine spec, MCP tool definitions, DB schema, and phased implementation plan.

## Tech Stack

| Layer | Technologies |
|---|---|
| Frontend | Next.js 15 App Router, TypeScript, Tailwind CSS, shadcn/ui, react-diff-viewer-continued |
| Backend | Fastify 4, TypeScript, Prisma, PostgreSQL 16 |
| Agent | Ollama (OpenAI-compatible), MCP TypeScript SDK |
| GitHub | Octokit REST |
| Infra | Turborepo, pnpm workspaces, Docker |

## Security Model

- GitHub PAT stored AES-256-GCM encrypted at rest; never logged, never sent to Claude
- `write_file` validates approval status in the database as the authoritative source — not in-memory state
- Path traversal prevention runs on every file operation; fails closed on `../` and absolute paths outside `REPO_ROOT`
- Hard-coded blocklist of files never read: `.env*`, `*.pem`, `*.key`, `id_rsa`, `secrets.json`, and others
- Docker sandbox enforces `--network none`, restricted volume mounts, a test command allowlist, and a 120-second timeout
- Agent never commits to `main` or `master`; all branches use the `repo-pilot/{run-id}` prefix

## Implementation Status

| Phase | Description | Status |
|---|---|---|
| 0 | Monorepo scaffold, DB, layout shell | ✅ Complete |
| 1 | MCP server, agent loop, GitHub connect, frontend | ✅ Complete |
| 2 | File edit proposals, diff viewer, approval gates | 🔲 Next |
| 3 | Docker-sandboxed test runner + repair loop | 🔲 Planned |
| 4 | Branch, commit, PR integration | 🔲 Planned |
| 5 | Trace viewer, security hardening, demo polish | 🔲 Planned |

## Documentation

Full specification in [`docs/architecture.md`](docs/architecture.md), including:

- Complete system diagram
- Agent state machine with allowed tools and failure paths per state
- All 12 MCP tool definitions with permission levels
- PostgreSQL schema (Prisma)
- Claude system prompt and per-phase prompt templates
- Phased implementation plan (6 phases, first 10 tasks)
- Demo script for the AlgoArena walkthrough

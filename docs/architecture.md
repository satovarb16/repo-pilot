# RepoPilot: Architecture & Planning Document

---

## 1. Project Summary

RepoPilot is a human-in-the-loop agentic developer assistant that connects to a GitHub repository, accepts natural-language coding tasks, and orchestrates a structured agent loop using Claude as the reasoning engine and a custom MCP server as the tool layer. The agent inspects the codebase, produces a structured plan for user approval, proposes file edits, runs tests inside a Docker sandbox, shows a diff, and optionally creates a pull request — all with explicit user approval gates at every destructive step. The project demonstrates three things clearly to any recruiter: fluency with the Claude API and agentic patterns, hands-on MCP server authorship, and the discipline to build secure, production-minded tooling rather than a toy chatbot.

---

## 2. MVP Definition

The MVP is a working end-to-end demo on a single repository that proves the full agent loop functions correctly.

**In scope for MVP:**
- Connect one GitHub repository (via fine-grained PAT, cloned locally)
- Single-user, no auth system needed for demo
- Task input → repo analysis → plan → approval → file edits → approval → test run → approval → diff view → PR creation
- MCP server with the 12 core tools (read-only + write-behind-approval)
- Docker sandboxed test execution for `npm test` or `pytest` (detected from package.json or requirements.txt)
- Diff viewer showing proposed changes
- Tool trace viewer showing every MCP call with inputs/outputs
- Approval gates: plan, edit, test run, PR
- PostgreSQL persistence of runs, steps, tool calls, approvals
- Security: secret redaction, path traversal prevention, read-only default mode
- Demo on AlgoArena repo with the alarm validation task

**Success criteria for MVP:** A recruiter can watch you demo the full loop — from typing the task to opening a real pull request on AlgoArena — in under 5 minutes, with no crashes.

---

## 3. Non-MVP Features (Defer These)

Cut everything below until the MVP demo is rock solid:

| Feature | Why to Defer |
|---|---|
| Multi-user auth (NextAuth, Clerk) | Adds weeks of complexity; demo is single-user |
| GitHub App OAuth | PAT is sufficient and faster to set up |
| Redis caching | PostgreSQL handles MVP load |
| Multiple simultaneous agent runs | One run at a time is safer and simpler |
| Parallel tool calls within the agent | Sequential is easier to debug and approve |
| Streaming Claude responses | Polling or SSE is fine for MVP |
| VS Code extension | Separate product, build the web UI first |
| Autonomous repair loops beyond 2 iterations | Cap at 2 repair attempts for safety |
| Support for monorepos or multi-file refactors | Start with bounded, single-area tasks |
| AI-generated test file creation from scratch | Editing existing tests is much safer |
| Cost tracking per run | Add in Phase 6 |
| Team collaboration features | Out of scope entirely |
| Self-hosted LLM fallback | Claude API only |

---

## 4. Recommended Architecture

**Framework choices, with reasoning:**

**Fastify over Express.** Fastify is async-first, generates TypeScript types from JSON Schema validation declarations, includes pino logging out of the box, and is 2-3x faster on I/O-bound workloads. For an agent orchestrator that makes dozens of async calls per run (Claude API, GitHub API, MCP tools), Fastify's native async/await model produces cleaner code and better error propagation than Express middleware chains.

**Turborepo monorepo.** The MCP server, agent core logic, and backend share types heavily (tool definitions, approval states, run schemas). A single TypeScript monorepo with shared packages prevents duplication and ensures the type system enforces consistency across all layers.

**MCP server as a sidecar process.** The MCP server runs as a separate Node.js process alongside the backend API. The backend spawns and manages it. This is how production MCP deployments work and it lets you demonstrate the full MCP protocol rather than embedding tools inline.

**Docker for test sandboxing.** The agent never runs `npm test` directly on your host. It builds a Docker image from the repo, mounts the proposed changes, and runs the test command inside. This is the single most important architectural decision for security credibility.

**PostgreSQL + Prisma.** Approval state, trace records, and diff storage need ACID guarantees. Redis would add nothing that PostgreSQL cannot handle at this scale. Prisma generates clean TypeScript types and handles migrations reliably.

**No Redis in MVP.** Add it only if you observe polling lag on the trace viewer in Phase 6. Premature optimization here would add operational complexity with no measurable benefit.

---

## 5. Full System Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            BROWSER (Next.js)                                │
│                                                                              │
│  ┌─────────────┐  ┌──────────────────────────────┐  ┌───────────────────┐  │
│  │  Left Panel │  │       Center Panel            │  │   Right Panel     │  │
│  │             │  │                               │  │                   │  │
│  │ - Repos     │  │  Task Input                   │  │  Tool Trace       │  │
│  │ - Past Runs │  │  Agent Plan Card              │  │  File Inspector   │  │
│  │ - Settings  │  │  Step Timeline                │  │  Diff Viewer      │  │
│  │ - Security  │  │  Approval Gates               │  │  Test Results     │  │
│  └─────────────┘  └──────────────────────────────┘  └───────────────────┘  │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │  HTTPS REST + SSE
                                   ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                         FASTIFY API SERVER (Node.js/TS)                      │
│                                                                              │
│   ┌─────────────────┐    ┌──────────────────┐    ┌───────────────────────┐  │
│   │  Route Handlers │    │  Agent Orchestr. │    │  GitHub Service       │  │
│   │  /api/repos     │    │  (State Machine) │    │  (Octokit)            │  │
│   │  /api/agent/    │    │                  │    │                       │  │
│   │  runs/*         │    │  Manages:        │    │  - clone repo         │  │
│   └────────┬────────┘    │  - Claude calls  │    │  - create branch      │  │
│            │             │  - MCP client    │    │  - commit / PR        │  │
│            ▼             │  - approvals     │    └───────────────────────┘  │
│   ┌─────────────────┐    │  - state persist │                               │
│   │  Prisma ORM     │    └────────┬─────────┘                               │
│   │  (PostgreSQL)   │             │                                          │
│   └─────────────────┘             │  MCP stdio/IPC                          │
└──────────────────────────────────┼──────────────────────────────────────────┘
                                   │
                                   ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                     repo-agent-mcp-server (Node.js/TS)                       │
│                                                                              │
│   Tools:                Resources:              Prompts:                     │
│   list_files             repo://README.md        analyze_repo_prompt         │
│   search_repo            repo://package.json     fix_bug_prompt              │
│   read_file              repo://open-issues      write_tests_prompt          │
│   propose_file_edit      repo://current-diff     review_diff_prompt          │
│   write_file             repo://test-results/    create_pr_summary_prompt    │
│   get_diff               repo://agent-plan/                                  │
│   run_tests              latest                                               │
│   run_linter                                                                 │
│   create_branch          Operates on:                                        │
│   commit_changes         /tmp/repo-pilot/clones/{repo_id}/                   │
│   open_pull_request                                                          │
│   get_github_issue                                                           │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │  reads/writes local clone
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       LOCAL REPO CLONE                                       │
│   /tmp/repo-pilot/clones/{repo_id}/                                         │
│                                                                              │
│   Sandboxed test execution:        Secret redaction layer:                  │
│   ┌───────────────────────────┐    ┌────────────────────────────┐           │
│   │  Docker container         │    │  Before any file content    │           │
│   │  - mounts proposed files  │    │  reaches Claude API:        │           │
│   │  - runs test command only │    │  - scrub .env patterns      │           │
│   │  - exits, no persistence  │    │  - scrub API key patterns   │           │
│   └───────────────────────────┘    │  - scrub private key blocks │           │
│                                    └────────────────────────────┘           │
└─────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
                     ┌─────────────────────────┐
                     │   Claude API (Anthropic) │
                     │   claude-sonnet-4-6      │
                     │   Tool use / streaming   │
                     └─────────────────────────┘
                                   │
                                   ▼
                     ┌─────────────────────────┐
                     │   GitHub API             │
                     │   (Octokit REST)         │
                     │   Scoped PAT             │
                     └─────────────────────────┘
```

---

## 6. Frontend Design Specification

**Stack:** Next.js 15 App Router, TypeScript, Tailwind CSS, shadcn/ui, react-diff-viewer-continued (Monaco is overkill for diff-only display; use it only for the file editor pane if you add one later).

**Color palette:** Background `#0d0f12`, surface `#161a1f`, border `#1f2937`, accent blue `#3b82f6`, accent green `#22c55e`, accent amber `#f59e0b`, destructive red `#ef4444`. Monospace font: JetBrains Mono or Fira Code via `next/font`.

### Layout (Three-panel dashboard)

```
┌────────────────────────────────────────────────────────────────────────────┐
│  ● RepoPilot          [READ-ONLY]  →  [WRITE PENDING APPROVAL]             │ ← Header
│                       Security mode indicator            [Token usage: 2.1k]│
├──────────────┬──────────────────────────────────┬─────────────────────────┤
│ REPOS        │                                  │  TOOL TRACE             │
│              │  ┌──────────────────────────┐   │                         │
│ AlgoArena ●  │  │  Task Composer            │   │  ► list_files("src/")  │
│              │  │  ─────────────────────── │   │    [completed] 12ms    │
│ PAST RUNS    │  │  Find duplicate alarm...  │   │                         │
│              │  │  [Start Agent →]          │   │  ► search_repo("alarm")│
│ #8 ✓ alarm   │  └──────────────────────────┘   │    [completed] 34ms    │
│ #7 ✗ login   │                                  │                         │
│ #6 ✓ tests   │  Agent Plan              [→]     │  ► read_file(...)      │
│              │  ┌──────────────────────────┐   │    [completed] 8ms     │
│ SETTINGS     │  │  1. Inspect alarm logic   │   │                         │
│ SECURITY     │  │  2. Add validation        │   │  FILES INSPECTED        │
│              │  │  3. Update tests          │   │  src/alarms/model.ts   │
│              │  │  [Approve Plan] [Reject]  │   │  src/alarms/service.ts │
│              │  └──────────────────────────┘   │  tests/alarms.test.ts  │
│              │                                  │                         │
│              │  Step Timeline                   │  CURRENT DIFF           │
│              │  ┌──────────────────────────┐   │  ┌─────────────────┐   │
│              │  │  ✓ Repo analyzed          │   │  │ - old code      │   │
│              │  │  ✓ Plan created           │   │  │ + new code      │   │
│              │  │  ● Editing files...       │   │  └─────────────────┘   │
│              │  │  ○ Run tests              │   │                         │
│              │  │  ○ Open PR                │   │  TEST RESULTS           │
│              │  └──────────────────────────┘   │  [Pending approval]     │
│              │                                  │                         │
│              │  ┌──────────────────────────┐   │                         │
│              │  │  APPROVAL GATE           │   │                         │
│              │  │  write_file proposed     │   │                         │
│              │  │  src/alarms/service.ts   │   │                         │
│              │  │  [View Diff] [Approve ✓] │   │                         │
│              │  │            [Reject ✗]    │   │                         │
│              │  └──────────────────────────┘   │                         │
└──────────────┴──────────────────────────────────┴─────────────────────────┘
```

### Key UI Components

**Repo Connection Card**
Fields: GitHub repo URL or `owner/repo`, PAT input (masked, stored server-side only), clone button. Shows clone status, branch, last synced.

**Task Composer**
Textarea with placeholder: "Describe the task in plain English. The agent will inspect the repo first." Submit button labeled "Start Agent". No streaming chat — this is a task runner, not a chatbot. Show a warning if task description is under 20 characters.

**Agent Plan Card**
Numbered list of proposed steps, each showing: step name, files likely to be touched, estimated risk level (read / write / destructive). Two buttons: "Approve Plan" and "Reject & Rephrase". This is the first hard gate.

**Approval Gate Card**
Shown inline in the timeline whenever the agent needs permission. Displays: action type, affected file or resource, preview button, approve/reject. Color-coded: amber for writes, red for commits/PRs.

**Tool-Call Timeline**
Vertical list of every MCP tool call in order. Each entry shows: tool name, key input parameter, status (pending/running/completed/failed), duration. Clicking expands to show full input JSON and output JSON. This is the transparency showpiece.

**Diff Viewer**
Split-panel using `react-diff-viewer-continued`. Original left, proposed right. Line numbers. Syntax highlighting. Scrollable. Collapsed by default for large files.

**Test Output Panel**
Terminal-style panel with `font-mono`, dark background slightly different from surface, shows stdout/stderr from test run. Exit code badge: green 0, red non-zero.

**Security Mode Indicator**
Persistent badge in header. Three states: `READ-ONLY` (gray), `WRITE PENDING APPROVAL` (amber), `PR APPROVED` (green). Changes based on current agent state. Clicking it opens the Security page.

**Cost/Token Estimate**
Small counter in header: `~2.1k tokens used`. Updated after each Claude API call. Non-blocking, informational only.

---

## 7. Backend API Specification

**Framework:** Fastify 4.x with TypeScript, `@fastify/cors`, `@fastify/helmet`, pino logger.

**Base path:** `/api/v1`

### Endpoint Specification

```
POST   /repos/connect
  Body:    { repoUrl: string, patToken: string }
  Returns: { repoId: string, status: "cloning" }
  Logic:   Validate PAT against GitHub API, store encrypted token,
           enqueue clone job, return immediately.

GET    /repos
  Returns: [{ id, owner, name, status, lastSynced }]

GET    /repos/:id/issues
  Returns: [{ number, title, body, labels }]
  Logic:   Proxies GitHub issues API, no caching in MVP.

POST   /agent/runs
  Body:    { repoId: string, taskDescription: string }
  Returns: { runId: string, status: "created" }
  Logic:   Creates DB record, emits start event to agent orchestrator.

GET    /agent/runs
  Returns: [{ id, repoId, taskDescription, status, createdAt }]

GET    /agent/runs/:id
  Returns: Full run object with current state, steps, approvals.

GET    /agent/runs/:id/stream
  Returns: SSE stream. Emits: step_started, step_completed, tool_called,
           approval_required, state_changed, run_completed, run_failed.
  Note:    This is how the frontend stays live without polling.

POST   /agent/runs/:id/approve-plan
  Body:    { approved: boolean, feedback?: string }
  Returns: { status: "resumed" | "cancelled" }
  Logic:   Unblocks the agent state machine from waiting_for_plan_approval.

POST   /agent/runs/:id/approve-edit
  Body:    { approved: boolean, filePath: string }
  Returns: { status: "resumed" | "skipped" }

POST   /agent/runs/:id/approve-test-run
  Body:    { approved: boolean }
  Returns: { status: "resumed" | "skipped" }

POST   /agent/runs/:id/approve-pr
  Body:    { approved: boolean, prTitle?: string, prBody?: string }
  Returns: { status: "resumed" | "cancelled" }

GET    /agent/runs/:id/trace
  Returns: [{ toolName, input, output, durationMs, createdAt }]

GET    /agent/runs/:id/diff
  Returns: { files: [{ path, originalContent, proposedContent, diffHtml }] }

GET    /agent/runs/:id/test-results
  Returns: { command, exitCode, stdout, stderr, durationMs, status }
```

### Backend Internal Services

**AgentOrchestrator:** Central class that holds the agent state machine instance per run. Receives approval events, drives the next state, manages Claude API calls, manages MCP client sessions.

**MCPClientManager:** Spawns the `repo-agent-mcp-server` process, manages the stdio connection, wraps tool calls with logging and error handling.

**GitHubService:** Wraps Octokit. Handles clone, branch create, commit, PR open. All write operations are gated behind approval checks before this service is called.

**SecretRedactor:** Called on all file contents and tool outputs before they are forwarded to the Claude API. Regex-based with patterns for `.env` key-value pairs, AWS keys, JWT tokens, private key blocks, and bearer tokens.

**SandboxRunner:** Builds Docker image from local repo, mounts proposed changes, runs test command, collects output, destroys container.

---

## 8. MCP Server Specification

**Package name:** `repo-agent-mcp-server`  
**Transport:** stdio (spawned as child process by the API server)  
**Working directory:** Bound to a specific repo clone path passed at startup via environment variable `REPO_ROOT`.

**Architecture recommendation: Option D, Hybrid.**

For read operations (`list_files`, `read_file`, `search_repo`, `get_diff`), the MCP server works directly on the local clone. This is fast, avoids network round-trips, and is sufficient. For write operations (`write_file`, `create_branch`, `commit_changes`, `open_pull_request`), the MCP server does NOT act autonomously. It validates the operation, prepares it, and then calls back to the backend API which enforces the approval gate check before executing. This gives you a clean separation: MCP handles the tool interface and repo filesystem access; the backend owns authorization and state.

### MCP Resources

```
repo://README.md
  Description: Root README of the connected repository.
  Mime type:   text/markdown
  Notes:       Read from local clone. No secrets concern.

repo://package.json
  Description: Package manifest (Node) or pyproject.toml (Python).
  Mime type:   application/json
  Notes:       Used by agent to detect test commands.

repo://open-issues
  Description: List of open GitHub issues (title, number, body, labels).
  Mime type:   application/json
  Notes:       Fetched from GitHub API via backend proxy. Cached for 5 min.

repo://current-diff
  Description: Git diff of all staged changes in the working clone.
  Mime type:   text/plain
  Notes:       Output of `git diff HEAD` on the local clone.

repo://test-results/latest
  Description: stdout, stderr, exit code of most recent test run.
  Mime type:   application/json
  Notes:       Written by SandboxRunner after test completion.

repo://agent-plan/latest
  Description: The structured plan produced by the agent in the planning phase.
  Mime type:   application/json
  Notes:       Written by agent orchestrator, read by frontend.
```

### MCP Prompts

```
analyze_repo_prompt
  Arguments: { task: string }
  Purpose:   Primes Claude to read repo structure first, then produce a plan.

fix_bug_prompt
  Arguments: { task: string, relevantFiles: string[] }
  Purpose:   Focused prompt for a targeted bug fix with file context.

write_tests_prompt
  Arguments: { targetFile: string, existingTestFile?: string }
  Purpose:   Instructs Claude to inspect existing test patterns and extend.

review_diff_prompt
  Arguments: { diff: string }
  Purpose:   Asks Claude to describe what changed and flag any concerns.

create_pr_summary_prompt
  Arguments: { task: string, diff: string, testResults: string }
  Purpose:   Produces PR title, body, and checklist for review.
```

---

## 9. Agent State Machine

The agent is a class `AgentStateMachine` that holds current state and transitions based on Claude outputs and user approvals. Each transition is logged to the database.

```
┌─────────┐
│  idle   │
└────┬────┘
     │ run created + task submitted
     ▼
┌──────────────────┐
│  analyzing_repo  │  TOOLS ALLOWED: list_files, search_repo, read_file,
│                  │                 get_github_issue, resources (all)
│                  │  APPROVAL: none
│                  │  OUTPUT: list of relevant files + summary
│                  │  FAILURE: repo not cloned, tool error
└────────┬─────────┘
         │ analysis complete
         ▼
┌──────────────────┐
│    planning      │  TOOLS ALLOWED: none (Claude reasons over analysis)
│                  │  APPROVAL: none
│                  │  OUTPUT: structured plan JSON with steps[]
│                  │  FAILURE: Claude produces malformed plan (retry once)
└────────┬─────────┘
         │ plan produced
         ▼
┌──────────────────────────┐
│  waiting_for_plan_       │  TOOLS ALLOWED: none
│  approval                │  APPROVAL: USER REQUIRED — approve or reject plan
│                          │  OUTPUT: approved/rejected signal
│                          │  FAILURE: user rejects → back to planning with feedback
└────────┬─────────────────┘
         │ plan approved
         ▼
┌──────────────────┐
│    editing       │  TOOLS ALLOWED: read_file, propose_file_edit
│                  │  NOTE: propose_file_edit does NOT write yet.
│                  │  It stages the change and requests approval.
│                  │  APPROVAL: none yet (approval triggered per-file)
│                  │  OUTPUT: proposed diff per file
│                  │  FAILURE: file not found, Claude produces invalid patch
└────────┬─────────┘
         │ edit proposed for each file
         ▼
┌────────────────────────────┐
│  waiting_for_edit_         │  TOOLS ALLOWED: none
│  approval                  │  APPROVAL: USER REQUIRED per file
│                            │  OUTPUT: write_file called only after approval
│                            │  FAILURE: user rejects edit → agent can revise once
└────────┬───────────────────┘
         │ all edits approved and written
         ▼
┌──────────────────────────┐
│  waiting_for_test_run_   │  TOOLS ALLOWED: none
│  approval                │  APPROVAL: USER REQUIRED before running tests
│                          │  OUTPUT: approved/rejected signal
│                          │  FAILURE: user skips → go directly to reviewing
└────────┬─────────────────┘
         │ test run approved
         ▼
┌──────────────────┐
│  running_tests   │  TOOLS ALLOWED: run_tests, run_linter
│                  │  NOTE: executed inside Docker sandbox
│                  │  APPROVAL: none (already approved above)
│                  │  OUTPUT: exit code, stdout, stderr
│                  │  FAILURE: Docker unavailable, command not in allowlist
└────────┬─────────┘
         │ tests pass (exit 0)           │ tests fail (exit non-0)
         ▼                               ▼
┌──────────────┐               ┌──────────────────┐
│  reviewing   │               │    repairing     │  TOOLS: read_file, propose_file_edit
│              │               │                  │  MAX: 2 repair iterations
│              │               │                  │  APPROVAL: per-edit approval
│              │               └────────┬─────────┘
│              │                        │ still failing after 2 attempts
│              │                        ▼
│              │               ┌──────────────────┐
│              │               │     failed       │  Explain what failed, show last diff
│              │               └──────────────────┘
│              │ tests pass or test run skipped
│              ▼
│  reviewing   │  TOOLS: get_diff, resources (current-diff, test-results)
│              │  APPROVAL: none
│              │  OUTPUT: agent writes PR title, body, summary
└──────┬───────┘
       │
       ▼
┌─────────────────────────────┐
│  waiting_for_pr_approval    │  TOOLS ALLOWED: none
│                             │  APPROVAL: USER REQUIRED — approve or cancel PR
│                             │  OUTPUT: approved/cancelled signal
└────────┬────────────────────┘
         │ PR approved
         ▼
┌──────────────────┐
│   opening_pr     │  TOOLS ALLOWED: create_branch, commit_changes,
│                  │                 open_pull_request
│                  │  APPROVAL: none (already approved above)
│                  │  OUTPUT: GitHub PR URL
│                  │  FAILURE: GitHub API error, token permissions
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│    complete      │  Final summary shown to user. PR link displayed.
└──────────────────┘
```

---

## 10. Security and Permissions Model

### Authentication

**MVP approach:** Fine-grained GitHub Personal Access Token (PAT), scoped to a single repository. Required permissions: `Contents: Read and Write`, `Pull requests: Read and Write`, `Issues: Read-only`. No repo delete, no admin, no webhook. Store the token AES-256-GCM encrypted at rest using a `TOKEN_ENCRYPTION_KEY` env variable. Never log the raw token. Never send it to Claude. Never include it in tool call inputs or outputs.

**Why not GitHub App for MVP:** OAuth App/GitHub App setup requires a registered application, callback URLs, and more infrastructure. A scoped fine-grained PAT is demonstrably safe and appropriate for a portfolio project. Note this limitation honestly in your README and describe the GitHub App migration path.

### Approval Gates

| Action | Gate Level | Who Approves |
|---|---|---|
| Read any file | Auto-approved | None |
| Search repo | Auto-approved | None |
| View diff | Auto-approved | None |
| Propose file edit (no write yet) | Auto-approved | None |
| Write file to disk | **User approval required** | Per file |
| Run tests in Docker | **User approval required** | Once per run |
| Create branch | **User approval required** | Covered by PR approval |
| Commit changes | **User approval required** | Covered by PR approval |
| Open pull request | **User approval required** | Explicit PR approval |

### Path Traversal Prevention

Every file path in every MCP tool call must be validated against `REPO_ROOT` before execution:

```typescript
function validatePath(inputPath: string, repoRoot: string): string {
  const resolved = path.resolve(repoRoot, inputPath);
  if (!resolved.startsWith(path.resolve(repoRoot))) {
    throw new Error("Path traversal attempt blocked.");
  }
  return resolved;
}
```

This runs before every `read_file`, `write_file`, and `propose_file_edit` call. No exceptions.

### Secret Redaction

Applied to all file contents and tool outputs before forwarding to Claude API. Regex patterns to scrub:

```
- /^[A-Z_]+=.*/gm               → .env key=value lines
- /sk-[a-zA-Z0-9]{32,}/g        → OpenAI/Stripe-style keys
- /ghp_[a-zA-Z0-9]{36}/g        → GitHub PATs
- /-----BEGIN.*PRIVATE KEY-----/ → Private key headers
- /Bearer [a-zA-Z0-9\-._~+/]+=*/g → Bearer tokens
- /[0-9a-f]{32,64}/g             → Generic hex secrets (conservative)
```

Replaced with `[REDACTED]`. Log when redaction occurs (not what was redacted).

### Files Never Read

Hard-coded blocklist. MCP server refuses to read these regardless of path validation:

```
.env, .env.local, .env.production, .env.development
*.pem, *.key, *.p12, *.pfx
id_rsa, id_ed25519, authorized_keys
.npmrc, .netrc
secrets.json, credentials.json
```

### Docker Sandbox Rules

- Container gets no network access (`--network none`)
- Container gets no write access outside its own temp directory
- Test command must match allowlist: `npm test`, `npm run test`, `pytest`, `python -m pytest`, `cargo test`, `go test ./...`
- Container is destroyed after test completion regardless of exit code
- Maximum test timeout: 120 seconds
- No volume mounts outside the repo clone directory

### Branch Protection

The agent must never commit to `main` or `master`. `create_branch` always creates a new branch with pattern `repo-pilot/{run-id}`. The `commit_changes` tool verifies the current HEAD is on this branch before committing.

### Audit Log

Every tool call is persisted to the `tool_calls` table with: run ID, tool name, full input JSON, full output JSON (after redaction), timestamp, duration, and approval status. This is the paper trail.

---

## 11. Database Schema

**Engine:** PostgreSQL 15, managed via Prisma.

```prisma
model User {
  id                String        @id @default(cuid())
  email             String?       @unique
  createdAt         DateTime      @default(now())
  repositories      Repository[]
  agentRuns         AgentRun[]
}

model Repository {
  id                String        @id @default(cuid())
  userId            String
  user              User          @relation(fields: [userId], references: [id])
  githubRepoId      Int
  owner             String
  name              String
  cloneUrl          String
  localClonePath    String?
  cloneStatus       String        @default("pending")  // pending|cloning|ready|error
  encryptedToken    String        // AES-256-GCM encrypted PAT
  lastSyncedAt      DateTime?
  createdAt         DateTime      @default(now())
  agentRuns         AgentRun[]

  @@unique([userId, githubRepoId])
}

model AgentRun {
  id                String        @id @default(cuid())
  userId            String
  user              User          @relation(fields: [userId], references: [id])
  repoId            String
  repo              Repository    @relation(fields: [repoId], references: [id])
  taskDescription   String
  status            String        @default("created")  // created|running|waiting|complete|failed
  currentState      String        @default("idle")     // agent state machine state
  branchName        String?
  planJson          Json?
  summaryText       String?
  createdAt         DateTime      @default(now())
  updatedAt         DateTime      @updatedAt
  steps             AgentStep[]
  toolCalls         ToolCall[]
  approvals         Approval[]
  fileChanges       FileChange[]
  testRuns          TestRun[]
  pullRequest       PullRequest?
}

model AgentStep {
  id                String        @id @default(cuid())
  runId             String
  run               AgentRun      @relation(fields: [runId], references: [id])
  stepNumber        Int
  stepType          String        // analyze|plan|edit|test|repair|review|pr
  description       String
  status            String        @default("pending")  // pending|running|completed|failed|skipped
  errorMessage      String?
  createdAt         DateTime      @default(now())
  completedAt       DateTime?
  toolCalls         ToolCall[]
}

model ToolCall {
  id                String        @id @default(cuid())
  runId             String
  run               AgentRun      @relation(fields: [runId], references: [id])
  stepId            String?
  step              AgentStep?    @relation(fields: [stepId], references: [id])
  toolName          String
  inputJson         Json
  outputJson        Json?
  permissionLevel   String        // read|write-pending|destructive
  approved          Boolean?
  durationMs        Int?
  createdAt         DateTime      @default(now())
}

model Approval {
  id                String        @id @default(cuid())
  runId             String
  run               AgentRun      @relation(fields: [runId], references: [id])
  approvalType      String        // plan|edit|test-run|pr
  filePath          String?       // set for per-file edit approvals
  status            String        @default("pending")  // pending|approved|rejected
  feedback          String?
  decidedAt         DateTime?
  createdAt         DateTime      @default(now())
}

model FileChange {
  id                String        @id @default(cuid())
  runId             String
  run               AgentRun      @relation(fields: [runId], references: [id])
  filePath          String
  changeType        String        // modified|created
  originalContent   String?       @db.Text
  proposedContent   String?       @db.Text
  diffContent       String?       @db.Text
  approved          Boolean?
  writtenAt         DateTime?
  createdAt         DateTime      @default(now())
}

model TestRun {
  id                String        @id @default(cuid())
  runId             String
  run               AgentRun      @relation(fields: [runId], references: [id])
  command           String
  status            String        // running|passed|failed|timeout
  exitCode          Int?
  stdout            String?       @db.Text
  stderr            String?       @db.Text
  durationMs        Int?
  dockerImage       String?
  createdAt         DateTime      @default(now())
}

model PullRequest {
  id                String        @id @default(cuid())
  runId             String        @unique
  run               AgentRun      @relation(fields: [runId], references: [id])
  githubPrNumber    Int?
  githubPrUrl       String?
  title             String
  body              String        @db.Text
  branchName        String
  status            String        @default("draft")  // draft|opened|merged|closed
  createdAt         DateTime      @default(now())
}
```

---

## 12. Claude System Prompt

This is the system prompt injected at the start of every agent run.

```
You are RepoPilot, an AI agent that helps developers automate codebase tasks safely.

## Role
You are a careful, methodical software engineer. You inspect repositories,
propose changes, run tests, and help open pull requests. You never take
destructive actions without explicit human approval.

## Safety Rules
1. You operate in read-only mode by default.
2. You must never write to a file without the user approving that specific file.
3. You must never run tests, linters, or shell commands without user approval.
4. You must never commit or push changes without user approval.
5. You must never create or open a pull request without user approval.
6. You must never access .env files, private keys, or credentials.
7. You must never read files outside the designated REPO_ROOT directory.
8. If you are uncertain whether an action is safe, stop and ask.

## Repo Boundaries
- You may only read and write files within the repo you were given.
- If a path you need is outside that repo, report it and stop.
- The repo root is provided by the REPO_ROOT resource.

## How to Plan
When given a task:
1. First use list_files and search_repo to find relevant files.
2. Read those files fully before proposing any changes.
3. Produce a structured plan with numbered steps.
4. Each step must specify: what you will do, which files you will touch, and why.
5. Do not begin editing until the user approves the plan.

## How to Edit
- Use propose_file_edit to describe changes before writing.
- Wait for per-file approval before calling write_file.
- Make minimal, targeted edits. Do not refactor unrelated code.
- Preserve existing code style, indentation, and conventions.
- If you cannot make a change safely, say why instead of guessing.

## How to Handle Tests
- Detect the test command from package.json or detected language.
- Only use test commands from the allowed list.
- Read test results fully before deciding whether to repair.
- Attempt repair at most twice. If still failing, explain and stop.
- Never modify test files to make them pass artificially.

## When to Stop
Stop and report to the user if:
- You cannot find the files relevant to the task.
- The test command is not in the allowed list.
- Two repair iterations have not resolved failing tests.
- You encounter a file you suspect contains secrets.
- Any tool call returns an error you cannot resolve.

## Summarizing Results
After completing the task, produce a clear summary:
- What you found in the codebase.
- What changes you made and why.
- Test results.
- The PR title and body you recommend.
Keep the summary factual and under 300 words.
```

### Prompt Templates (Injected Per Phase)

**analyze_repo_prompt**
```
Task: {task}

Begin by exploring the repository. Call list_files on the root and relevant
subdirectories. Then call search_repo to find files related to the task.
Read the most relevant files. After reading, produce a structured plan.
Do not propose any edits yet.
```

**fix_bug_prompt**
```
Task: {task}
Relevant files already read: {relevantFiles}

Now propose the minimal code changes needed to address the task.
For each file you want to change, call propose_file_edit with a clear
description of the change and the reason for it.
```

**write_tests_prompt**
```
Target file: {targetFile}
Existing test file: {existingTestFile}

Read the existing test patterns in the test file. Then propose new or
updated tests that cover the changes made. Follow the existing test style.
Do not remove existing tests.
```

**review_diff_prompt**
```
Current diff: {diff}
Test results: {testResults}

Review what changed. Describe each change in plain language.
Flag any concerns. Then produce a draft PR title and body.
```

**create_pr_summary_prompt**
```
Task: {task}
Changes made: {diffSummary}
Test results: {testResults}

Write a GitHub pull request title (under 70 characters) and body
(markdown, 3-5 bullet points summarizing changes, plus test evidence).
```

---

## 13. MCP Tool Definitions

Permission levels: `read` (auto-approved), `write-pending` (requires user approval), `destructive` (requires explicit PR approval).

```
list_files
  Description:  List files and directories at a given path within the repo.
  Permission:   read
  Input:        { directory: string }   // relative to REPO_ROOT
  Output:       { entries: [{ name, type: "file"|"dir", path }] }
  Validation:   path traversal check on directory

search_repo
  Description:  Full-text search across all files in the repo.
  Permission:   read
  Input:        { query: string, fileGlob?: string }
  Output:       { matches: [{ file, lineNumber, lineContent, context }] }
  Notes:        Uses ripgrep under the hood for speed.

read_file
  Description:  Read the content of a single file.
  Permission:   read
  Input:        { path: string }
  Output:       { content: string, lineCount: number, language: string }
  Notes:        Secret redaction applied before content is returned to Claude.
                Blocklisted filenames are rejected with an error.

propose_file_edit
  Description:  Stage a proposed edit. Does NOT write the file.
                Creates a FileChange record and triggers an approval request.
  Permission:   read (no write occurs until user approves)
  Input:        { path: string, instructions: string, proposedContent: string }
  Output:       { changeId: string, diffPreview: string, status: "pending_approval" }
  Notes:        The frontend shows an approval card when this is called.

write_file
  Description:  Write approved content to a file. Only callable after approval.
  Permission:   write-pending
  Input:        { path: string, content: string, changeId: string }
  Output:       { written: boolean, path: string }
  Validation:   changeId must reference an approved FileChange record.
                Rejects if changeId is unapproved.

get_diff
  Description:  Return the git diff of all staged changes.
  Permission:   read
  Input:        {}
  Output:       { diff: string, filesChanged: number, insertions: number, deletions: number }

run_tests
  Description:  Run the detected test command inside a Docker sandbox.
                Only callable after user has approved the test run step.
  Permission:   write-pending
  Input:        { command?: string }   // if omitted, auto-detected from package.json
  Output:       { exitCode: number, stdout: string, stderr: string, durationMs: number }
  Validation:   command must match allowlist. Sandbox enforced. Network disabled.

run_linter
  Description:  Run the project linter (eslint, flake8) inside Docker sandbox.
  Permission:   write-pending
  Input:        { command?: string }
  Output:       { exitCode: number, stdout: string, issues: number }
  Validation:   Same allowlist as run_tests.

create_branch
  Description:  Create a new branch in the local clone.
  Permission:   destructive
  Input:        { branchName: string }
  Output:       { created: boolean, branchName: string }
  Notes:        branchName is prefixed with "repo-pilot/" automatically.
                Refuses to create if branchName is "main" or "master".

commit_changes
  Description:  Stage all written files and create a commit.
  Permission:   destructive
  Input:        { message: string }
  Output:       { committed: boolean, commitHash: string }
  Validation:   Verifies current branch is a "repo-pilot/" branch.

open_pull_request
  Description:  Push the branch and open a GitHub pull request.
  Permission:   destructive
  Input:        { title: string, body: string, baseBranch?: string }
  Output:       { prUrl: string, prNumber: number }
  Notes:        baseBranch defaults to "main". Requires PR approval in DB.

get_github_issue
  Description:  Fetch a single GitHub issue by number.
  Permission:   read
  Input:        { issueNumber: number }
  Output:       { number, title, body, labels: string[], state, comments: [] }
```

---

## 14. Development Phases

### Phase 0 — Project Setup and Repo Structure ✓ COMPLETE

**Goals:** Working monorepo, TypeScript compiling, database connected, dev server running.

**Folders/Files to Create:**
```
repo-pilot/
  package.json              (workspace root with turborepo)
  turbo.json
  .env.example
  apps/
    web/                    (npx create-next-app)
    api/                    (fastify + typescript scaffold)
  packages/
    mcp-server/             (package.json + tsconfig)
    agent-core/             (package.json + tsconfig)
    shared/                 (types exported here)
  prisma/
    schema.prisma
  docker/
    docker-compose.yml      (postgres + api)
    Dockerfile.sandbox      (for test execution)
  docs/
    architecture.md
```

**Backend work:** Fastify scaffold, pino logger, Prisma client singleton, health check route, env validation with `zod`.

**Frontend work:** Next.js with Tailwind, shadcn/ui init, dark mode config, basic layout skeleton (three-panel shell).

**Security work:** `.env.example` documents required vars. `.gitignore` blocks `.env` and clone directories.

**Acceptance criteria:** `pnpm dev` starts both apps. `GET /health` returns 200. Database schema created. No TypeScript errors.

**Likely issues:** Turborepo workspace resolution with `pnpm`, Prisma binary targets for your OS, Next.js and Tailwind dark mode config conflicts.

---

### Phase 1 — MCP Server, Repo Analysis Agent, and GitHub Connect

**Goals:** Claude reads a real GitHub repo through a real MCP server and produces a structured plan. No inline tool implementations — MCP protocol from day one.

**Progress:**

#### PR #5 ✓ COMPLETE — Security Foundation
- `@repo-pilot/shared`: domain enums (`AgentRunStatus`, `CloneStatus`, `ApprovalStatus`, `ApprovalType`, `FileChangeType`, `TestRunStatus`, `ToolPermissionLevel`), TypeScript interfaces for all DB models, runtime type guards
- `SecretRedactor`: redacts GitHub PATs, Anthropic/AWS/Azure keys, Bearer tokens, PEM blocks, env-style secret assignments before any content reaches the Claude API
- `PathValidator`: validates all file paths stay inside `REPO_ROOT`; throws `PathValidationError` on traversal attempts
- `EncryptionService`: AES-256-GCM encrypt/decrypt for GitHub PAT storage, random IV per call, auth tag verification on decrypt
- Initial Prisma migration applied (`20260528225129_init`)
- 37 tests, all passing, strict TDD

#### PR #7 ✓ COMPLETE — MCP Server (read tools)
- `@repo-pilot/mcp-server`: MCP TypeScript SDK, stdio transport, spawned as child process
- Tools: `list_files`, `read_file`, `search_repo`, `get_diff`, `get_github_issue`
- Security: blocklist applied on every file read and search walk (`.env*`, `*.pem`, `*.key`, etc.)
- 41 tests, all passing, strict TDD

#### PR #10 ✓ COMPLETE — Agent Core
- `MCPClientManager`: spawns MCP server over stdio, routes tool calls, 30s timeout → `MCPTimeoutError`
- `ClaudeService`: Anthropic SDK wrapper, tool loop with `SecretRedactor` on every tool result, retry on 429 → `ClaudeRateLimitError`; fail-fast on network/500/timeout; `ClaudeContextLimitError` on `max_tokens`; `ClaudeMaxIterationsError` after 20 tool iterations
- `AgentStateMachine`: idle → analyzing_repo → planning → waiting_for_plan_approval; all transitions persisted to PostgreSQL; error path sets `currentState: 'failed'` with `errorMessage` on `AgentStep`
- 58 tests, all passing, strict TDD (AgentStateMachine uses real PostgreSQL)

#### Pending — PR C: GitHub Connect + API Routes
- `GitHubService`: clone repo via Octokit, create branch, fetch issue
- `POST /api/agent/runs`, `GET /api/agent/runs/:id/stream` (SSE)
- Frontend: repo connection card, task composer, step timeline, basic plan card

**Acceptance criteria:** Connect AlgoArena repo. Submit "explain the structure of this repo." Agent uses real MCP tools (`list_files`, `read_file`, `search_repo`), produces a plan, plan appears in UI. Tool trace shows real MCP calls with inputs and outputs.

**Likely issues:** MCP stdio protocol framing issues, child process lifecycle management, Claude tool use format differences between SDK versions, async state machine race conditions, GitHub clone timing for large repos.

---

### Phase 2 — File Edit Proposals and Diff Viewer

**Goals:** Claude can propose file edits. User sees diff and approves or rejects per file.

**Deliverables:**
- `propose_file_edit` and `write_file` MCP tools
- `FileChange` records created on propose, written only after approval
- Approval endpoint `POST /api/agent/runs/:id/approve-edit`
- SSE stream for real-time state updates replacing polling
- Diff viewer component in right panel
- Approval gate card in center panel

**Backend work:** Approval state machine integration, SSE endpoint, `propose_file_edit` logic, `write_file` with approval validation.

**Frontend work:** SSE client hook, diff viewer (react-diff-viewer-continued), approval gate card, per-file approve/reject buttons.

**Security work:** `write_file` double-checks approval in DB before writing, even if called directly.

**Acceptance criteria:** Run the alarm validation task on AlgoArena. Agent proposes edits. User sees diff. Approve one file, reject another. Only the approved file is written.

**Likely issues:** SSE connection drops on Next.js dev server, diff viewer failing on binary files, race condition between approval and write.

---

### Phase 3 — Sandboxed Test Runner

**Goals:** Tests run inside Docker. Results displayed. Agent can attempt one repair.

**Deliverables:**
- `Dockerfile.sandbox` for Node.js and Python environments
- `SandboxRunner` service that builds container, mounts changes, runs command, returns output
- `run_tests` and `run_linter` MCP tools
- Test approval flow (approve-test-run endpoint)
- Test output panel in right panel
- Repair loop (max 2 iterations)

**Backend work:** `SandboxRunner` class, Docker SDK integration (`dockerode`), test command allowlist, timeout enforcement.

**Frontend work:** Test output panel with terminal-style display, test approval card, pass/fail badge.

**Security work:** Docker `--network none` enforced, volume mounts restricted, container destroyed after run, timeout kills container.

**Acceptance criteria:** After editing alarm validation code, agent runs `npm test` in Docker. Test output visible in UI. If tests fail, agent proposes a repair.

**Likely issues:** Docker not available in dev environment, image build time too slow, npm install inside sandbox taking too long.

---

### Phase 4 — GitHub Branch, Commit, and PR Integration

**Goals:** Agent creates branch, commits changes, and opens a real pull request.

**Deliverables:**
- `create_branch`, `commit_changes`, `open_pull_request` MCP tools
- PR approval flow
- PR preview card showing title and body
- PR URL displayed in completion state

**Backend work:** `GitHubService` push/PR methods, PR approval gate, run completion handling.

**Frontend work:** PR preview card, PR approval card, completion state showing PR link.

**Security work:** `create_branch` enforces `repo-pilot/` prefix. `commit_changes` verifies not on main/master. Token scopes verified before PR creation.

**Acceptance criteria:** Full loop on AlgoArena. Task → analysis → plan → edits → tests → PR opened on GitHub. PR URL visible and clickable.

**Likely issues:** Git push authentication with encrypted PAT, branch naming conflicts on re-runs, GitHub API rate limiting.

---

### Phase 5 — Trace Viewer, Security Hardening, and Polished Demo

**Goals:** Production-quality UI, complete trace visibility, security review, demo-ready.

**Deliverables:**
- Full tool trace viewer with expandable JSON
- Security mode indicator in header
- Token usage counter
- Past runs sidebar with status badges
- Security page explaining the permission model
- Error states and retry UI
- Demo recording script

**Backend work:** Token counting from Claude API responses, complete trace endpoint, error recovery for common failures.

**Frontend work:** All polish items from the frontend spec, security page, responsive layout, loading skeletons, toast notifications.

**MCP work:** Remaining prompts: `write_tests_prompt`, `review_diff_prompt`, `create_pr_summary_prompt`.

**Security work:** End-to-end security audit: path traversal, blocklist, approval bypass, secret redaction, Docker sandbox isolation.

**Acceptance criteria:** 5-minute demo run is smooth with no crashes. Trace viewer shows all tool calls. PR is opened on AlgoArena. Security page explains the model correctly.

**Likely issues:** UI polish taking longer than expected, SSE reliability in production build, Docker image size for demo.

---

## 15. First 10 Implementation Tasks

These are exact, ordered, completable tasks.

```
1. Initialize Turborepo monorepo with pnpm workspaces.
   Create repo-pilot/ with package.json (workspaces: ["apps/*", "packages/*"]),
   turbo.json, .gitignore. Run `pnpm install`.

2. Scaffold the Fastify API with TypeScript.
   Create apps/api/ with tsconfig.json, src/index.ts, src/plugins/,
   src/routes/. Add fastify, @fastify/cors, @fastify/helmet, pino-pretty,
   zod, dotenv. Add GET /health route. Confirm it starts.

3. Scaffold the Next.js frontend with Tailwind and shadcn/ui.
   Run create-next-app in apps/web/. Install Tailwind, configure dark mode
   class. Run shadcn init. Create the three-panel layout shell with
   placeholder content. Confirm dark mode renders correctly.

4. Set up PostgreSQL with Docker Compose and Prisma.
   Create docker/docker-compose.yml with postgres:15 service.
   Create prisma/schema.prisma with the full schema from section 11.
   Run `pnpm prisma migrate dev --name init`. Confirm all tables created.

5. Create the shared types package.
   Create packages/shared/src/types.ts with AgentRunStatus, AgentState,
   ApprovalType, ToolPermissionLevel, and all API response types.
   Export from packages/shared/index.ts. Import in both apps.

6. Implement the SecretRedactor service.
   Create packages/agent-core/src/secret-redactor.ts with the regex
   patterns from section 10. Write unit tests covering .env, GitHub PAT,
   private key, bearer token redaction. All tests must pass.

7. Implement path traversal prevention utility.
   Create packages/agent-core/src/path-validator.ts with validatePath().
   Write unit tests for ../../ patterns, absolute paths, and valid paths.
   All tests must pass.

8. Implement the ClaudeService wrapper.
   Create packages/agent-core/src/claude-service.ts. Wrap the Anthropic
   SDK with typed methods: sendWithTools(). Apply secret redaction to all
   tool call results before returning. Log token usage.

9. Implement the AgentStateMachine with the first three states.
   Create packages/agent-core/src/agent-state-machine.ts. Implement
   idle → analyzing_repo → planning → waiting_for_plan_approval.
   Persist each state transition to AgentStep in the database.

10. Wire up POST /api/agent/runs and GET /api/agent/runs/:id.
    These endpoints create a run record, start the state machine for that
    run, and return the current run state. Test end-to-end: submit a task,
    confirm it transitions from idle to analyzing_repo in the database.
```

---

## 16. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Claude API tool use format changes between SDK versions | Medium | High — agent loop breaks entirely | Pin exact Anthropic SDK version. Add integration test that calls Claude with a real tool. |
| MCP stdio transport drops messages under load | Medium | Medium — agent stalls | Add request/response correlation IDs. Implement timeout and retry for MCP calls. Log all frames. |
| Docker not available in demo environment | Medium | High — test runner is disabled | Always demo with Docker Desktop running. Add a graceful fallback that skips tests with a warning rather than crashing. |
| Agent repair loop produces worse code | Medium | Low — user sees it in diff | Cap repair at 2 iterations. Show full test output to user. Let user reject repair. |
| GitHub rate limiting during demo | Low | High — PR creation fails mid-demo | Cache issue list. Pre-clone repo before demo. Use a secondary demo PAT with fresh quota. |
| Secret redaction false positives on non-secret hex strings | Medium | Low — minor noise in output | Tune regex patterns conservatively. Log redactions so they can be reviewed. |
| Approval bypass through direct MCP tool call | Low | Critical — write without approval | `write_file` checks approval in database as the authoritative source, not just in-memory state. Test this path explicitly. |
| Path traversal attack from malicious task input | Low | Critical | validatePath() runs on every tool call. Test with `../`, `../../etc/passwd`, and absolute paths. Fail closed. |
| PostgreSQL connection pool exhaustion during agent loop | Low | Medium — agent stalls | Prisma connection pool is configured. Add health check before starting each run. |
| Demo repo (AlgoArena) has no tests | Medium | Medium — test runner phase is undemonstrable | Check AlgoArena for existing tests before demo day. If none exist, write one minimal test in Phase 4 as part of the demo setup. |

---

## 17. Final Demo Script for AlgoArena

This is the exact script to run during a recruiter demo. Rehearse until it takes under 5 minutes.

**Setup (do before demo, not during):**
- AlgoArena cloned and connected in RepoPilot
- Docker Desktop running
- Both `pnpm dev` servers running
- Open `http://localhost:3000` in browser, dark mode visible

---

**Step 1 — Show the repo connection (30 seconds)**

Navigate to Settings. Point to AlgoArena connected. Say: "RepoPilot connected to this GitHub repo using a fine-grained PAT scoped to only this repository. The token is encrypted at rest and never sent to Claude."

---

**Step 2 — Submit the task (30 seconds)**

Click the task composer. Type:

> "Find where duplicate alarm times are handled and add validation so a user cannot create or update two tasks with the same alarm time. Update or add tests if they exist, then prepare a pull request."

Click Start Agent. Say: "This is a natural language task. The agent does not need a ticket or a specific function name. It will figure out where to look."

---

**Step 3 — Watch the analysis (60 seconds)**

Point to the step timeline. Say: "The agent is calling list_files and search_repo through the MCP server. Every tool call appears in the trace panel on the right with its full input and output." Expand one tool call in the trace. Say: "This is a real MCP protocol call, not a simulated one."

---

**Step 4 — Approve the plan (30 seconds)**

The agent plan card appears. It says something like: "1. Read the alarm model and service files. 2. Add uniqueness check in the alarm creation and update methods. 3. Update the existing alarm test to cover duplicate rejection." Click Approve Plan. Say: "The agent cannot touch a single file until the user approves the plan."

---

**Step 5 — Watch the edit and approve the diff (60 seconds)**

An approval gate card appears for `src/alarms/service.ts`. Click View Diff. The diff viewer shows the proposed addition of a uniqueness check. Say: "I can see exactly what Claude wants to change before it writes anything." Click Approve. Say: "Only this file, only this change, only after approval."

---

**Step 6 — Approve the test run (20 seconds)**

Another approval card: "Run `npm test` in Docker sandbox?" Click Approve. Say: "Tests run in an isolated Docker container with no network access. The container is destroyed after the run."

Test output appears. Show the pass badge. Say: "Tests passed."

---

**Step 7 — Approve the PR (30 seconds)**

The PR preview card appears with a title like "Add alarm time uniqueness validation" and a markdown body. Click Approve PR. Say: "The agent creates the branch `repo-pilot/{run-id}`, commits the changes, and opens the PR."

Navigate to the GitHub PR URL that appears. Show the real PR on AlgoArena in the browser.

---

**Closing (20 seconds)**

Point to the tool trace in the right panel. Say: "Every tool call is logged with inputs, outputs, and duration. You can audit exactly what the agent did. This is the kind of transparency you need before you trust AI to touch your codebase."

---

**What this demo proves to a recruiter:**
- You understand Claude's tool use API and agentic patterns, not just prompting
- You implemented the MCP protocol from scratch, not a wrapper around a chatbot
- You thought seriously about security: approval gates, secret redaction, sandboxed execution, scoped tokens
- You built a full-stack TypeScript application with real persistence, state management, and a polished UI
- You can scope and ship a portfolio-quality project rather than a tutorial clone

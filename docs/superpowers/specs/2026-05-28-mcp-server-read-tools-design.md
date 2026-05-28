# Design Spec: MCP Server — Read-Only Tools (PR A)

**Date:** 2026-05-28
**Phase:** 1 — Slice A
**Status:** Approved

---

## Overview

Implement `repo-agent-mcp-server` as a standalone stdio MCP server with five read-only tools. This server runs as a child process spawned by the `AgentOrchestrator` (implemented in PR C). In this slice it is built and verified independently using the MCP Inspector — no Claude API or frontend required.

---

## Scope

**In:** MCP server process, five read-only tool handlers, security invariants, integration tests, MCP Inspector verification.

**Out:** Resources, Prompts, write tools, `AgentOrchestrator`, Claude API integration, frontend.

---

## Structure

```
packages/mcp-server/
  src/
    index.ts              — server entry point, tool registration
    tools/
      list-files.ts
      read-file.ts
      search-repo.ts
      get-diff.ts
      get-github-issue.ts
    blocklist.ts          — sensitive file glob patterns
  tests/
    fixtures/             — git repo created in beforeAll
    list-files.test.ts
    read-file.test.ts
    search-repo.test.ts
    get-diff.test.ts
    get-github-issue.test.ts
```

---

## Transport

- **Protocol:** MCP over stdio (`StdioServerTransport` from `@modelcontextprotocol/sdk`)
- **Lifecycle:** spawned by `AgentOrchestrator` as a child process; killed when the run ends
- **Configuration:** all config via environment variables, no CLI flags

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `REPO_ROOT` | yes | Absolute path to the local repo clone |
| `GITHUB_TOKEN` | only for `get_github_issue` | GitHub PAT for API calls |

---

## Tools

All tools return `content: [{ type: "text", text: "..." }]`. On error they return a structured MCP error — they never crash the process.

### `list_files`

```
input:  { path?: string }
```

Lists all files under `path` (default: `.`) relative to `REPO_ROOT`. Validates `path` with `PathValidator`. Returns one relative path per line. Automatically excludes `node_modules/`, `.git/`, `dist/`, `.turbo/`.

```
output example:
src/index.ts
src/routes/health.ts
package.json
```

### `read_file`

```
input:  { path: string }
```

Reads a file at `path` relative to `REPO_ROOT`. Runs `PathValidator` then checks against the blocklist. Returns file contents as a string.

```
output: full file contents as string
```

### `search_repo`

```
input:  { query: string, path?: string }
```

Searches for `query` (treated as a regex) in all files under `path` (default: repo root). Skips `node_modules/`, `.git/`, `dist/`. Returns up to 100 matches in `file:line: content` format. If the result is truncated, appends a note indicating so.

```
output example:
src/index.ts:12: export function validatePath(
src/utils/path.ts:4: import { validatePath } from
[truncated — 100 match limit reached]
```

### `get_diff`

```
input:  { staged?: boolean }
```

Returns the output of `git diff` (unstaged, default) or `git diff --cached` (staged). Runs the command with `REPO_ROOT` as cwd. Returns the raw diff string, or `"No changes."` if the diff is empty.

### `get_github_issue`

```
input:  { owner: string, repo: string, issue_number: number }
```

Fetches a GitHub issue via the REST API using `GITHUB_TOKEN` from env. Returns a formatted string with title, state, labels, and body. If `GITHUB_TOKEN` is missing, returns a clear error — never exposes the absence as a crash.

```
output example:
Issue #42: Fix alarm validation bug [open]
Labels: bug, high-priority
---
The alarm fires even when the threshold is not exceeded...
```

---

## Security Invariants

1. **PathValidator on every file operation** — instantiated once at startup with `REPO_ROOT`. Any path that resolves outside the root returns a MCP error immediately, no filesystem access attempted.

2. **Blocklist on `read_file`** — checked after PathValidator passes. Patterns:
   `.env*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa`, `id_ed25519`, `id_dsa`, `secrets.json`, `credentials.json`, `*.keystore`

3. **`GITHUB_TOKEN` never logged or returned** — read only from `process.env` inside `get_github_issue`. Never appears in tool input schemas, output strings, or error messages.

---

## Error Handling

Every tool wraps its logic in try/catch. Errors are returned as MCP tool errors (not process exits):

| Scenario | Response |
|---|---|
| Path traversal attempt | `"Error: path resolves outside repository root"` |
| Blocklisted file | `"Error: reading this file is not permitted"` |
| File not found | `"Error: file not found: <path>"` |
| `GITHUB_TOKEN` missing | `"Error: GITHUB_TOKEN is required for get_github_issue"` |
| GitHub API error | `"Error: GitHub API returned <status>: <message>"` |
| `REPO_ROOT` missing at startup | process exits with code 1 and a clear message |

---

## Testing

Per CLAUDE.md: integration tests against a real local repo fixture, not mocked filesystem.

### Fixture Setup (`beforeAll`)

```
tests/fixtures/sample-repo/
  src/
    index.ts        — contains known search targets
    utils.ts
  package.json
  .env              — must be blocked by read_file
  README.md
```

Created with `git init` + `git commit` so `get_diff` has a real git history to work with.

### Test Coverage per Tool

| Tool | Cases |
|---|---|
| `list_files` | root listing, subdirectory, path traversal rejected |
| `read_file` | reads file, blocklisted file rejected, traversal rejected, missing file |
| `search_repo` | match found, no match, regex query, excludes node_modules |
| `get_diff` | no changes returns "No changes.", staged flag |
| `get_github_issue` | missing token returns error (no real API call in unit tests) |

`get_github_issue` API calls are tested with a mocked `fetch` — the only case where a mock is acceptable because hitting the real GitHub API in CI is brittle and requires secrets.

---

## Verification

Manual verification with MCP Inspector:

```bash
REPO_ROOT=/path/to/any/repo npx @modelcontextprotocol/inspector node packages/mcp-server/dist/index.js
```

Open the Inspector UI, call each tool, confirm outputs match expectations.

---

## Dependencies

- `@modelcontextprotocol/sdk` — MCP protocol implementation
- `zod` — input validation for tool parameters
- `@repo-pilot/agent-core` — `PathValidator`, `PathValidationError`
- `@octokit/rest` — GitHub REST API client for `get_github_issue`

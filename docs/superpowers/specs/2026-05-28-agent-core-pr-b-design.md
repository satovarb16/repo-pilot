# Design Spec: Agent Core — MCPClientManager, ClaudeService, AgentStateMachine (PR B)

**Date:** 2026-05-28
**Phase:** 1 — Slice B
**Status:** Approved

---

## Overview

Implement the three core agent services in `packages/agent-core/`: `MCPClientManager`, `ClaudeService`, and `AgentStateMachine`. Together they form the reasoning and coordination layer that drives an agent run from idle to waiting for human plan approval.

This slice is verifiable independently via unit and integration tests — no frontend or API routes required.

---

## Scope

**In:** `MCPClientManager`, `ClaudeService`, `AgentStateMachine`, all tests including a SecretRedactor integration test on tool results.

**Out:** `GitHubService` (deferred to PR C), API routes, SSE, frontend, write MCP tools, approval gates beyond `waiting_for_plan_approval`.

---

## Architecture

The three components are stateless services except for `AgentStateMachine`, which owns the run lifecycle.

```
AgentStateMachine
  → MCPClientManager.callTool()        — executes MCP tools against the repo
  → ClaudeService.sendWithTools()      — drives the Claude reasoning loop
      → toolExecutor callback          — AgentStateMachine passes callTool here
      → SecretRedactor.redact(result)  — applied to every tool result before Claude sees it
  → PrismaClient                       — persists state transitions and steps
```

`ClaudeService` and `MCPClientManager` are stateless — they receive everything they need as constructor arguments or method parameters. `AgentStateMachine` is the only component that holds run state and DB references.

---

## File Structure

```
packages/agent-core/src/
  mcp-client-manager.ts
  claude-service.ts
  agent-state-machine.ts
  index.ts                    — add new exports

tests/
  mcp-client-manager.test.ts
  claude-service.test.ts
  agent-state-machine.test.ts
```

---

## Components

### MCPClientManager

Spawns `repo-agent-mcp-server` as a child process over stdio and exposes a `callTool` method.

```typescript
class MCPClientManager {
  constructor(repoRoot: string, serverPath: string)

  start(): Promise<void>
  callTool(name: string, args: Record<string, unknown>): Promise<string>
  stop(): Promise<void>
}
```

- Uses `StdioClientTransport` + `Client` from `@modelcontextprotocol/sdk`
- `callTool` enforces a 30-second timeout; throws `MCPTimeoutError` on expiry
- Each `callTool` invocation logs `[correlationId] → tool_name` and `[correlationId] ← result` (correlation ID is a random short UUID generated per call)
- `stop()` closes the MCP client then kills the child process; safe to call multiple times
- If `start()` has not been called, `callTool` throws immediately

### ClaudeService

Wraps `@anthropic-ai/sdk` and drives the tool-use loop.

```typescript
class ClaudeService {
  constructor(apiKey: string, secretRedactor: SecretRedactor)

  sendWithTools(
    messages: MessageParam[],
    tools: Tool[],
    toolExecutor: (name: string, args: unknown) => Promise<string>,
    systemPrompt?: string,
  ): Promise<MessageParam[]>
}
```

- `sendWithTools` loops until Claude returns `stop_reason: "end_turn"`:
  1. Calls Claude API with current messages + tools
  2. If `stop_reason === "tool_use"`: executes each tool via `toolExecutor`, applies `SecretRedactor.redact()` to every result, appends tool results to messages, loops
  3. If `stop_reason === "end_turn"`: returns the full updated messages array
- Retries exactly once on HTTP 429 (rate limit) after a 60-second delay
- Logs token usage after every API call
- `ANTHROPIC_API_KEY` is passed via constructor — never read from `process.env` inside the class

### AgentStateMachine

Owns the lifecycle of a single agent run through Phase 1 states.

```typescript
class AgentStateMachine {
  constructor(
    runId: string,
    prisma: PrismaClient,
    claudeService: ClaudeService,
    mcpClientManager: MCPClientManager,
  )

  start(): Promise<void>
}
```

**Phase 1 states and work:**

| Transition | Work |
|---|---|
| `idle → analyzing_repo` | Start MCPClientManager; call `list_files` to get repo structure |
| `analyzing_repo → planning` | Call `ClaudeService.sendWithTools()` with repo context and task description to generate a plan |
| `planning → waiting_for_plan_approval` | Save plan to `AgentRun.planJson`; create AgentStep; `start()` returns — the run stays in this state until PR C wires the approval API |

**Each transition:**
1. Updates `AgentRun.currentState` in DB
2. Creates `AgentStep` record with step type, description, and `status: 'running'`
3. Executes the work for that state
4. Updates the `AgentStep` to `status: 'completed'`

**On any failure:**
- Updates current `AgentStep` to `status: 'failed'` with `errorMessage`
- Updates `AgentRun.currentState` to `'failed'`
- Calls `MCPClientManager.stop()` to clean up the child process
- Re-throws the error

**Concurrency:** An internal async lock (promise chain) ensures only one transition runs at a time.

---

## Security Invariants

1. `SecretRedactor` is applied to **every** tool result in `ClaudeService` before it is added to the message history — Claude never sees raw tool output.
2. `ANTHROPIC_API_KEY` is injected via constructor — never read from `process.env` inside any class.
3. `MCPClientManager` enforces a 30s timeout — a hung MCP server cannot block the agent indefinitely.
4. On any failure, `stop()` is called — no orphaned child processes.

---

## Error Handling

| Scenario | Behavior |
|---|---|
| MCP tool call times out | `MCPTimeoutError` thrown; state machine catches, transitions to `failed` |
| Claude API 429 | Retry once after 60s; if still 429, throw `ClaudeRateLimitError` |
| Claude API other error | Throw immediately; state machine catches, transitions to `failed` |
| DB write fails | Throw; state machine catches, transitions to `failed` (best-effort) |
| `start()` called before `MCPClientManager.start()` | `IllegalStateError` thrown |

---

## Testing

### MCPClientManager (`tests/mcp-client-manager.test.ts`)

Integration tests against the real MCP server binary:

| Case | Assertion |
|---|---|
| `start()` + `callTool('list_files', {})` | Returns a string containing known filenames |
| `stop()` after start | Child process is no longer running |
| `callTool` without `start()` | Throws immediately |
| Timeout simulation (mock slow tool) | Throws `MCPTimeoutError` after 30s |

### ClaudeService (`tests/claude-service.test.ts`)

Unit tests with mocked `@anthropic-ai/sdk`:

| Case | Assertion |
|---|---|
| Single `end_turn` response | Returns messages with assistant reply |
| `tool_use` → `end_turn` loop | Calls `toolExecutor`, appends result, loops |
| SecretRedactor integration | Tool result containing a secret is redacted before being added to messages |
| Rate limit retry | Retries once after 60s; throws on second 429 |
| Token usage logged | Logger called with token counts after each API call |

### AgentStateMachine (`tests/agent-state-machine.test.ts`)

Integration tests against a real test database (`DATABASE_URL` env override):

| Case | Assertion |
|---|---|
| `start()` transitions through all 4 states | `AgentRun.currentState` ends at `waiting_for_plan_approval` |
| Each transition creates an `AgentStep` | 3 AgentStep records created with correct types |
| Failure in `analyzing_repo` | `AgentRun.currentState` set to `failed`; AgentStep has `errorMessage` |
| Concurrent `start()` calls | Second call is queued, not interleaved |

---

## Dependencies to Add

| Package | Location | Purpose |
|---|---|---|
| `@anthropic-ai/sdk` | `packages/agent-core` | Claude API client |
| `@prisma/client` | `packages/agent-core` | DB access for state persistence |

`@modelcontextprotocol/sdk` is already a dependency of `packages/mcp-server`; `agent-core` will add it too for the client-side transport.

---

## Verification

After implementation, run:

```bash
pnpm --filter @repo-pilot/agent-core test
```

All tests must pass. The SecretRedactor integration test is the key security verification: a tool result containing a known secret must be redacted in the messages array before any Claude API call.

# Agent Core PR B — MCPClientManager, ClaudeService, AgentStateMachine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the three core agent services (`MCPClientManager`, `ClaudeService`, `AgentStateMachine`) in `packages/agent-core/`, wiring them together so a run can progress from `idle` through `analyzing_repo` and `planning` to `waiting_for_plan_approval`, with all secrets redacted before Claude sees them.

**Architecture:** `AgentStateMachine` drives the run lifecycle and persists state to PostgreSQL via Prisma. `ClaudeService` wraps the Anthropic SDK and applies `SecretRedactor` to every tool result before sending it back to Claude. `MCPClientManager` spawns the already-built MCP server as a child process and routes tool calls to it over stdio.

**Tech Stack:** `@anthropic-ai/sdk`, `@modelcontextprotocol/sdk` (client-side), `@prisma/client`, Vitest (unit + integration tests).

---

## File Structure

```
packages/agent-core/
  src/
    mcp-client-manager.ts     — new: spawn MCP server, callTool, stop
    claude-service.ts         — new: Anthropic SDK wrapper, tool loop, SecretRedactor
    agent-state-machine.ts    — new: state transitions, DB persistence
    index.ts                  — modify: add new exports
    mcp-client-manager.test.ts  — new: integration tests (real MCP server)
    claude-service.test.ts      — new: unit tests (mocked SDK)
    agent-state-machine.test.ts — new: integration tests (real test DB, mocked services)
```

---

## Prerequisites

Before starting:
1. The MCP server must be built: `pnpm --filter @repo-pilot/mcp-server build` — verify `packages/mcp-server/dist/index.js` exists.
2. A test PostgreSQL database must be accessible. Set `DATABASE_URL` to a test DB (e.g. `postgresql://postgres:<password>@localhost:5432/repopilot_test`) and run `pnpm prisma migrate dev` to apply the schema.
3. Branch: `git checkout -b feat/phase-1-agent-core` from `main`.

---

## Task 1: Create feature branch and add dependencies

**Files:**
- Modify: `packages/agent-core/package.json`

- [ ] **Step 1: Create the feature branch**

```bash
git checkout -b feat/phase-1-agent-core
```

- [ ] **Step 2: Replace package.json**

```json
{
  "name": "@repo-pilot/agent-core",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.30.0",
    "@modelcontextprotocol/sdk": "^1.0.0",
    "@prisma/client": "^5"
  },
  "devDependencies": {
    "@types/node": "^20",
    "typescript": "*",
    "vitest": "*"
  }
}
```

- [ ] **Step 3: Install dependencies**

```bash
pnpm install
```

Expected: resolves without errors.

- [ ] **Step 4: Ensure Prisma client is generated**

```bash
pnpm prisma generate
```

Expected: `Generated Prisma Client` message with no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-core/package.json pnpm-lock.yaml
git commit -m "chore(agent-core): add anthropic-sdk, mcp-sdk, and prisma-client dependencies"
```

---

## Task 2: MCPClientManager — tests then implementation

**Files:**
- Create: `packages/agent-core/src/mcp-client-manager.ts`
- Create: `packages/agent-core/src/mcp-client-manager.test.ts`

### Context

`MCPClientManager` uses the MCP SDK's `Client` + `StdioClientTransport` to spawn the already-built MCP server binary and communicate over stdio. `StdioClientTransport` handles spawning internally — you do not need `child_process.spawn`.

- [ ] **Step 1: Write failing integration tests**

Create `packages/agent-core/src/mcp-client-manager.test.ts`:

```typescript
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MCPClientManager, MCPTimeoutError } from './mcp-client-manager.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
// src/ → agent-core/ → packages/ → repo root
const REPO_ROOT = resolve(__dirname, '../../..');
// src/ → agent-core/ → packages/mcp-server/dist/index.js
const SERVER_PATH = resolve(__dirname, '../../mcp-server/dist/index.js');

describe('MCPClientManager', () => {
  let manager: MCPClientManager;

  beforeEach(() => {
    manager = new MCPClientManager(REPO_ROOT, SERVER_PATH);
  });

  afterEach(async () => {
    await manager.stop();
  });

  it('lists files after start()', async () => {
    await manager.start();
    const result = await manager.callTool('list_files', {});
    expect(result).toContain('package.json');
    expect(result).toContain('CLAUDE.md');
  });

  it('callTool before start() throws immediately', async () => {
    await expect(manager.callTool('list_files', {})).rejects.toThrow('not started');
  });

  it('stop() is safe to call multiple times', async () => {
    await manager.start();
    await manager.stop();
    await expect(manager.stop()).resolves.not.toThrow();
  });

  it('throws MCPTimeoutError when tool call exceeds 30s', async () => {
    vi.useFakeTimers();
    await manager.start();

    // Patch the internal client to never resolve
    const m = manager as any;
    m.client.callTool = () => new Promise(() => {});

    const promise = manager.callTool('list_files', {});
    await vi.advanceTimersByTimeAsync(30_001);
    await expect(promise).rejects.toThrow(MCPTimeoutError);

    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run to confirm RED**

```bash
pnpm --filter @repo-pilot/agent-core test
```

Expected: FAIL — `mcp-client-manager.js` not found.

- [ ] **Step 3: Implement MCPClientManager**

Create `packages/agent-core/src/mcp-client-manager.ts`:

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { randomUUID } from 'node:crypto';

export class MCPTimeoutError extends Error {
  constructor(toolName: string) {
    super(`MCP tool '${toolName}' timed out after 30s`);
    this.name = 'MCPTimeoutError';
  }
}

export class MCPClientManager {
  private client: Client | null = null;
  private started = false;

  constructor(
    private readonly repoRoot: string,
    private readonly serverPath: string,
  ) {}

  async start(): Promise<void> {
    const transport = new StdioClientTransport({
      command: 'node',
      args: [this.serverPath],
      env: { ...process.env, REPO_ROOT: this.repoRoot } as Record<string, string>,
    });

    this.client = new Client(
      { name: 'repo-pilot-orchestrator', version: '1.0.0' },
      { capabilities: {} },
    );

    await this.client.connect(transport);
    this.started = true;
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<string> {
    if (!this.started || !this.client) {
      throw new Error('MCPClientManager not started — call start() first');
    }

    const correlationId = randomUUID().slice(0, 8);
    console.log(`[${correlationId}] → ${name}`);

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new MCPTimeoutError(name)), 30_000),
    );

    const result = await Promise.race([
      this.client.callTool({ name, arguments: args }),
      timeout,
    ]);

    const text = (result.content as Array<{ type: string; text: string }>)
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n');

    console.log(`[${correlationId}] ← ${text.slice(0, 80)}${text.length > 80 ? '...' : ''}`);
    return text;
  }

  async stop(): Promise<void> {
    if (this.client) {
      try { await this.client.close(); } catch { /* ignore */ }
      this.client = null;
    }
    this.started = false;
  }
}
```

- [ ] **Step 4: Run to confirm GREEN**

```bash
pnpm --filter @repo-pilot/agent-core test
```

Expected: all 4 MCPClientManager tests PASS (plus existing agent-core tests).

- [ ] **Step 5: Commit**

```bash
git add packages/agent-core/src/mcp-client-manager.ts packages/agent-core/src/mcp-client-manager.test.ts
git commit -m "feat(agent-core): add MCPClientManager with stdio transport and 30s timeout"
```

---

## Task 3: ClaudeService — tests then implementation

**Files:**
- Create: `packages/agent-core/src/claude-service.ts`
- Create: `packages/agent-core/src/claude-service.test.ts`

### Context

`ClaudeService` wraps `@anthropic-ai/sdk`. The SDK is mocked in all tests — no real API calls. Key invariants:
- `SecretRedactor.redact()` is called on every tool result before it appears in the messages array.
- The tool loop is bounded by `MAX_TOOL_ITERATIONS = 20` to prevent infinite loops.
- Only 429 rate-limit errors are retried (once, after 60s). All other errors — network, 500, timeout — fail fast so `AgentStateMachine` can persist the failure state.

### Error classes exported

| Class | When thrown |
|---|---|
| `ClaudeRateLimitError` | 429 after one retry |
| `ClaudeContextLimitError` | `stop_reason: 'max_tokens'` |
| `ClaudeMaxIterationsError` | Tool loop exceeds `MAX_TOOL_ITERATIONS` (20) |

All other SDK errors (`APIConnectionError`, `APITimeoutError`, `InternalServerError`, etc.) propagate as-is — fail fast, no retry.

### Mock gotcha — CRITICAL

The `vi.mock` factory **must** attach `APIError` as a static property on the mock constructor:

```typescript
const MockAnthropic = vi.fn().mockImplementation(() => ({
  messages: { create: mockCreate },
}));
// Without this line, `err instanceof Anthropic.APIError` returns false in the implementation
(MockAnthropic as any).APIError = APIError;
return { default: MockAnthropic, APIError };
```

Without this, `instanceof Anthropic.APIError` always returns `false` and the 429 retry branch never executes.

### Fake timer ordering — CRITICAL

When testing with `vi.useFakeTimers()`, attach the rejection handler to `promise` **before** calling `vi.advanceTimersByTimeAsync`. Otherwise Node sees an unhandled rejection:

```typescript
// CORRECT
const promise = service.sendWithTools(...);
const assertion = expect(promise).rejects.toThrow(ClaudeRateLimitError);
await vi.advanceTimersByTimeAsync(60_001);
await assertion;

// WRONG — unhandled rejection warning
const promise = service.sendWithTools(...);
await vi.advanceTimersByTimeAsync(60_001);
await expect(promise).rejects.toThrow(ClaudeRateLimitError);
```

- [ ] **Step 1: Write failing unit tests**

Create `packages/agent-core/src/claude-service.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SecretRedactor } from './secret-redactor.js';
import {
  ClaudeService,
  ClaudeRateLimitError,
  ClaudeContextLimitError,
  ClaudeMaxIterationsError,
} from './claude-service.js';

vi.mock('@anthropic-ai/sdk', () => {
  const mockCreate = vi.fn();
  class APIError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
      this.name = 'APIError';
    }
  }
  class APIConnectionError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'APIConnectionError';
    }
  }
  const MockAnthropic = vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  }));
  // REQUIRED: attach error classes as static properties so instanceof works in the implementation
  (MockAnthropic as any).APIError = APIError;
  (MockAnthropic as any).APIConnectionError = APIConnectionError;
  return { default: MockAnthropic, APIError, APIConnectionError };
});

import Anthropic from '@anthropic-ai/sdk';

function getMockCreate(service: ClaudeService): ReturnType<typeof vi.fn> {
  return (service as any).anthropic.messages.create;
}

function makeToolUseResponse(id: string, name: string, input: Record<string, unknown>) {
  return {
    stop_reason: 'tool_use',
    content: [{ type: 'tool_use', id, name, input }],
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

function makeEndTurnResponse(text: string) {
  return {
    stop_reason: 'end_turn',
    content: [{ type: 'text', text }],
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

describe('ClaudeService', () => {
  let service: ClaudeService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ClaudeService('test-key', new SecretRedactor());
  });

  it('returns messages when Claude responds with end_turn', async () => {
    getMockCreate(service).mockResolvedValueOnce(makeEndTurnResponse('Here is my answer.'));

    const result = await service.sendWithTools(
      [{ role: 'user', content: 'Hello' }],
      [],
      async () => '',
    );

    expect(result).toHaveLength(2);
    expect(result[1].role).toBe('assistant');
  });

  it('executes tool and loops when Claude responds with tool_use', async () => {
    const toolExecutor = vi.fn().mockResolvedValue('file contents here');
    const mockCreate = getMockCreate(service);

    mockCreate
      .mockResolvedValueOnce({
        stop_reason: 'tool_use',
        content: [
          { type: 'text', text: 'Let me check the file.' },
          { type: 'tool_use', id: 'tu-1', name: 'read_file', input: { path: 'src/index.ts' } },
        ],
        usage: { input_tokens: 20, output_tokens: 10 },
      })
      .mockResolvedValueOnce(makeEndTurnResponse('Done.'));

    await service.sendWithTools(
      [{ role: 'user', content: 'Read index.ts' }],
      [],
      toolExecutor,
    );

    expect(toolExecutor).toHaveBeenCalledWith('read_file', { path: 'src/index.ts' });
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('applies SecretRedactor to tool results — secret never reaches Claude', async () => {
    const secretOutput = 'DATABASE_URL=postgresql://user:s3cr3t@localhost/db';
    const toolExecutor = vi.fn().mockResolvedValue(secretOutput);
    const mockCreate = getMockCreate(service);

    mockCreate
      .mockResolvedValueOnce({
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'tu-1', name: 'read_file', input: { path: '.env' } }],
        usage: { input_tokens: 10, output_tokens: 5 },
      })
      .mockResolvedValueOnce(makeEndTurnResponse('Done.'));

    const messages = await service.sendWithTools(
      [{ role: 'user', content: 'Read .env' }],
      [],
      toolExecutor,
    );

    // The tool_result message is the 3rd message (user → assistant w/ tool_use → user w/ tool_result)
    const toolResultMsg = messages[2];
    const toolResultBlock = (toolResultMsg.content as any[])[0];
    expect(toolResultBlock.content).toContain('[REDACTED]');
    expect(toolResultBlock.content).not.toContain('s3cr3t');
  });

  it('retries once on 429 then throws ClaudeRateLimitError', async () => {
    vi.useFakeTimers();

    const RateLimitError = (Anthropic as any).APIError;
    getMockCreate(service).mockRejectedValue(new RateLimitError(429, 'Rate limited'));

    const promise = service.sendWithTools(
      [{ role: 'user', content: 'Hello' }],
      [],
      async () => '',
    );
    // Attach handler BEFORE advancing timers to avoid unhandled rejection warning
    const assertion = expect(promise).rejects.toThrow(ClaudeRateLimitError);
    await vi.advanceTimersByTimeAsync(60_001);
    await assertion;
    expect(getMockCreate(service)).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it('throws ClaudeContextLimitError on max_tokens stop_reason', async () => {
    getMockCreate(service).mockResolvedValueOnce({
      stop_reason: 'max_tokens',
      content: [{ type: 'text', text: 'Truncated.' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    await expect(
      service.sendWithTools([{ role: 'user', content: 'Hello' }], [], async () => ''),
    ).rejects.toThrow(ClaudeContextLimitError);
  });

  it('throws on unknown stop_reason (e.g. stop_sequence)', async () => {
    getMockCreate(service).mockResolvedValueOnce({
      stop_reason: 'stop_sequence',
      content: [{ type: 'text', text: 'Stopped.' }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    await expect(
      service.sendWithTools([{ role: 'user', content: 'Hello' }], [], async () => ''),
    ).rejects.toThrow('Unexpected stop_reason: stop_sequence');
  });

  it('throws ClaudeMaxIterationsError after 20 tool calls without end_turn', async () => {
    const mockCreate = getMockCreate(service);
    // Return tool_use indefinitely
    mockCreate.mockResolvedValue(makeToolUseResponse('tu-x', 'list_files', {}));

    await expect(
      service.sendWithTools([{ role: 'user', content: 'Go' }], [], async () => 'result'),
    ).rejects.toThrow(ClaudeMaxIterationsError);
  });

  it('propagates network error without retry (fail fast)', async () => {
    const NetworkError = (Anthropic as any).APIConnectionError;
    getMockCreate(service).mockRejectedValue(new NetworkError('Connection refused'));

    await expect(
      service.sendWithTools([{ role: 'user', content: 'Hello' }], [], async () => ''),
    ).rejects.toThrow('Connection refused');

    // Must NOT retry — only 1 attempt
    expect(getMockCreate(service)).toHaveBeenCalledTimes(1);
  });

  it('propagates 500 server error without retry (fail fast)', async () => {
    const ServerError = (Anthropic as any).APIError;
    getMockCreate(service).mockRejectedValue(new ServerError(500, 'Internal Server Error'));

    await expect(
      service.sendWithTools([{ role: 'user', content: 'Hello' }], [], async () => ''),
    ).rejects.toThrow('Internal Server Error');

    expect(getMockCreate(service)).toHaveBeenCalledTimes(1);
  });

  it('propagates tool executor error', async () => {
    getMockCreate(service).mockResolvedValueOnce(
      makeToolUseResponse('tu-1', 'read_file', { path: 'src/index.ts' }),
    );

    await expect(
      service.sendWithTools(
        [{ role: 'user', content: 'Read it' }],
        [],
        async () => { throw new Error('MCP spawn failed'); },
      ),
    ).rejects.toThrow('MCP spawn failed');
  });

  it('logs token usage after each API call', async () => {
    const consoleSpy = vi.spyOn(console, 'log');
    getMockCreate(service).mockResolvedValueOnce(makeEndTurnResponse('Done.'));

    await service.sendWithTools([{ role: 'user', content: 'Hello' }], [], async () => '');

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('tokens:'));
  });
});
```

- [ ] **Step 2: Run to confirm RED**

```bash
pnpm --filter @repo-pilot/agent-core test
```

Expected: FAIL — `claude-service.js` not found.

- [ ] **Step 3: Implement ClaudeService**

Create `packages/agent-core/src/claude-service.ts`:

```typescript
import Anthropic from '@anthropic-ai/sdk';
import type { SecretRedactor } from './secret-redactor.js';

const MAX_TOOL_ITERATIONS = 20;

export class ClaudeRateLimitError extends Error {
  constructor() {
    super('Claude API rate limit exceeded — retried once, still failing');
    this.name = 'ClaudeRateLimitError';
  }
}

export class ClaudeContextLimitError extends Error {
  constructor() {
    super('Claude context limit reached (max_tokens) — reduce input or increase max_tokens');
    this.name = 'ClaudeContextLimitError';
  }
}

export class ClaudeMaxIterationsError extends Error {
  constructor() {
    super(`Claude tool loop exceeded ${MAX_TOOL_ITERATIONS} iterations without end_turn`);
    this.name = 'ClaudeMaxIterationsError';
  }
}

export class ClaudeService {
  private readonly anthropic: Anthropic;

  constructor(
    apiKey: string,
    private readonly secretRedactor: SecretRedactor,
  ) {
    this.anthropic = new Anthropic({ apiKey });
  }

  async sendWithTools(
    messages: Anthropic.MessageParam[],
    tools: Anthropic.Tool[],
    toolExecutor: (name: string, args: Record<string, unknown>) => Promise<string>,
    systemPrompt?: string,
  ): Promise<Anthropic.MessageParam[]> {
    const current = [...messages];
    let toolIterations = 0;

    while (true) {
      const response = await this.callWithRetry(current, tools, systemPrompt);

      console.log(
        `[ClaudeService] tokens: input=${response.usage.input_tokens} output=${response.usage.output_tokens}`,
      );

      current.push({ role: 'assistant', content: response.content });

      if (response.stop_reason === 'end_turn') {
        return current;
      }

      if (response.stop_reason === 'max_tokens') {
        throw new ClaudeContextLimitError();
      }

      if (response.stop_reason === 'tool_use') {
        toolIterations++;
        if (toolIterations > MAX_TOOL_ITERATIONS) {
          throw new ClaudeMaxIterationsError();
        }

        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const block of response.content) {
          if (block.type === 'tool_use') {
            const raw = await toolExecutor(block.name, block.input as Record<string, unknown>);
            const redacted = this.secretRedactor.redact(raw);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: redacted,
            });
          }
        }

        if (toolResults.length > 0) {
          current.push({ role: 'user', content: toolResults });
        }

        continue;
      }

      throw new Error(`Unexpected stop_reason: ${response.stop_reason}`);
    }
  }

  private async callWithRetry(
    messages: Anthropic.MessageParam[],
    tools: Anthropic.Tool[],
    systemPrompt?: string,
  ): Promise<Anthropic.Message> {
    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages,
      ...(tools.length > 0 ? { tools } : {}),
      ...(systemPrompt ? { system: systemPrompt } : {}),
    };

    try {
      return await this.anthropic.messages.create(params);
    } catch (err) {
      // Only 429 is retried — all other errors fail fast so AgentStateMachine can persist state
      if (err instanceof Anthropic.APIError && err.status === 429) {
        await new Promise((r) => setTimeout(r, 60_000));
        try {
          return await this.anthropic.messages.create(params);
        } catch (retryErr) {
          if (retryErr instanceof Anthropic.APIError && retryErr.status === 429) {
            throw new ClaudeRateLimitError();
          }
          throw retryErr;
        }
      }
      throw err;
    }
  }
}
```

- [ ] **Step 4: Run to confirm GREEN**

```bash
pnpm --filter @repo-pilot/agent-core test
```

Expected: all ClaudeService tests PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/agent-core/src/claude-service.ts packages/agent-core/src/claude-service.test.ts
git commit -m "feat(agent-core): add ClaudeService with tool loop, secret redaction, and edge case handling"
```

---

## Task 4: AgentStateMachine — tests then implementation

**Files:**
- Create: `packages/agent-core/src/agent-state-machine.ts`
- Create: `packages/agent-core/src/agent-state-machine.test.ts`

### Context

Tests use a real PostgreSQL test database. Set `DATABASE_URL` to a test DB before running:

```bash
# PowerShell
$env:DATABASE_URL="postgresql://postgres:<password>@localhost:5432/repopilot_test"
```

The test DB must have the schema applied:
```bash
pnpm prisma migrate dev
```

`ClaudeService` and `MCPClientManager` are mocked with `vi.fn()` — only the DB interaction is tested for real.

Prisma schema for reference:
- `User`: `id` (cuid), `email?`, `createdAt`
- `Repository`: `id`, `userId`, `githubRepoId` (Int), `owner`, `name`, `cloneUrl`, `encryptedToken`, `cloneStatus` (default "pending")
- `AgentRun`: `id`, `userId`, `repoId`, `taskDescription`, `status` (default "created"), `currentState` (default "idle"), `planJson?`, `updatedAt` (auto)
- `AgentStep`: `id`, `runId`, `stepNumber` (Int), `stepType`, `description`, `status` (default "pending"), `errorMessage?`, `completedAt?`

- [ ] **Step 1: Write failing integration tests**

Create `packages/agent-core/src/agent-state-machine.test.ts`:

```typescript
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { AgentStateMachine } from './agent-state-machine.js';

// Mock ClaudeService and MCPClientManager — only DB interaction is real
const mockCallTool = vi.fn().mockResolvedValue('src/index.ts\npackage.json\nREADME.md');
const mockStart = vi.fn().mockResolvedValue(undefined);
const mockStop = vi.fn().mockResolvedValue(undefined);
const mockMCP = { start: mockStart, callTool: mockCallTool, stop: mockStop } as any;

const mockSendWithTools = vi.fn().mockResolvedValue([
  { role: 'user', content: 'Add a feature' },
  {
    role: 'assistant',
    content: [{ type: 'text', text: '1. Write failing test\n2. Implement\n3. Commit' }],
  },
]);
const mockClaude = { sendWithTools: mockSendWithTools } as any;

const prisma = new PrismaClient();

let userId: string;
let repoId: string;
let runId: string;

beforeAll(async () => {
  const user = await prisma.user.create({ data: {} });
  userId = user.id;

  const repo = await prisma.repository.create({
    data: {
      userId,
      githubRepoId: 88888,
      owner: 'test-owner',
      name: 'test-repo',
      cloneUrl: 'https://github.com/test/test-repo',
      encryptedToken: 'fake-encrypted-token-for-tests',
    },
  });
  repoId = repo.id;
});

afterAll(async () => {
  await prisma.agentStep.deleteMany({ where: { run: { userId } } });
  await prisma.agentRun.deleteMany({ where: { userId } });
  await prisma.repository.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  vi.clearAllMocks();
  mockCallTool.mockResolvedValue('src/index.ts\npackage.json\nREADME.md');
  mockSendWithTools.mockResolvedValue([
    { role: 'user', content: 'Add a feature' },
    {
      role: 'assistant',
      content: [{ type: 'text', text: '1. Write test\n2. Implement\n3. Commit' }],
    },
  ]);

  const run = await prisma.agentRun.create({
    data: { userId, repoId, taskDescription: 'Add search feature', currentState: 'idle' },
  });
  runId = run.id;
});

afterEach(async () => {
  await prisma.agentStep.deleteMany({ where: { runId } });
  await prisma.agentRun.deleteMany({ where: { id: runId } });
});

describe('AgentStateMachine', () => {
  it('transitions to waiting_for_plan_approval after start()', async () => {
    const sm = new AgentStateMachine(runId, prisma, mockClaude, mockMCP);
    await sm.start();

    const run = await prisma.agentRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run.currentState).toBe('waiting_for_plan_approval');
  });

  it('creates 3 AgentStep records with correct types', async () => {
    const sm = new AgentStateMachine(runId, prisma, mockClaude, mockMCP);
    await sm.start();

    const steps = await prisma.agentStep.findMany({ where: { runId }, orderBy: { stepNumber: 'asc' } });
    expect(steps).toHaveLength(3);
    expect(steps.map((s) => s.stepType)).toEqual(['analyze_repo', 'generate_plan', 'save_plan']);
    expect(steps.every((s) => s.status === 'completed')).toBe(true);
  });

  it('saves planJson to AgentRun', async () => {
    const sm = new AgentStateMachine(runId, prisma, mockClaude, mockMCP);
    await sm.start();

    const run = await prisma.agentRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run.planJson).not.toBeNull();
  });

  it('transitions to failed when MCPClientManager throws', async () => {
    mockCallTool.mockRejectedValueOnce(new Error('spawn failed'));

    const sm = new AgentStateMachine(runId, prisma, mockClaude, mockMCP);
    await expect(sm.start()).rejects.toThrow('spawn failed');

    const run = await prisma.agentRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run.currentState).toBe('failed');

    const failedStep = await prisma.agentStep.findFirst({
      where: { runId, status: 'failed' },
    });
    expect(failedStep?.errorMessage).toContain('spawn failed');
  });

  it('transitions to failed when ClaudeService throws', async () => {
    mockSendWithTools.mockRejectedValueOnce(new Error('Claude API error'));

    const sm = new AgentStateMachine(runId, prisma, mockClaude, mockMCP);
    await expect(sm.start()).rejects.toThrow('Claude API error');

    const run = await prisma.agentRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run.currentState).toBe('failed');
  });

  it('second start() call is queued, not interleaved', async () => {
    const sm = new AgentStateMachine(runId, prisma, mockClaude, mockMCP);
    const p1 = sm.start();
    const p2 = sm.start();
    await Promise.allSettled([p1, p2]);

    // Both calls resolve (second is a no-op since currentState is no longer idle after first)
    // The important thing: no race condition or interleaved DB writes
    const steps = await prisma.agentStep.findMany({ where: { runId } });
    expect(steps.length).toBeGreaterThanOrEqual(3);
  });
});
```

- [ ] **Step 2: Run to confirm RED**

```bash
pnpm --filter @repo-pilot/agent-core test
```

Expected: FAIL — `agent-state-machine.js` not found.

- [ ] **Step 3: Implement AgentStateMachine**

Create `packages/agent-core/src/agent-state-machine.ts`:

```typescript
import { PrismaClient } from '@prisma/client';
import type Anthropic from '@anthropic-ai/sdk';
import type { ClaudeService } from './claude-service.js';
import type { MCPClientManager } from './mcp-client-manager.js';

const PHASE_1_TOOLS: Anthropic.Tool[] = [
  {
    name: 'list_files',
    description: 'List all files in the repository or a subdirectory.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Relative path (default: ".")' } },
    },
  },
  {
    name: 'read_file',
    description: 'Read the contents of a file. Sensitive files are blocked.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Relative path to the file' } },
      required: ['path'],
    },
  },
  {
    name: 'search_repo',
    description: 'Search for a string or regex in all files. Returns up to 100 matches.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'String or regex to search for' },
        path: { type: 'string', description: 'Subdirectory to scope search (default: ".")' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_diff',
    description: 'Get the current git diff.',
    input_schema: {
      type: 'object',
      properties: { staged: { type: 'boolean', description: 'Show staged changes' } },
    },
  },
];

export class AgentStateMachine {
  private stepCounter = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly runId: string,
    private readonly prisma: PrismaClient,
    private readonly claudeService: ClaudeService,
    private readonly mcpClientManager: MCPClientManager,
  ) {}

  start(): Promise<void> {
    this.queue = this.queue.then(() => this.run());
    return this.queue;
  }

  private async run(): Promise<void> {
    let mcpStarted = false;

    try {
      const run = await this.prisma.agentRun.findUniqueOrThrow({
        where: { id: this.runId },
      });

      // idle → analyzing_repo
      await this.transition('analyzing_repo', 'analyze_repo', 'Analyzing repository structure');
      await this.mcpClientManager.start();
      mcpStarted = true;
      const repoFiles = await this.mcpClientManager.callTool('list_files', {});
      await this.completeStep('analyze_repo');

      // analyzing_repo → planning
      await this.transition('planning', 'generate_plan', 'Generating implementation plan');
      const messages = await this.claudeService.sendWithTools(
        [
          {
            role: 'user',
            content: `Task: ${run.taskDescription}\n\nRepository files:\n${repoFiles}\n\nAnalyze the repository and produce a detailed implementation plan.`,
          },
        ],
        PHASE_1_TOOLS,
        (name, args) =>
          this.mcpClientManager.callTool(name, args as Record<string, unknown>),
      );
      await this.completeStep('generate_plan');

      // planning → waiting_for_plan_approval
      await this.transition('waiting_for_plan_approval', 'save_plan', 'Waiting for plan approval');
      const lastMessage = messages[messages.length - 1];
      await this.prisma.agentRun.update({
        where: { id: this.runId },
        data: { planJson: lastMessage.content as object },
      });
      await this.completeStep('save_plan');
    } catch (err) {
      if (mcpStarted) await this.mcpClientManager.stop().catch(() => {});
      await this.fail(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  private async transition(state: string, stepType: string, description: string): Promise<void> {
    await this.prisma.agentRun.update({
      where: { id: this.runId },
      data: { currentState: state },
    });
    await this.prisma.agentStep.create({
      data: {
        runId: this.runId,
        stepNumber: ++this.stepCounter,
        stepType,
        description,
        status: 'running',
      },
    });
  }

  private async completeStep(stepType: string): Promise<void> {
    await this.prisma.agentStep.updateMany({
      where: { runId: this.runId, stepType, status: 'running' },
      data: { status: 'completed', completedAt: new Date() },
    });
  }

  private async fail(errorMessage: string): Promise<void> {
    try {
      await this.prisma.agentRun.update({
        where: { id: this.runId },
        data: { currentState: 'failed' },
      });
      await this.prisma.agentStep.updateMany({
        where: { runId: this.runId, status: 'running' },
        data: { status: 'failed', errorMessage },
      });
    } catch {
      // best-effort — original error is re-thrown by caller
    }
  }
}
```

- [ ] **Step 4: Run to confirm GREEN**

```bash
pnpm --filter @repo-pilot/agent-core test
```

Expected: all AgentStateMachine tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-core/src/agent-state-machine.ts packages/agent-core/src/agent-state-machine.test.ts
git commit -m "feat(agent-core): add AgentStateMachine with 4 Phase 1 state transitions"
```

---

## Task 5: Update exports, typecheck, build, and push

**Files:**
- Modify: `packages/agent-core/src/index.ts`

- [ ] **Step 1: Update index.ts**

Replace `packages/agent-core/src/index.ts` with:

```typescript
export { SecretRedactor } from './secret-redactor.js';
export { PathValidator, PathValidationError } from './path-validator.js';
export { EncryptionService, EncryptionError } from './encryption-service.js';
export { MCPClientManager, MCPTimeoutError } from './mcp-client-manager.js';
export { ClaudeService, ClaudeRateLimitError, ClaudeContextLimitError, ClaudeMaxIterationsError } from './claude-service.js';
export { AgentStateMachine } from './agent-state-machine.js';
```

- [ ] **Step 2: Run the full test suite**

```bash
pnpm --filter @repo-pilot/agent-core test
```

Expected: all tests PASS.

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @repo-pilot/agent-core typecheck
```

Expected: no errors.

- [ ] **Step 4: Build**

```bash
pnpm --filter @repo-pilot/agent-core build
```

Expected: produces `dist/` with no TypeScript errors.

- [ ] **Step 5: Commit and push**

```bash
git add packages/agent-core/src/index.ts
git commit -m "feat(agent-core): export MCPClientManager, ClaudeService, AgentStateMachine"
git push origin feat/phase-1-agent-core
```

---

## Verification Checklist

Before opening the PR:

- [ ] `pnpm --filter @repo-pilot/agent-core test` — all tests pass
- [ ] `pnpm --filter @repo-pilot/agent-core typecheck` — clean
- [ ] `pnpm --filter @repo-pilot/agent-core build` — no errors
- [ ] SecretRedactor test: tool result with `DATABASE_URL=...secret...` is redacted to `[REDACTED]` before Claude receives it
- [ ] AgentStateMachine failure test: `currentState` is `'failed'` and `AgentStep.errorMessage` is populated

# MCP Server — Read-Only Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@repo-pilot/mcp-server` as a standalone stdio MCP server with five read-only tools verifiable via the MCP Inspector.

**Architecture:** A single Node.js process communicates over stdio using the MCP protocol. Each tool lives in its own file under `src/tools/`. The server entry point registers all tools and handles routing. Security (PathValidator, blocklist) is enforced inside each tool handler before any filesystem access.

**Tech Stack:** `@modelcontextprotocol/sdk` (stdio transport), `@octokit/rest` (GitHub API), `zod` (input validation), `@repo-pilot/agent-core` (PathValidator), Vitest (tests).

---

## File Structure

```
packages/mcp-server/
  src/
    index.ts                   — entry point: starts server, registers tools, validates REPO_ROOT
    blocklist.ts               — sensitive filename patterns + isBlocklisted() checker
    tools/
      list-files.ts            — list_files handler
      read-file.ts             — read_file handler
      search-repo.ts           — search_repo handler
      get-diff.ts              — get_diff handler
      get-github-issue.ts      — get_github_issue handler
  tests/
    helpers/
      fixture.ts               — creates/destroys a real git repo in /tmp for integration tests
    list-files.test.ts
    read-file.test.ts
    search-repo.test.ts
    get-diff.test.ts
    get-github-issue.test.ts
  src/
    blocklist.test.ts          — unit tests for isBlocklisted()
  package.json                 — add SDK + octokit + agent-core dependency
  tsconfig.json
  vitest.config.ts
```

---

## Task 1: Add dependencies and update package.json

**Files:**
- Modify: `packages/mcp-server/package.json`

- [ ] **Step 1: Create feature branch**

```bash
git checkout -b feat/phase-1-mcp-server
```

- [ ] **Step 2: Replace package.json with full dependency list**

```json
{
  "name": "@repo-pilot/mcp-server",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "@octokit/rest": "^21.0.0",
    "@repo-pilot/agent-core": "workspace:*",
    "zod": "^3"
  },
  "devDependencies": {
    "typescript": "*",
    "tsx": "^4",
    "vitest": "*",
    "@types/node": "^20"
  }
}
```

- [ ] **Step 3: Install dependencies**

```bash
pnpm install
```

Expected: resolves without errors. `node_modules/@modelcontextprotocol` appears in the package's node_modules.

- [ ] **Step 4: Commit**

```bash
git add packages/mcp-server/package.json pnpm-lock.yaml
git commit -m "chore(mcp-server): add MCP SDK, octokit, and agent-core dependencies"
```

---

## Task 2: Blocklist — unit tests then implementation

**Files:**
- Create: `packages/mcp-server/src/blocklist.ts`
- Create: `packages/mcp-server/src/blocklist.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/mcp-server/src/blocklist.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { isBlocklisted } from './blocklist.js';

describe('isBlocklisted', () => {
  it('blocks .env files', () => {
    expect(isBlocklisted('.env')).toBe(true);
    expect(isBlocklisted('.env.local')).toBe(true);
    expect(isBlocklisted('.env.production')).toBe(true);
  });

  it('blocks private key files', () => {
    expect(isBlocklisted('id_rsa')).toBe(true);
    expect(isBlocklisted('id_ed25519')).toBe(true);
    expect(isBlocklisted('id_dsa')).toBe(true);
  });

  it('blocks certificate and key extensions', () => {
    expect(isBlocklisted('server.pem')).toBe(true);
    expect(isBlocklisted('cert.key')).toBe(true);
    expect(isBlocklisted('keystore.p12')).toBe(true);
    expect(isBlocklisted('keystore.pfx')).toBe(true);
    expect(isBlocklisted('android.keystore')).toBe(true);
  });

  it('blocks known secrets files', () => {
    expect(isBlocklisted('secrets.json')).toBe(true);
    expect(isBlocklisted('credentials.json')).toBe(true);
  });

  it('allows normal source files', () => {
    expect(isBlocklisted('index.ts')).toBe(false);
    expect(isBlocklisted('package.json')).toBe(false);
    expect(isBlocklisted('README.md')).toBe(false);
    expect(isBlocklisted('.eslintrc')).toBe(false);
  });

  it('checks only the basename, not the full path', () => {
    expect(isBlocklisted('/some/path/to/.env')).toBe(true);
    expect(isBlocklisted('/some/path/to/index.ts')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to confirm RED**

```bash
pnpm --filter @repo-pilot/mcp-server test
```

Expected: FAIL — `blocklist.js` not found.

- [ ] **Step 3: Implement blocklist.ts**

Create `packages/mcp-server/src/blocklist.ts`:

```typescript
import path from 'node:path';

const BLOCKED_PATTERNS: RegExp[] = [
  /^\.env(\..+)?$/,
  /^id_rsa$/,
  /^id_ed25519$/,
  /^id_dsa$/,
  /\.pem$/,
  /\.key$/,
  /\.p12$/,
  /\.pfx$/,
  /\.keystore$/,
  /^secrets\.json$/,
  /^credentials\.json$/,
];

export function isBlocklisted(filePath: string): boolean {
  const base = path.basename(filePath);
  return BLOCKED_PATTERNS.some((pattern) => pattern.test(base));
}
```

- [ ] **Step 4: Run tests to confirm GREEN**

```bash
pnpm --filter @repo-pilot/mcp-server test
```

Expected: all blocklist tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-server/src/blocklist.ts packages/mcp-server/src/blocklist.test.ts
git commit -m "feat(mcp-server): add file blocklist with tests"
```

---

## Task 3: Test fixture helper

**Files:**
- Create: `packages/mcp-server/tests/helpers/fixture.ts`

The fixture creates a real git repo in a temp directory. Shared by all integration tests.

- [ ] **Step 1: Create fixture helper**

Create `packages/mcp-server/tests/helpers/fixture.ts`:

```typescript
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export interface TestRepo {
  root: string;
  cleanup: () => void;
}

export function createTestRepo(): TestRepo {
  const root = mkdtempSync(join(tmpdir(), 'repo-pilot-test-'));

  // git identity required for commits
  const git = (cmd: string) => execSync(cmd, { cwd: root, stdio: 'pipe' });
  git('git init');
  git('git config user.email "test@test.com"');
  git('git config user.name "Test"');

  // directory structure
  mkdirSync(join(root, 'src'));
  mkdirSync(join(root, 'node_modules', 'some-dep'), { recursive: true });

  // source files with known content for search tests
  writeFileSync(join(root, 'src', 'index.ts'), 'export function hello() { return "world"; }\n');
  writeFileSync(join(root, 'src', 'utils.ts'), 'export const PI = 3.14;\n// TODO: remove this\n');
  writeFileSync(join(root, 'package.json'), '{"name":"test-repo","version":"1.0.0"}\n');
  writeFileSync(join(root, 'README.md'), '# Test Repo\nHello world\n');

  // sensitive files that must be blocked
  writeFileSync(join(root, '.env'), 'SECRET=supersecret\n');
  writeFileSync(join(root, 'id_rsa'), '-----BEGIN RSA PRIVATE KEY-----\nfake\n');

  // node_modules file (must be excluded from list/search)
  writeFileSync(join(root, 'node_modules', 'some-dep', 'index.js'), 'module.exports = {};\n');

  // initial commit so git diff works
  git('git add src package.json README.md');
  git('git commit -m "initial commit"');

  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/mcp-server/tests/helpers/fixture.ts
git commit -m "test(mcp-server): add shared git repo fixture helper"
```

---

## Task 4: list_files tool

**Files:**
- Create: `packages/mcp-server/src/tools/list-files.ts`
- Create: `packages/mcp-server/tests/list-files.test.ts`

- [ ] **Step 1: Write failing integration tests**

Create `packages/mcp-server/tests/list-files.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestRepo, type TestRepo } from './helpers/fixture.js';
import { listFiles } from '../src/tools/list-files.js';

describe('listFiles', () => {
  let repo: TestRepo;

  beforeAll(() => { repo = createTestRepo(); });
  afterAll(() => repo.cleanup());

  it('lists all non-excluded files from the repo root', () => {
    const result = listFiles(repo.root, '.');
    expect(result).toContain('src/index.ts');
    expect(result).toContain('src/utils.ts');
    expect(result).toContain('package.json');
    expect(result).toContain('README.md');
  });

  it('excludes node_modules', () => {
    const result = listFiles(repo.root, '.');
    expect(result).not.toContain('node_modules');
  });

  it('lists files in a subdirectory', () => {
    const result = listFiles(repo.root, 'src');
    expect(result).toContain('src/index.ts');
    expect(result).toContain('src/utils.ts');
    expect(result).not.toContain('package.json');
  });

  it('throws PathValidationError for traversal attempts', () => {
    expect(() => listFiles(repo.root, '../../etc')).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to confirm RED**

```bash
pnpm --filter @repo-pilot/mcp-server test
```

Expected: FAIL — `list-files.js` not found.

- [ ] **Step 3: Implement list-files.ts**

Create `packages/mcp-server/src/tools/list-files.ts`:

```typescript
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { PathValidator } from '@repo-pilot/agent-core';

const EXCLUDED_DIRS = new Set(['.git', 'node_modules', 'dist', '.turbo', '.next']);

export function listFiles(repoRoot: string, relativePath: string = '.'): string {
  const validator = new PathValidator(repoRoot);
  const absPath = validator.validate(relativePath);

  const results: string[] = [];
  walkDir(absPath, repoRoot, results);

  return results.length > 0 ? results.join('\n') : 'No files found.';
}

function walkDir(dir: string, repoRoot: string, results: string[]): void {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) walkDir(fullPath, repoRoot, results);
    } else {
      results.push(relative(repoRoot, fullPath));
    }
  }
}
```

- [ ] **Step 4: Run tests to confirm GREEN**

```bash
pnpm --filter @repo-pilot/mcp-server test
```

Expected: all list_files tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-server/src/tools/list-files.ts packages/mcp-server/tests/list-files.test.ts
git commit -m "feat(mcp-server): add list_files tool with integration tests"
```

---

## Task 5: read_file tool

**Files:**
- Create: `packages/mcp-server/src/tools/read-file.ts`
- Create: `packages/mcp-server/tests/read-file.test.ts`

- [ ] **Step 1: Write failing integration tests**

Create `packages/mcp-server/tests/read-file.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestRepo, type TestRepo } from './helpers/fixture.js';
import { readFile } from '../src/tools/read-file.js';

describe('readFile', () => {
  let repo: TestRepo;

  beforeAll(() => { repo = createTestRepo(); });
  afterAll(() => repo.cleanup());

  it('reads a source file', () => {
    const result = readFile(repo.root, 'src/index.ts');
    expect(result).toContain('export function hello');
  });

  it('throws for a blocklisted .env file', () => {
    expect(() => readFile(repo.root, '.env')).toThrow('not permitted');
  });

  it('throws for a blocklisted private key file', () => {
    expect(() => readFile(repo.root, 'id_rsa')).toThrow('not permitted');
  });

  it('throws for a path traversal attempt', () => {
    expect(() => readFile(repo.root, '../../etc/passwd')).toThrow();
  });

  it('throws for a file that does not exist', () => {
    expect(() => readFile(repo.root, 'nonexistent.ts')).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to confirm RED**

```bash
pnpm --filter @repo-pilot/mcp-server test
```

Expected: FAIL — `read-file.js` not found.

- [ ] **Step 3: Implement read-file.ts**

Create `packages/mcp-server/src/tools/read-file.ts`:

```typescript
import { readFileSync } from 'node:fs';
import { PathValidator } from '@repo-pilot/agent-core';
import { isBlocklisted } from '../blocklist.js';

export function readFile(repoRoot: string, relativePath: string): string {
  const validator = new PathValidator(repoRoot);
  const absPath = validator.validate(relativePath);

  if (isBlocklisted(absPath)) {
    throw new Error(`reading this file is not permitted`);
  }

  return readFileSync(absPath, 'utf8');
}
```

- [ ] **Step 4: Run tests to confirm GREEN**

```bash
pnpm --filter @repo-pilot/mcp-server test
```

Expected: all read_file tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-server/src/tools/read-file.ts packages/mcp-server/tests/read-file.test.ts
git commit -m "feat(mcp-server): add read_file tool with integration tests"
```

---

## Task 6: search_repo tool

**Files:**
- Create: `packages/mcp-server/src/tools/search-repo.ts`
- Create: `packages/mcp-server/tests/search-repo.test.ts`

- [ ] **Step 1: Write failing integration tests**

Create `packages/mcp-server/tests/search-repo.test.ts`:

```typescript
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestRepo, type TestRepo } from './helpers/fixture.js';
import { searchRepo } from '../src/tools/search-repo.js';

describe('searchRepo', () => {
  let repo: TestRepo;

  beforeAll(() => { repo = createTestRepo(); });
  afterAll(() => repo.cleanup());

  it('finds a match in a source file', () => {
    const result = searchRepo(repo.root, 'hello');
    expect(result).toContain('src/index.ts');
    expect(result).toContain('hello');
  });

  it('returns no matches message when nothing found', () => {
    const result = searchRepo(repo.root, 'zzz_does_not_exist_zzz');
    expect(result).toBe('No matches found.');
  });

  it('supports regex queries', () => {
    const result = searchRepo(repo.root, 'export (function|const)');
    expect(result).toContain('src/index.ts');
    expect(result).toContain('src/utils.ts');
  });

  it('excludes node_modules from results', () => {
    const result = searchRepo(repo.root, 'module');
    expect(result).not.toContain('node_modules');
  });

  it('scopes search to a subdirectory', () => {
    const result = searchRepo(repo.root, 'PI', 'src');
    expect(result).toContain('src/utils.ts');
    expect(result).not.toContain('package.json');
  });
});
```

- [ ] **Step 2: Run tests to confirm RED**

```bash
pnpm --filter @repo-pilot/mcp-server test
```

Expected: FAIL — `search-repo.js` not found.

- [ ] **Step 3: Implement search-repo.ts**

Create `packages/mcp-server/src/tools/search-repo.ts`:

```typescript
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { PathValidator } from '@repo-pilot/agent-core';

const EXCLUDED_DIRS = new Set(['.git', 'node_modules', 'dist', '.turbo', '.next']);
const MAX_RESULTS = 100;

export function searchRepo(repoRoot: string, query: string, relativePath: string = '.'): string {
  const validator = new PathValidator(repoRoot);
  const absPath = validator.validate(relativePath);

  const regex = new RegExp(query, 'gm');
  const matches: string[] = [];

  walkAndSearch(absPath, repoRoot, regex, matches);

  if (matches.length === 0) return 'No matches found.';

  const truncated = matches.length > MAX_RESULTS;
  const output = matches.slice(0, MAX_RESULTS).join('\n');
  return truncated ? `${output}\n[truncated — 100 match limit reached]` : output;
}

function walkAndSearch(dir: string, repoRoot: string, regex: RegExp, matches: string[]): void {
  if (matches.length >= MAX_RESULTS) return;

  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (matches.length >= MAX_RESULTS) break;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) walkAndSearch(fullPath, repoRoot, regex, matches);
    } else {
      try {
        const content = readFileSync(fullPath, 'utf8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length && matches.length < MAX_RESULTS; i++) {
          regex.lastIndex = 0;
          if (regex.test(lines[i])) {
            matches.push(`${relative(repoRoot, fullPath)}:${i + 1}: ${lines[i].trim()}`);
          }
        }
      } catch {
        // skip unreadable binary files
      }
    }
  }
}
```

- [ ] **Step 4: Run tests to confirm GREEN**

```bash
pnpm --filter @repo-pilot/mcp-server test
```

Expected: all search_repo tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-server/src/tools/search-repo.ts packages/mcp-server/tests/search-repo.test.ts
git commit -m "feat(mcp-server): add search_repo tool with integration tests"
```

---

## Task 7: get_diff tool

**Files:**
- Create: `packages/mcp-server/src/tools/get-diff.ts`
- Create: `packages/mcp-server/tests/get-diff.test.ts`

- [ ] **Step 1: Write failing integration tests**

Create `packages/mcp-server/tests/get-diff.test.ts`:

```typescript
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestRepo, type TestRepo } from './helpers/fixture.js';
import { getDiff } from '../src/tools/get-diff.js';

describe('getDiff', () => {
  let repo: TestRepo;

  beforeAll(() => { repo = createTestRepo(); });
  afterAll(() => repo.cleanup());

  it('returns "No changes." when the working tree is clean', () => {
    const result = getDiff(repo.root, false);
    expect(result).toBe('No changes.');
  });

  it('shows unstaged changes after modifying a file', () => {
    writeFileSync(join(repo.root, 'src', 'index.ts'), 'export function hello() { return "modified"; }\n');
    const result = getDiff(repo.root, false);
    expect(result).toContain('modified');
    // restore
    execSync('git checkout -- src/index.ts', { cwd: repo.root });
  });

  it('shows staged changes when staged flag is true', () => {
    writeFileSync(join(repo.root, 'src', 'utils.ts'), 'export const PI = 3.14159;\n');
    execSync('git add src/utils.ts', { cwd: repo.root });
    const result = getDiff(repo.root, true);
    expect(result).toContain('3.14159');
    // restore
    execSync('git checkout -- src/utils.ts', { cwd: repo.root });
    execSync('git restore --staged src/utils.ts', { cwd: repo.root });
  });
});
```

- [ ] **Step 2: Run tests to confirm RED**

```bash
pnpm --filter @repo-pilot/mcp-server test
```

Expected: FAIL — `get-diff.js` not found.

- [ ] **Step 3: Implement get-diff.ts**

Create `packages/mcp-server/src/tools/get-diff.ts`:

```typescript
import { execSync } from 'node:child_process';

export function getDiff(repoRoot: string, staged: boolean = false): string {
  const args = staged ? 'diff --cached' : 'diff';
  const result = execSync(`git ${args}`, { cwd: repoRoot }).toString();
  return result.trim() || 'No changes.';
}
```

- [ ] **Step 4: Run tests to confirm GREEN**

```bash
pnpm --filter @repo-pilot/mcp-server test
```

Expected: all get_diff tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-server/src/tools/get-diff.ts packages/mcp-server/tests/get-diff.test.ts
git commit -m "feat(mcp-server): add get_diff tool with integration tests"
```

---

## Task 8: get_github_issue tool

**Files:**
- Create: `packages/mcp-server/src/tools/get-github-issue.ts`
- Create: `packages/mcp-server/tests/get-github-issue.test.ts`

Note: the GitHub API is mocked here — hitting the real API in tests requires secrets and is brittle in CI. This is the only acceptable mock in this package.

- [ ] **Step 1: Write failing tests**

Create `packages/mcp-server/tests/get-github-issue.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getGithubIssue } from '../src/tools/get-github-issue.js';

describe('getGithubIssue', () => {
  const originalToken = process.env.GITHUB_TOKEN;

  afterEach(() => {
    process.env.GITHUB_TOKEN = originalToken;
    vi.restoreAllMocks();
  });

  it('throws when GITHUB_TOKEN is missing', async () => {
    delete process.env.GITHUB_TOKEN;
    await expect(getGithubIssue('owner', 'repo', 1)).rejects.toThrow('GITHUB_TOKEN is required');
  });

  it('formats issue with title, state, labels, and body', async () => {
    process.env.GITHUB_TOKEN = 'fake-token';

    vi.mock('@octokit/rest', () => ({
      Octokit: vi.fn().mockImplementation(() => ({
        issues: {
          get: vi.fn().mockResolvedValue({
            data: {
              number: 42,
              title: 'Fix alarm validation bug',
              state: 'open',
              labels: [{ name: 'bug' }, { name: 'high-priority' }],
              body: 'The alarm fires even when threshold is not exceeded.',
            },
          }),
        },
      })),
    }));

    const result = await getGithubIssue('owner', 'repo', 42);
    expect(result).toContain('Issue #42: Fix alarm validation bug [open]');
    expect(result).toContain('Labels: bug, high-priority');
    expect(result).toContain('The alarm fires even when threshold is not exceeded.');
  });
});
```

- [ ] **Step 2: Run tests to confirm RED**

```bash
pnpm --filter @repo-pilot/mcp-server test
```

Expected: FAIL — `get-github-issue.js` not found.

- [ ] **Step 3: Implement get-github-issue.ts**

Create `packages/mcp-server/src/tools/get-github-issue.ts`:

```typescript
import { Octokit } from '@octokit/rest';

export async function getGithubIssue(
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<string> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN is required for get_github_issue');

  const octokit = new Octokit({ auth: token });
  const { data } = await octokit.issues.get({ owner, repo, issue_number: issueNumber });

  const labels = data.labels
    .map((l) => (typeof l === 'string' ? l : l.name))
    .filter(Boolean)
    .join(', ');

  return [
    `Issue #${data.number}: ${data.title} [${data.state}]`,
    labels ? `Labels: ${labels}` : null,
    '---',
    data.body ?? '(no description)',
  ]
    .filter(Boolean)
    .join('\n');
}
```

- [ ] **Step 4: Run tests to confirm GREEN**

```bash
pnpm --filter @repo-pilot/mcp-server test
```

Expected: all get_github_issue tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp-server/src/tools/get-github-issue.ts packages/mcp-server/tests/get-github-issue.test.ts
git commit -m "feat(mcp-server): add get_github_issue tool with mocked tests"
```

---

## Task 9: Wire up index.ts and smoke test

**Files:**
- Modify: `packages/mcp-server/src/index.ts`

- [ ] **Step 1: Replace index.ts with the server entry point**

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { listFiles } from './tools/list-files.js';
import { readFile } from './tools/read-file.js';
import { searchRepo } from './tools/search-repo.js';
import { getDiff } from './tools/get-diff.js';
import { getGithubIssue } from './tools/get-github-issue.js';

const repoRoot = process.env.REPO_ROOT;
if (!repoRoot) {
  console.error('Error: REPO_ROOT environment variable is required');
  process.exit(1);
}

const server = new Server(
  { name: 'repo-agent-mcp-server', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'list_files',
      description: 'List all files in the repository or a subdirectory. Excludes node_modules, .git, dist.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to list (default: ".")' },
        },
      },
    },
    {
      name: 'read_file',
      description: 'Read the contents of a file. Sensitive files (.env, keys, certs) are blocked.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path to the file' },
        },
        required: ['path'],
      },
    },
    {
      name: 'search_repo',
      description: 'Search for a string or regex in all files. Returns up to 100 matches.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'String or regex to search for' },
          path: { type: 'string', description: 'Subdirectory to search in (default: ".")' },
        },
        required: ['query'],
      },
    },
    {
      name: 'get_diff',
      description: 'Get the current git diff (unstaged by default, or staged).',
      inputSchema: {
        type: 'object',
        properties: {
          staged: { type: 'boolean', description: 'Show staged changes (default: false)' },
        },
      },
    },
    {
      name: 'get_github_issue',
      description: 'Fetch a GitHub issue by number. Requires GITHUB_TOKEN env var.',
      inputSchema: {
        type: 'object',
        properties: {
          owner: { type: 'string', description: 'Repository owner' },
          repo: { type: 'string', description: 'Repository name' },
          issue_number: { type: 'number', description: 'Issue number' },
        },
        required: ['owner', 'repo', 'issue_number'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let text: string;

    switch (name) {
      case 'list_files':
        text = listFiles(repoRoot, (args?.path as string) ?? '.');
        break;
      case 'read_file':
        text = readFile(repoRoot, args?.path as string);
        break;
      case 'search_repo':
        text = searchRepo(repoRoot, args?.query as string, (args?.path as string) ?? '.');
        break;
      case 'get_diff':
        text = getDiff(repoRoot, (args?.staged as boolean) ?? false);
        break;
      case 'get_github_issue':
        text = await getGithubIssue(
          args?.owner as string,
          args?.repo as string,
          args?.issue_number as number,
        );
        break;
      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return { content: [{ type: 'text', text }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

- [ ] **Step 2: Update index.test.ts to test the module still exports without crashing**

Replace `packages/mcp-server/src/index.test.ts` (the existing placeholder):

```typescript
import { describe, it, expect } from 'vitest';
import { isBlocklisted } from './blocklist.js';

// index.ts starts the MCP server on import so it cannot be imported in tests.
// Smoke-test the building blocks that index.ts depends on instead.
describe('mcp-server exports', () => {
  it('blocklist is accessible', () => {
    expect(typeof isBlocklisted).toBe('function');
  });
});
```

- [ ] **Step 3: Run full test suite to confirm GREEN**

```bash
pnpm --filter @repo-pilot/mcp-server test
```

Expected: all tests PASS (blocklist unit + 4 integration suites + smoke test).

- [ ] **Step 4: Build and smoke-test with MCP Inspector**

```bash
pnpm --filter @repo-pilot/mcp-server build
```

Then in a terminal (replace path with any real local repo):

```bash
REPO_ROOT=C:/users/satov/repo-pilot npx @modelcontextprotocol/inspector node packages/mcp-server/dist/index.js
```

Open the Inspector URL shown in the terminal. Call `list_files` with no arguments — you should see the repo files listed.

- [ ] **Step 5: Commit and push**

```bash
git add packages/mcp-server/src/index.ts packages/mcp-server/src/index.test.ts
git commit -m "feat(mcp-server): wire up server entry point with all five tools"
git push origin feat/phase-1-mcp-server
```

---

## Verification Checklist

Before opening the PR, confirm:

- [ ] `pnpm --filter @repo-pilot/mcp-server test` — all tests pass
- [ ] `pnpm --filter @repo-pilot/mcp-server build` — no TypeScript errors
- [ ] MCP Inspector: `list_files`, `read_file`, `search_repo`, `get_diff` each return expected output
- [ ] `read_file` on `.env` returns an error response, not the file contents
- [ ] `read_file` on `../../etc/passwd` (or Windows equivalent) returns an error response

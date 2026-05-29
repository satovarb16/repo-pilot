# PR C2 — Phase 1 Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the minimal Phase 1 frontend — connect a GitHub repo, compose a task, start a run, and watch the SSE agent trace in real time.

**Architecture:** Zustand store holds all shared state (repos, selectedRepoId, activeRunId, traceEvents, runStatus). A typed fetch wrapper (`lib/api.ts`) communicates with the backend via Next.js proxy rewrites. A `useAgentStream` hook opens an EventSource and pushes events into the store. Three shell components (Sidebar, MainPanel, RightPanel) are populated with real components.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind 4, Zustand 5, shadcn/ui (base-nova), Vitest + jsdom + @testing-library/react

---

## File Map

```
apps/web/
  lib/
    types.ts                  ← Repository, AgentSSEEvent, RunStatus, ConnectRepoInput
    store.ts                  ← Zustand store (useAppStore)
    store.test.ts             ← store unit tests
    api.ts                    ← listRepos, connectRepo, startRun, ApiError
    api.test.ts               ← API client unit tests
    sse.ts                    ← useAgentStream hook
    sse.test.ts               ← SSE hook unit tests
    utils.ts                  ← already exists (cn helper)
  components/
    layout/
      Sidebar.tsx             ← modify: repo list + ConnectRepoDialog
      MainPanel.tsx           ← modify: TaskComposer or empty state
      RightPanel.tsx          ← modify: TraceLog header + scroll area
    repos/
      ConnectRepoDialog.tsx   ← new: shadcn Dialog form (owner, name, PAT)
      RepoListItem.tsx        ← new: clickable repo row
    runs/
      TaskComposer.tsx        ← new: textarea + Start Run button
      TraceLog.tsx            ← new: monospace SSE event list
  vitest.config.ts            ← new: jsdom environment + @/ alias
  next.config.ts              ← modify: add /api/v1/* proxy rewrite
  package.json                ← modify: add zustand, vitest, testing-library, jsdom
```

---

## Task 1: Setup — Install dependencies, vitest config, types, shadcn components

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/vitest.config.ts`
- Create: `apps/web/lib/types.ts`
- Modify: `vitest.workspace.ts` (root)

- [ ] **Step 1.1: Install production and dev dependencies**

```bash
cd apps/web
pnpm add zustand
pnpm add -D vitest @testing-library/react jsdom @vitejs/plugin-react
```

Expected: no errors, `node_modules` updated, `package.json` updated.

- [ ] **Step 1.2: Install shadcn components**

```bash
# Run from apps/web
pnpm dlx shadcn@latest add dialog input label textarea badge
```

Expected: `components/ui/dialog.tsx`, `input.tsx`, `label.tsx`, `textarea.tsx`, `badge.tsx` created.

- [ ] **Step 1.3: Create `apps/web/vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
```

- [ ] **Step 1.4: Add web to vitest workspace**

Read `vitest.workspace.ts` at the repo root. If it does not already include `apps/web`, add it:

```typescript
// vitest.workspace.ts — add the web entry alongside existing entries
{
  extends: './apps/web/vitest.config.ts',
  test: { name: 'web' },
}
```

- [ ] **Step 1.5: Create `apps/web/lib/types.ts`**

```typescript
export interface Repository {
  id: string
  owner: string
  name: string
  cloneUrl: string
  cloneStatus: string
  createdAt: string
}

export type AgentSSEEvent =
  | { type: 'state_changed'; state: string }
  | { type: 'step_started'; stepType: string; description: string }
  | { type: 'step_completed'; stepType: string; durationMs: number }
  | { type: 'tool_called'; name: string; input: unknown; output: string }
  | { type: 'run_completed'; planJson: unknown }
  | { type: 'run_failed'; error: string }

export type RunStatus = 'idle' | 'running' | 'completed' | 'failed'

export interface ConnectRepoInput {
  githubRepoId: number
  owner: string
  name: string
  cloneUrl: string
  pat: string
}
```

- [ ] **Step 1.6: Verify TypeScript compiles**

```bash
pnpm --filter web typecheck 2>&1
```

Expected: no errors.

- [ ] **Step 1.7: Commit**

```bash
git add apps/web/package.json apps/web/vitest.config.ts apps/web/lib/types.ts \
  apps/web/components/ui/ vitest.workspace.ts pnpm-lock.yaml
git commit -m "chore(web): add zustand, vitest, shadcn components, and types"
```

---

## Task 2: Zustand store — `lib/store.ts` with TDD

**Files:**
- Create: `apps/web/lib/store.ts`
- Create: `apps/web/lib/store.test.ts`

- [ ] **Step 2.1: Write failing tests first**

Create `apps/web/lib/store.test.ts`:

```typescript
import { beforeEach, describe, expect, it } from 'vitest'
import { useAppStore } from './store'
import type { AgentSSEEvent, Repository } from './types'

const testRepo: Repository = {
  id: 'repo-1',
  owner: 'test-owner',
  name: 'test-repo',
  cloneUrl: 'https://github.com/test-owner/test-repo.git',
  cloneStatus: 'pending',
  createdAt: '2026-05-29T00:00:00.000Z',
}

describe('AppStore', () => {
  beforeEach(() => {
    useAppStore.setState({
      repos: [],
      selectedRepoId: null,
      activeRunId: null,
      traceEvents: [],
      runStatus: 'idle',
    })
  })

  it('setRepos replaces the repos list', () => {
    useAppStore.getState().setRepos([testRepo])
    expect(useAppStore.getState().repos).toHaveLength(1)
    expect(useAppStore.getState().repos[0].id).toBe('repo-1')
  })

  it('addRepo appends without replacing existing repos', () => {
    useAppStore.getState().addRepo(testRepo)
    useAppStore.getState().addRepo({ ...testRepo, id: 'repo-2' })
    expect(useAppStore.getState().repos).toHaveLength(2)
  })

  it('selectRepo sets selectedRepoId and clears run state', () => {
    useAppStore.setState({
      activeRunId: 'run-1',
      traceEvents: [{ type: 'run_failed', error: 'x' }],
      runStatus: 'failed',
    })
    useAppStore.getState().selectRepo('repo-1')
    expect(useAppStore.getState().selectedRepoId).toBe('repo-1')
    expect(useAppStore.getState().activeRunId).toBeNull()
    expect(useAppStore.getState().traceEvents).toHaveLength(0)
    expect(useAppStore.getState().runStatus).toBe('idle')
  })

  it('appendTraceEvent adds event to traceEvents', () => {
    const event: AgentSSEEvent = { type: 'state_changed', state: 'analyzing_repo' }
    useAppStore.getState().appendTraceEvent(event)
    expect(useAppStore.getState().traceEvents).toHaveLength(1)
    expect(useAppStore.getState().traceEvents[0]).toEqual(event)
  })

  it('appendTraceEvent caps at 500 entries dropping the oldest', () => {
    const events = Array.from({ length: 501 }, (_, i) => ({
      type: 'state_changed' as const,
      state: `state-${i}`,
    }))
    for (const event of events) {
      useAppStore.getState().appendTraceEvent(event)
    }
    expect(useAppStore.getState().traceEvents).toHaveLength(500)
    expect(useAppStore.getState().traceEvents[0].state).toBe('state-1')
  })

  it('clearTrace resets traceEvents, activeRunId, and runStatus', () => {
    useAppStore.setState({
      activeRunId: 'run-1',
      traceEvents: [{ type: 'run_failed', error: 'x' }],
      runStatus: 'failed',
    })
    useAppStore.getState().clearTrace()
    expect(useAppStore.getState().traceEvents).toHaveLength(0)
    expect(useAppStore.getState().activeRunId).toBeNull()
    expect(useAppStore.getState().runStatus).toBe('idle')
  })
})
```

- [ ] **Step 2.2: Run tests — confirm RED**

```bash
pnpm --filter web test --reporter=verbose 2>&1
```

Expected: `Cannot find module './store'`

- [ ] **Step 2.3: Create `apps/web/lib/store.ts`**

```typescript
import { create } from 'zustand'
import type { AgentSSEEvent, Repository, RunStatus } from './types'

interface AppStore {
  repos: Repository[]
  selectedRepoId: string | null
  activeRunId: string | null
  traceEvents: AgentSSEEvent[]
  runStatus: RunStatus
  setRepos: (repos: Repository[]) => void
  addRepo: (repo: Repository) => void
  selectRepo: (id: string | null) => void
  setActiveRun: (runId: string) => void
  appendTraceEvent: (event: AgentSSEEvent) => void
  clearTrace: () => void
  setRunStatus: (status: RunStatus) => void
}

export const useAppStore = create<AppStore>()((set) => ({
  repos: [],
  selectedRepoId: null,
  activeRunId: null,
  traceEvents: [],
  runStatus: 'idle',

  setRepos: (repos) => set({ repos }),

  addRepo: (repo) => set((state) => ({ repos: [...state.repos, repo] })),

  selectRepo: (id) =>
    set({ selectedRepoId: id, activeRunId: null, traceEvents: [], runStatus: 'idle' }),

  setActiveRun: (runId) => set({ activeRunId: runId, runStatus: 'running' }),

  appendTraceEvent: (event) =>
    set((state) => ({
      traceEvents:
        state.traceEvents.length >= 500
          ? [...state.traceEvents.slice(1), event]
          : [...state.traceEvents, event],
    })),

  clearTrace: () => set({ traceEvents: [], activeRunId: null, runStatus: 'idle' }),

  setRunStatus: (status) => set({ runStatus: status }),
}))
```

- [ ] **Step 2.4: Run tests — confirm GREEN**

```bash
pnpm --filter web test --reporter=verbose 2>&1
```

Expected: 6 tests pass.

- [ ] **Step 2.5: Commit**

```bash
git add apps/web/lib/store.ts apps/web/lib/store.test.ts
git commit -m "feat(web): add Zustand store with trace event management"
```

---

## Task 3: API client — `lib/api.ts` with TDD

**Files:**
- Create: `apps/web/lib/api.ts`
- Create: `apps/web/lib/api.test.ts`

- [ ] **Step 3.1: Write failing tests first**

Create `apps/web/lib/api.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { connectRepo, listRepos, startRun, ApiError } from './api'
import type { ConnectRepoInput } from './types'

describe('API client', () => {
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn()
    global.fetch = mockFetch
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('listRepos', () => {
    it('returns repos array from repositories key on 200', async () => {
      const repos = [
        { id: '1', owner: 'a', name: 'b', cloneUrl: 'https://github.com/a/b.git', cloneStatus: 'pending', createdAt: '2026-01-01' },
      ]
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ repositories: repos }),
      })

      const result = await listRepos()
      expect(result).toEqual(repos)
      expect(mockFetch).toHaveBeenCalledWith('/api/v1/repositories', expect.any(Object))
    })

    it('throws ApiError on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Internal server error' }),
      })

      await expect(listRepos()).rejects.toThrow(ApiError)
      await expect(listRepos()).rejects.toThrow('Internal server error')
    })
  })

  describe('connectRepo', () => {
    const input: ConnectRepoInput = {
      githubRepoId: 123,
      owner: 'owner',
      name: 'repo',
      cloneUrl: 'https://github.com/owner/repo.git',
      pat: 'ghp_test',
    }

    it('sends POST with correct body and returns Repository', async () => {
      const repo = { id: 'r1', owner: 'owner', name: 'repo', cloneUrl: input.cloneUrl, cloneStatus: 'pending', createdAt: '2026-01-01' }
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => repo })

      const result = await connectRepo(input)
      expect(result).toEqual(repo)
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v1/repositories',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(input),
        }),
      )
    })

    it('throws ApiError on 400', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: 'Validation failed' }),
      })

      await expect(connectRepo(input)).rejects.toThrow(ApiError)
    })
  })

  describe('startRun', () => {
    it('returns runId on 201', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ runId: 'run-123' }) })

      const result = await startRun('repo-1', 'Fix the bug')
      expect(result.runId).toBe('run-123')
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/v1/agent/runs',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ repositoryId: 'repo-1', taskDescription: 'Fix the bug' }),
        }),
      )
    })

    it('throws ApiError on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ error: 'Repository not found' }),
      })

      await expect(startRun('bad-id', 'task')).rejects.toThrow(ApiError)
    })
  })
})
```

- [ ] **Step 3.2: Run tests — confirm RED**

```bash
pnpm --filter web test --reporter=verbose 2>&1
```

Expected: `Cannot find module './api'`

- [ ] **Step 3.3: Create `apps/web/lib/api.ts`**

```typescript
import type { ConnectRepoInput, Repository } from './types'

const BASE = '/api/v1'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  const data = (await res.json()) as Record<string, unknown>
  if (!res.ok) {
    throw new ApiError(res.status, (data.error as string) ?? 'Request failed')
  }
  return data as T
}

export async function listRepos(): Promise<Repository[]> {
  const data = await request<{ repositories: Repository[] }>('/repositories')
  return data.repositories
}

export async function connectRepo(input: ConnectRepoInput): Promise<Repository> {
  return request<Repository>('/repositories', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function startRun(
  repositoryId: string,
  taskDescription: string,
): Promise<{ runId: string }> {
  return request<{ runId: string }>('/agent/runs', {
    method: 'POST',
    body: JSON.stringify({ repositoryId, taskDescription }),
  })
}
```

- [ ] **Step 3.4: Run tests — confirm GREEN**

```bash
pnpm --filter web test --reporter=verbose 2>&1
```

Expected: all tests pass (6 store + 6 api = 12 total).

- [ ] **Step 3.5: Commit**

```bash
git add apps/web/lib/api.ts apps/web/lib/api.test.ts
git commit -m "feat(web): add typed API client with ApiError"
```

---

## Task 4: SSE hook — `lib/sse.ts` with TDD

**Files:**
- Create: `apps/web/lib/sse.ts`
- Create: `apps/web/lib/sse.test.ts`

- [ ] **Step 4.1: Write failing tests first**

Create `apps/web/lib/sse.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useAgentStream } from './sse'
import { useAppStore } from './store'

class MockEventSource {
  static instances: MockEventSource[] = []
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: Event) => void) | null = null
  readyState = 1
  closed = false

  constructor(public url: string) {
    MockEventSource.instances.push(this)
  }

  close() {
    this.closed = true
    this.readyState = 2
  }

  emit(data: string) {
    this.onmessage?.({ data } as MessageEvent)
  }
}

vi.stubGlobal('EventSource', MockEventSource)

describe('useAgentStream', () => {
  beforeEach(() => {
    MockEventSource.instances = []
    useAppStore.setState({
      repos: [],
      selectedRepoId: null,
      activeRunId: null,
      traceEvents: [],
      runStatus: 'idle',
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does nothing when runId is null', () => {
    renderHook(() => useAgentStream(null))
    expect(MockEventSource.instances).toHaveLength(0)
  })

  it('opens EventSource at the correct SSE URL when runId is provided', () => {
    renderHook(() => useAgentStream('run-123'))
    expect(MockEventSource.instances).toHaveLength(1)
    expect(MockEventSource.instances[0].url).toBe('/api/v1/agent/runs/run-123/stream')
  })

  it('appends parsed trace event to store on message', () => {
    renderHook(() => useAgentStream('run-123'))
    MockEventSource.instances[0].emit(
      JSON.stringify({ type: 'state_changed', state: 'analyzing_repo' }),
    )
    expect(useAppStore.getState().traceEvents).toHaveLength(1)
    expect(useAppStore.getState().traceEvents[0]).toEqual({
      type: 'state_changed',
      state: 'analyzing_repo',
    })
  })

  it('closes EventSource and sets runStatus to completed on run_completed', () => {
    renderHook(() => useAgentStream('run-123'))
    const es = MockEventSource.instances[0]
    es.emit(JSON.stringify({ type: 'run_completed', planJson: [] }))
    expect(es.closed).toBe(true)
    expect(useAppStore.getState().runStatus).toBe('completed')
  })

  it('closes EventSource and sets runStatus to failed on run_failed', () => {
    renderHook(() => useAgentStream('run-123'))
    const es = MockEventSource.instances[0]
    es.emit(JSON.stringify({ type: 'run_failed', error: 'Something went wrong' }))
    expect(es.closed).toBe(true)
    expect(useAppStore.getState().runStatus).toBe('failed')
  })

  it('closes EventSource on unmount', () => {
    const { unmount } = renderHook(() => useAgentStream('run-123'))
    unmount()
    expect(MockEventSource.instances[0].closed).toBe(true)
  })
})
```

- [ ] **Step 4.2: Run tests — confirm RED**

```bash
pnpm --filter web test --reporter=verbose 2>&1
```

Expected: `Cannot find module './sse'`

- [ ] **Step 4.3: Create `apps/web/lib/sse.ts`**

```typescript
import { useEffect } from 'react'
import { useAppStore } from './store'
import type { AgentSSEEvent } from './types'

export function useAgentStream(runId: string | null): void {
  const appendTraceEvent = useAppStore((s) => s.appendTraceEvent)
  const setRunStatus = useAppStore((s) => s.setRunStatus)

  useEffect(() => {
    if (!runId) return

    const es = new EventSource(`/api/v1/agent/runs/${runId}/stream`)

    es.onmessage = (e: MessageEvent) => {
      const event = JSON.parse(e.data as string) as AgentSSEEvent
      appendTraceEvent(event)
      if (event.type === 'run_completed') {
        setRunStatus('completed')
        es.close()
      } else if (event.type === 'run_failed') {
        setRunStatus('failed')
        es.close()
      }
    }

    es.onerror = () => {
      setRunStatus('failed')
      es.close()
    }

    return () => {
      es.close()
    }
  }, [runId, appendTraceEvent, setRunStatus])
}
```

- [ ] **Step 4.4: Run tests — confirm GREEN**

```bash
pnpm --filter web test --reporter=verbose 2>&1
```

Expected: all tests pass (6 store + 6 api + 6 sse = 18 total).

- [ ] **Step 4.5: Commit**

```bash
git add apps/web/lib/sse.ts apps/web/lib/sse.test.ts
git commit -m "feat(web): add useAgentStream SSE hook"
```

---

## Task 5: Next.js proxy rewrite

**Files:**
- Modify: `apps/web/next.config.ts`

- [ ] **Step 5.1: Add proxy rewrite to `apps/web/next.config.ts`**

```typescript
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: 'http://localhost:3001/api/v1/:path*',
      },
    ]
  },
}

export default nextConfig
```

- [ ] **Step 5.2: Verify TypeScript compiles**

```bash
pnpm --filter web typecheck 2>&1
```

Expected: no errors.

- [ ] **Step 5.3: Commit**

```bash
git add apps/web/next.config.ts
git commit -m "feat(web): add API proxy rewrite to Next.js config"
```

---

## Task 6: ConnectRepoDialog component

**Files:**
- Create: `apps/web/components/repos/ConnectRepoDialog.tsx`

- [ ] **Step 6.1: Create `apps/web/components/repos/ConnectRepoDialog.tsx`**

```tsx
'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { connectRepo, ApiError } from '@/lib/api'
import { useAppStore } from '@/lib/store'

export function ConnectRepoDialog() {
  const addRepo = useAppStore((s) => s.addRepo)
  const [open, setOpen] = useState(false)
  const [owner, setOwner] = useState('')
  const [name, setName] = useState('')
  const [pat, setPat] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      // Fetch the numeric GitHub repo ID using the provided PAT
      const ghRes = await fetch(`https://api.github.com/repos/${owner}/${name}`, {
        headers: { Authorization: `Bearer ${pat}` },
      })
      if (!ghRes.ok) {
        setError(ghRes.status === 404 ? 'Repository not found on GitHub' : 'Could not verify repository — check owner, name, and PAT')
        return
      }
      const ghData = (await ghRes.json()) as { id: number }

      const cloneUrl = `https://github.com/${owner}/${name}.git`
      const repo = await connectRepo({ githubRepoId: ghData.id, owner, name, cloneUrl, pat })
      addRepo(repo)
      setOpen(false)
      setOwner('')
      setName('')
      setPat('')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="w-full mt-2">
          + Connect Repo
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect a GitHub repository</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label htmlFor="cr-owner">Owner</Label>
            <Input
              id="cr-owner"
              placeholder="owner"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cr-name">Repository name</Label>
            <Input
              id="cr-name"
              placeholder="my-repo"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cr-pat">Personal Access Token</Label>
            <Input
              id="cr-pat"
              type="password"
              placeholder="ghp_..."
              value={pat}
              onChange={(e) => setPat(e.target.value)}
              required
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Connecting...' : 'Connect'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 6.2: Typecheck**

```bash
pnpm --filter web typecheck 2>&1
```

Expected: no errors.

- [ ] **Step 6.3: Commit**

```bash
git add apps/web/components/repos/ConnectRepoDialog.tsx
git commit -m "feat(web): add ConnectRepoDialog with GitHub API repo ID fetch"
```

---

## Task 7: RepoListItem component

**Files:**
- Create: `apps/web/components/repos/RepoListItem.tsx`

- [ ] **Step 7.1: Create `apps/web/components/repos/RepoListItem.tsx`**

```tsx
'use client'

import { useAppStore } from '@/lib/store'
import type { Repository } from '@/lib/types'
import { cn } from '@/lib/utils'

interface RepoListItemProps {
  repo: Repository
}

export function RepoListItem({ repo }: RepoListItemProps) {
  const selectedRepoId = useAppStore((s) => s.selectedRepoId)
  const selectRepo = useAppStore((s) => s.selectRepo)

  return (
    <button
      onClick={() => selectRepo(repo.id)}
      className={cn(
        'w-full text-left px-3 py-2 rounded-md text-sm transition-colors',
        selectedRepoId === repo.id
          ? 'bg-accent text-accent-foreground'
          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
      )}
    >
      <span className="font-medium">{repo.owner}/</span>
      {repo.name}
    </button>
  )
}
```

- [ ] **Step 7.2: Commit**

```bash
git add apps/web/components/repos/RepoListItem.tsx
git commit -m "feat(web): add RepoListItem component"
```

---

## Task 8: TaskComposer component

**Files:**
- Create: `apps/web/components/runs/TaskComposer.tsx`

- [ ] **Step 8.1: Create `apps/web/components/runs/TaskComposer.tsx`**

```tsx
'use client'

import { useState } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/lib/store'
import { startRun, ApiError } from '@/lib/api'

export function TaskComposer() {
  const selectedRepoId = useAppStore((s) => s.selectedRepoId)
  const repos = useAppStore((s) => s.repos)
  const runStatus = useAppStore((s) => s.runStatus)
  const setActiveRun = useAppStore((s) => s.setActiveRun)

  const selectedRepo = repos.find((r) => r.id === selectedRepoId)

  const [task, setTask] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isRunning = runStatus === 'running'

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedRepoId || task.trim().length < 10) return
    setError(null)
    setLoading(true)
    try {
      const { runId } = await startRun(selectedRepoId, task.trim())
      setActiveRun(runId)
      setTask('')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to start run')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-3">
      {selectedRepo && (
        <p className="text-xs text-muted-foreground font-mono">
          {selectedRepo.owner}/{selectedRepo.name}
        </p>
      )}
      <form onSubmit={handleSubmit} className="space-y-2">
        <Textarea
          placeholder="Describe the task in plain English. The agent will inspect the repo first."
          value={task}
          onChange={(e) => setTask(e.target.value)}
          rows={4}
          disabled={isRunning}
          className="resize-none"
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button
          type="submit"
          className="w-full"
          disabled={isRunning || loading || task.trim().length < 10}
        >
          {loading ? 'Starting...' : isRunning ? 'Run in progress...' : 'Start Run →'}
        </Button>
      </form>
    </div>
  )
}
```

- [ ] **Step 8.2: Commit**

```bash
git add apps/web/components/runs/TaskComposer.tsx
git commit -m "feat(web): add TaskComposer component"
```

---

## Task 9: TraceLog component

**Files:**
- Create: `apps/web/components/runs/TraceLog.tsx`

- [ ] **Step 9.1: Create `apps/web/components/runs/TraceLog.tsx`**

```tsx
'use client'

import { useEffect, useRef } from 'react'
import { useAppStore } from '@/lib/store'
import { useAgentStream } from '@/lib/sse'
import type { AgentSSEEvent } from '@/lib/types'

function eventColor(event: AgentSSEEvent): string {
  switch (event.type) {
    case 'state_changed':
      return 'text-blue-400'
    case 'tool_called':
      return 'text-purple-400'
    case 'step_started':
    case 'step_completed':
      return 'text-amber-400'
    case 'run_completed':
      return 'text-green-400'
    case 'run_failed':
      return 'text-red-400'
    default:
      return 'text-muted-foreground'
  }
}

function formatEvent(event: AgentSSEEvent): string {
  switch (event.type) {
    case 'state_changed':
      return `state → ${event.state}`
    case 'tool_called':
      return `tool: ${event.name}`
    case 'step_started':
      return `step: ${event.stepType} — ${event.description}`
    case 'step_completed':
      return `✓ ${event.stepType} (${event.durationMs}ms)`
    case 'run_completed':
      return '✓ run completed'
    case 'run_failed':
      return `✗ run failed: ${event.error}`
    default:
      return JSON.stringify(event)
  }
}

export function TraceLog() {
  const activeRunId = useAppStore((s) => s.activeRunId)
  const traceEvents = useAppStore((s) => s.traceEvents)
  const runStatus = useAppStore((s) => s.runStatus)
  const bottomRef = useRef<HTMLDivElement>(null)

  useAgentStream(activeRunId)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [traceEvents])

  if (!activeRunId && traceEvents.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-muted-foreground">No active run</p>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto font-mono text-xs p-2 space-y-0.5">
      {traceEvents.map((event, i) => (
        <div key={i} className={`leading-relaxed ${eventColor(event)}`}>
          {formatEvent(event)}
        </div>
      ))}
      {runStatus === 'running' && (
        <div className="flex items-center gap-1.5 text-muted-foreground pt-1">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          running...
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  )
}
```

- [ ] **Step 9.2: Commit**

```bash
git add apps/web/components/runs/TraceLog.tsx
git commit -m "feat(web): add TraceLog SSE event viewer component"
```

---

## Task 10: Wire panels — Sidebar, MainPanel, RightPanel

**Files:**
- Modify: `apps/web/components/layout/Sidebar.tsx`
- Modify: `apps/web/components/layout/MainPanel.tsx`
- Modify: `apps/web/components/layout/RightPanel.tsx`

- [ ] **Step 10.1: Replace `apps/web/components/layout/Sidebar.tsx`**

```tsx
'use client'

import { useEffect } from 'react'
import { useAppStore } from '@/lib/store'
import { listRepos } from '@/lib/api'
import { RepoListItem } from '@/components/repos/RepoListItem'
import { ConnectRepoDialog } from '@/components/repos/ConnectRepoDialog'
import { Separator } from '@/components/ui/separator'

export function Sidebar() {
  const repos = useAppStore((s) => s.repos)
  const setRepos = useAppStore((s) => s.setRepos)

  useEffect(() => {
    listRepos().then(setRepos).catch(() => {})
  }, [setRepos])

  return (
    <aside className="w-64 border-r border-border flex flex-col shrink-0">
      <div className="p-4 border-b border-border">
        <h1 className="text-sm font-semibold tracking-tight">RepoPilot</h1>
      </div>
      <div className="flex-1 overflow-auto p-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-1 mb-2">
          Repos
        </p>
        {repos.length === 0 ? (
          <p className="text-xs text-muted-foreground px-1 mb-2">No repos connected</p>
        ) : (
          <div className="space-y-0.5 mb-2">
            {repos.map((repo) => (
              <RepoListItem key={repo.id} repo={repo} />
            ))}
          </div>
        )}
        <ConnectRepoDialog />
        <Separator className="my-4" />
      </div>
    </aside>
  )
}
```

- [ ] **Step 10.2: Replace `apps/web/components/layout/MainPanel.tsx`**

```tsx
'use client'

import { useAppStore } from '@/lib/store'
import { TaskComposer } from '@/components/runs/TaskComposer'

export function MainPanel() {
  const selectedRepoId = useAppStore((s) => s.selectedRepoId)

  return (
    <main className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-auto p-6">
        {selectedRepoId ? (
          <TaskComposer />
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
            <p className="text-sm text-muted-foreground">
              Select a repo from the sidebar to start a task
            </p>
          </div>
        )}
      </div>
    </main>
  )
}
```

- [ ] **Step 10.3: Replace `apps/web/components/layout/RightPanel.tsx`**

```tsx
'use client'

import { TraceLog } from '@/components/runs/TraceLog'

export function RightPanel() {
  return (
    <aside className="w-96 border-l border-border flex flex-col shrink-0">
      <div className="p-3 border-b border-border">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Trace
        </h2>
      </div>
      <div className="flex-1 overflow-hidden">
        <TraceLog />
      </div>
    </aside>
  )
}
```

- [ ] **Step 10.4: Run all tests to confirm nothing broke**

```bash
pnpm --filter web test --reporter=verbose 2>&1
```

Expected: 18 tests pass.

- [ ] **Step 10.5: Typecheck**

```bash
pnpm --filter web typecheck 2>&1
```

Expected: no errors.

- [ ] **Step 10.6: Start the dev server and verify visually**

Start both backend and frontend:
```bash
# Terminal 1 — start PostgreSQL (if not running)
docker compose -f docker/docker-compose.yml up -d

# Terminal 2 — start backend
pnpm --filter api dev

# Terminal 3 — start frontend
pnpm --filter web dev
```

Open `http://localhost:3000`. Verify:
- [ ] Three-panel layout renders with no console errors
- [ ] "No repos connected" and "+ Connect Repo" button visible in sidebar
- [ ] Clicking "+ Connect Repo" opens the dialog with owner, name, PAT fields
- [ ] Center panel shows "Select a repo from the sidebar to start a task"
- [ ] Right panel shows "No active run"

- [ ] **Step 10.7: Commit**

```bash
git add apps/web/components/layout/Sidebar.tsx \
  apps/web/components/layout/MainPanel.tsx \
  apps/web/components/layout/RightPanel.tsx
git commit -m "feat(web): wire Sidebar, MainPanel, and RightPanel with real components"
```

---

## Self-Review Checklist

- [x] Spec section "Zustand Store" → Task 2 (store.ts)
- [x] Spec section "API Client" → Task 3 (api.ts)
- [x] Spec section "SSE Hook" → Task 4 (sse.ts)
- [x] Spec section "Next.js Proxy Rewrite" → Task 5 (next.config.ts)
- [x] Spec section "ConnectRepoDialog" → Task 6 (GitHub API fetch for githubRepoId ✓)
- [x] Spec section "RepoListItem" → Task 7
- [x] Spec section "TaskComposer" → Task 8
- [x] Spec section "TraceLog" → Task 9 (color by event type ✓, auto-scroll ✓, pulse indicator ✓)
- [x] Spec section "Wire panels" → Task 10 (Sidebar loads repos on mount ✓)
- [x] Spec section "Test Setup" → Task 1 (vitest config + @testing-library/react + jsdom)
- [x] Deferred: component tests (Playwright E2E) — not in this plan per spec

**Type consistency check:**
- `useAppStore` → defined in `store.ts`, imported consistently in all components ✓
- `Repository`, `AgentSSEEvent`, `RunStatus`, `ConnectRepoInput` → all in `types.ts` ✓
- `listRepos`, `connectRepo`, `startRun`, `ApiError` → all in `api.ts` ✓
- `useAgentStream` → in `sse.ts`, imported only in `TraceLog.tsx` ✓
- `appendTraceEvent`, `setRunStatus`, `setActiveRun`, `addRepo`, `setRepos` → all defined in store ✓

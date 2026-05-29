# PR C2 — Phase 1 Frontend: Repo Connect + Task Composer + SSE Trace

**Date:** 2026-05-29
**Branch:** `feat/phase-1-pr-c2-frontend`
**Depends on:** PR #11 (phase-1-pr-c1-backend merged to main)

---

## Goal

Build the minimal frontend that makes the backend agent loop usable from a browser:
connect a GitHub repo via PAT, compose a natural-language task, start a run, and watch the real-time agent trace in the right panel. No approval gates, no diff viewer — those are Phase 2.

**Acceptance criteria:** A user can open the app, connect a GitHub repo, type a task description, hit "Start Run", and see SSE trace events streaming in the right panel in real time.

---

## Decisions

| Question | Decision | Rationale |
|---|---|---|
| Navigation flow | Single-panel state machine (no routing) | Minimal for Phase 1; no page transitions needed |
| Connect repo UX | shadcn Dialog (modal) | Predictable pattern, doesn't deform the sidebar layout |
| Trace display | Monospace log style (A) | Best for debugging during development |
| State management | Zustand store | App will grow significantly; avoids future migration |

---

## Architecture

### Component tree

```
app/
  page.tsx                  ← mounts 3 panels, no logic
  layout.tsx                ← unchanged (ThemeProvider, flex shell)

components/
  layout/
    Sidebar.tsx             ← repo list + "Connect Repo" button → opens dialog
    MainPanel.tsx           ← empty state (no repo) or TaskComposer (repo selected)
    RightPanel.tsx          ← TraceLog (run active) or placeholder (no run)
  repos/
    ConnectRepoDialog.tsx   ← shadcn Dialog: form with owner, name, cloneUrl, PAT fields
    RepoListItem.tsx        ← clickable repo row in sidebar
  runs/
    TaskComposer.tsx        ← textarea + "Start Run" button
    TraceLog.tsx            ← scrollable monospace event list, auto-scrolls on new events

lib/
  api.ts                    ← typed fetch wrapper for all backend calls
  sse.ts                    ← useAgentStream hook (EventSource lifecycle)
  store.ts                  ← Zustand store (repos, selectedRepoId, activeRunId, traceEvents)
  types.ts                  ← shared frontend types (Repository, AgentSSEEvent, ApiError)
```

### Data flow

```
1. Mount       → listRepos() → store.setRepos([...])
2. Click repo  → store.selectRepo(id) → MainPanel shows TaskComposer, trace cleared
3. Submit task → startRun(repoId, description) → store.setActiveRun(runId)
4. useAgentStream activates → opens EventSource → each event → store.appendTraceEvent()
5. run_completed / run_failed → EventSource.close() → activeRunId stays for history
```

---

## Zustand Store

```typescript
interface Repository {
  id: string
  owner: string
  name: string
  cloneUrl: string
  cloneStatus: string
  createdAt: string
}

type AgentSSEEvent =
  | { type: 'state_changed'; state: string }
  | { type: 'step_started'; stepType: string; description: string }
  | { type: 'step_completed'; stepType: string; durationMs: number }
  | { type: 'tool_called'; name: string; input: unknown; output: string }
  | { type: 'run_completed'; planJson: unknown }
  | { type: 'run_failed'; error: string }

interface AppStore {
  // State
  repos: Repository[]
  selectedRepoId: string | null
  activeRunId: string | null
  traceEvents: AgentSSEEvent[]
  runStatus: 'idle' | 'running' | 'completed' | 'failed'
  // Actions
  setRepos: (repos: Repository[]) => void
  addRepo: (repo: Repository) => void
  selectRepo: (id: string | null) => void   // also clears activeRun + trace
  setActiveRun: (runId: string) => void
  appendTraceEvent: (event: AgentSSEEvent) => void
  clearTrace: () => void
  setRunStatus: (status: AppStore['runStatus']) => void
}
```

`appendTraceEvent` caps at 500 entries (drops oldest) to prevent memory growth on long runs.

---

## API Client (`lib/api.ts`)

```typescript
const BASE = '/api/v1'   // proxied by Next.js rewrites

export async function listRepos(): Promise<Repository[]>
export async function connectRepo(input: ConnectRepoInput): Promise<Repository>
export async function startRun(repositoryId: string, taskDescription: string): Promise<{ runId: string }>

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}
```

All functions throw `ApiError` on non-2xx. Errors are displayed inline in the component — no global toast system in Phase 1.

---

## SSE Hook (`lib/sse.ts`)

```typescript
export function useAgentStream(runId: string | null): void
```

- Skips if `runId` is null
- Opens `new EventSource(\`/api/v1/agent/runs/${runId}/stream\`)`
- On `message`: parses JSON, calls `appendTraceEvent(event)`, updates `runStatus`
- On `run_completed` or `run_failed`: closes EventSource, sets final `runStatus`
- On `error`: sets `runStatus` to `'failed'`
- `useEffect` cleanup: `evtSource.close()`

---

## Next.js Proxy Rewrite

Add to `apps/web/next.config.ts`:

```typescript
rewrites: async () => [
  { source: '/api/v1/:path*', destination: 'http://localhost:3001/api/v1/:path*' }
]
```

This eliminates CORS issues without any backend change. The env var `NEXT_PUBLIC_API_URL` is not needed in Phase 1 since everything proxies through Next.js.

---

## New shadcn Components to Install

```bash
pnpm dlx shadcn@latest add dialog textarea input label badge
```

---

## Component Details

### `ConnectRepoDialog`
- Trigger: "Connect Repo" button in Sidebar
- Fields: **owner** (string), **name** (string), **PAT** (password)
- `cloneUrl` is derived automatically: `https://github.com/{owner}/{name}.git`
- `githubRepoId` is fetched from `GET https://api.github.com/repos/{owner}/{name}` using the PAT before submitting — this avoids asking the user for a numeric GitHub ID
- On submit: fetch GitHub API → get `id` → call `connectRepo({ githubRepoId, owner, name, cloneUrl, pat })` → on success adds to store + closes dialog
- Error: shows inline below form (GitHub API error or backend 4xx)
- PAT field: `type="password"`, never stored in component state after submit

### `TaskComposer`
- Shows selected repo name as context header
- Textarea for task description (min 10 chars validation)
- "Start Run" button — disabled while a run is active
- On submit: calls `startRun()` → `setActiveRun(runId)` → clears textarea

### `TraceLog`
- Renders `traceEvents` as monospace rows
- Color by event type:
  - `state_changed` → blue (`text-blue-400`)
  - `tool_called` → purple (`text-purple-400`)
  - `step_started` / `step_completed` → amber (`text-amber-400`)
  - `run_completed` → green (`text-green-400`)
  - `run_failed` → red (`text-red-400`)
- Auto-scrolls to bottom on new event (via `useEffect` + `ref`)
- Shows a pulsing indicator while `runStatus === 'running'`

---

## Testing Strategy

**Store (`lib/store.test.ts`)** — pure state logic, highest coverage priority:
- `appendTraceEvent` adds event and caps at 500
- `clearTrace` resets events and runStatus
- `selectRepo` clears activeRun, traceEvents, and runStatus

**API client (`lib/api.test.ts`)** — mock global `fetch`:
- `connectRepo` sends correct body, returns Repository
- `startRun` returns runId on 201
- Both throw `ApiError` on 4xx

**SSE hook (`lib/sse.test.ts`)** — mock `EventSource`:
- Opens EventSource when runId is set
- Calls `appendTraceEvent` on each message
- Closes on `run_completed` and `run_failed`
- Does nothing when runId is null
- Cleans up on unmount

**Component tests** — deferred to Phase 5 (Playwright E2E when UI is stable).

---

## Test Setup

`apps/web` does not have a `vitest.config.ts` yet. Add one following the same pattern as `apps/api/vitest.config.ts` (no `globalSetup` needed — no DB — just basic Vitest + jsdom environment for the store and hook tests).

---

## Environment Variables

Add to `apps/web/.env.local.example`:
```
# No vars needed for Phase 1 — proxy rewrite handles backend URL
```

Add to `apps/web/next.config.ts`:
```typescript
// Proxy rewrite (no env var needed in browser)
```

---

## Deferred Items

These are intentionally out of scope for Phase 1 but must be revisited in later phases:

| Item | Target phase | Notes |
|---|---|---|
| Trace display: grouped by step (Option C) | Phase 2+ / product polish | Replace monospace log with step cards that collapse tool calls |
| Navigation: tabs per run (Option C) | Phase 3+ | Center panel becomes tabbed when multiple runs exist |
| Component tests (React Testing Library / Playwright) | Phase 5 | Wait for UI to stabilize before investing in component tests |
| Approval gates UI | Phase 2 | Backend will emit `waiting_for_plan_approval` etc. — frontend needs action buttons |
| Diff viewer in right panel | Phase 2 | Replace placeholder in RightPanel with `react-diff-viewer-continued` |
| Run history in sidebar | Phase 3 | List past runs per repo; currently sidebar only shows repos |
| Error toast system | Phase 3+ | Replace inline errors with a global notification system |
| PAT rotation / OAuth | Phase 5 | Replace PAT form with GitHub OAuth App flow |
| Real-time run status badge in sidebar | Phase 3 | Show running/completed/failed per run in the sidebar list |
| Auto-reconnect SSE after server restart | Phase 4+ | EventSource reconnect with exponential backoff |

---

## Security Notes

- PAT field uses `type="password"` — masked in UI
- PAT is never stored in component state after the API call completes
- API responses never return the encrypted token field (enforced by backend)
- Proxy rewrite keeps the backend port internal — no CORS headers needed on the API

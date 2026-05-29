# Phase 2 — File Edit Proposals & Diff Viewer: Design Spec

**Date:** 2026-05-29
**Status:** Approved

---

## Goal

Enable Claude to propose file edits that the user must explicitly approve or reject before anything is written to disk. Every destructive write is gated by a human decision.

---

## Architecture Overview

```
Claude calls propose_file_edit(path, content)
    ↓
MCP tool creates FileChange in DB (status: pending), returns { changeId, path, diff, status: "pending_approval" }
    ↓
AgentOrchestrator detects pending_approval → pauses tool loop
    ↓
SSE emits edit_proposed → frontend shows diff + tabs in center panel
    ↓
User approves / rejects each file
    ↓
PATCH /api/v1/agent/runs/:runId/file-changes/:changeId
    ↓
Orchestrator calls write_file(changeId) for each approved file
    ↓
Orchestrator resumes Claude loop → agent continues
```

**New pieces per layer:**

| Layer | What's added |
|-------|-------------|
| MCP server | `propose_file_edit`, `write_file` tools |
| Backend | Approval route, pause/resume logic in orchestrator |
| Frontend | `PlanApprovalCard`, `FileEditApproval` (tabs + diff), `DiffViewer` |
| Store | `planProposal`, `pendingEdits` |

The `AgentStateMachine` already defines `waiting_for_edit_approval` — this phase wires it up end-to-end.

---

## Backend

### MCP Tools (`packages/mcp-server/src/tools/`)

**`propose-file-edit.ts`**
- Input: `{ path: string, content: string }` — the proposed new content of the file
- Reads the current file content from `REPO_ROOT` to generate the diff
- Creates a `FileChange` record in DB with `status: "pending"`
- Returns: `{ changeId, path, diff, status: "pending_approval" }`
- Does NOT touch the filesystem — staging only
- Runs `validatePath()` before reading the current file

**`write-file.ts`**
- Input: `{ changeId: string }`
- Fetches `FileChange` from DB; verifies `status === "approved"` as the authoritative source
- Runs `validatePath()` on the stored path before writing
- Writes the stored content to disk
- Returns: `{ path, bytesWritten }`
- Fails closed if status is not `"approved"` — no in-memory bypass possible

### API Route (`apps/api/src/routes/agent-runs.ts`)

```
PATCH /api/v1/agent/runs/:runId/file-changes/:changeId
Body: { action: "approve" | "reject" }
```

- Verifies `changeId` belongs to `runId` — prevents cross-run approval
- Updates `FileChange.status` in DB
- Signals the orchestrator to check for pending approvals and resume if all resolved

### Plan Approval Route

```
POST /api/v1/agent/runs/:runId/approve-plan
Body: { action: "approve" | "reject" }
```

- Transitions `AgentStateMachine` from `waiting_for_plan_approval` to `editing` (approve) or `failed` (reject)
- Emits SSE `state_changed` event

### AgentOrchestrator / AgentRunner (`apps/api/src/services/`)

After every tool call result:
- Inspects the result for `status: "pending_approval"`
- If found: transitions state machine to `waiting_for_edit_approval`, emits SSE `edit_proposed` with `{ changeId, path, diff }`
- On approval of all pending edits: calls `write_file` for each approved `changeId`, emits SSE for each write, resumes Claude loop
- If all edits are rejected: injects a tool result message informing Claude, resumes loop

---

## Frontend

### Center Panel — Conditional Rendering

The center panel renders based on the active run state:

| Run state | Center panel shows |
|-----------|-------------------|
| `idle` / no active run | `TaskComposer` |
| `waiting_for_plan_approval` | `PlanApprovalCard` |
| `waiting_for_edit_approval` | `FileEditApproval` |
| `analyzing_repo` / `planning` / `editing` / `reviewing` | Empty / status indicator |

### New Components (`apps/web/components/runs/`)

**`PlanApprovalCard`**
- Displays plan steps as a numbered list
- Two buttons: "Approve Plan" (calls `approvePlan(runId)`) and "Reject" (calls `rejectPlan(runId)`)
- Shows a loading spinner while the API call is in-flight

**`FileEditApproval`**
- Takes over the full center panel when `pendingEdits.length > 0`
- Tabs at the top: one per proposed file, showing filename + status icon (pending / approved / rejected)
- Active tab shows the diff via `DiffViewer`
- Sticky bar at the bottom: "Approve" and "Reject" buttons for the currently active file
- Auto-advances to the next pending tab after each decision
- When all files are resolved, calls `onAllResolved()` — the orchestrator takes it from there

**`DiffViewer`**
- Wrapper over `react-diff-viewer-continued`
- Props: `{ oldContent: string, newContent: string, filename: string }`
- Unified view (not split) by default — easier to scan on narrow screens
- Handles empty files and shows a placeholder for binary files

### Store (`apps/web/lib/store.ts`)

New state:
```ts
planProposal: { steps: string[] } | null
pendingEdits: FileChange[]  // FileChange: { changeId, path, diff, status }
```

New actions:
- `setPlanProposal(proposal)` / `clearPlanProposal()`
- `addPendingEdit(edit: FileChange)`
- `resolveEdit(changeId, action: "approve" | "reject")`

### API Client (`apps/web/lib/api.ts`)

New functions:
- `approvePlan(runId: string): Promise<void>`
- `rejectPlan(runId: string): Promise<void>`
- `resolveEdit(runId: string, changeId: string, action: "approve" | "reject"): Promise<void>`

### SSE Hook (`apps/web/lib/sse.ts`)

New event handlers:
- `edit_proposed` → `store.addPendingEdit(event.payload)`
- `approval_required` (plan) → `store.setPlanProposal(event.payload)`
- `state_changed` → `store.setRunStatus(event.state)` (already handled, no change)

---

## Security Invariants

1. **`write_file` validates DB status** — the approval check is in the database, not in-memory state. Calling the MCP tool directly without a DB-approved `changeId` fails closed.
2. **Path validation on every operation** — `validatePath()` runs in both `propose_file_edit` (read) and `write_file` (write). No `../` traversal, no absolute paths outside `REPO_ROOT`.
3. **Cross-run protection** — `PATCH /file-changes/:changeId` verifies the `changeId` belongs to the `runId` in the URL. You cannot approve edits from another run.
4. **Diff computed server-side** — the frontend receives and displays the diff; it never computes or sends file content.

---

## Testing

### MCP Server
- `propose-file-edit.test.ts`: creates FileChange in DB, returns correct diff, does not write to filesystem, rejects path traversal
- `write-file.test.ts`: writes only if approved, fails with `pending`/`rejected` status, fails on path traversal, fails if changeId not found

### Backend
- `agent-runs.test.ts`: adds tests for approval endpoint (approve, reject, cross-run guard, invalid changeId)
- Orchestrator integration: pause on `pending_approval`, resume after all resolved, handle all-rejected path

### Frontend
- `store.test.ts`: adds `addPendingEdit`, `resolveEdit`, `setPlanProposal` cases
- `api.test.ts`: adds `approvePlan`, `rejectPlan`, `resolveEdit` cases
- `FileEditApproval.test.tsx`: tabs render correctly, approve/reject call API, auto-advance to next pending tab, `onAllResolved` fires when complete
- `DiffViewer.test.tsx`: renders without crashing on empty files and binary file placeholders
- `PlanApprovalCard.test.tsx`: approve/reject buttons call correct API, loading state shown

---

## Acceptance Criteria

- Connect AlgoArena repo. Submit a coding task. Agent analyzes repo and produces a plan → `PlanApprovalCard` appears in center. User approves.
- Agent proposes edits to multiple files → `FileEditApproval` appears with one tab per file. User approves file A, rejects file B.
- Only file A is written to disk. File B is untouched.
- `write_file` called with an unapproved `changeId` returns an error.
- TraceLog in the right panel continues to show all tool calls throughout.

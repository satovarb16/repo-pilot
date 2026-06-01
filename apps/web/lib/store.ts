import { create } from 'zustand'
import type { AgentSSEEvent, FileChange, PlanProposal, Repository, RunStatus, TestRunView } from './types'

export type TracedEvent = AgentSSEEvent & { _key: number }

interface AppStore {
  repos: Repository[]
  selectedRepoId: string | null
  activeRunId: string | null
  traceEvents: TracedEvent[]
  runStatus: RunStatus
  planProposal: PlanProposal | null
  pendingEdits: FileChange[]
  // Phase 3: test runner state
  testRuns: TestRunView[]
  repairAttempt: number
  testApprovalCommand: string | null
  // Phase 4: PR state
  prApproval: { prTitle: string; prBody: string } | null
  prUrl: string | null
  prNumber: number | null
  setRepos: (repos: Repository[]) => void
  addRepo: (repo: Repository) => void
  selectRepo: (id: string | null) => void
  setActiveRun: (runId: string) => void
  appendTraceEvent: (event: AgentSSEEvent) => void
  clearTrace: () => void
  setRunStatus: (status: RunStatus) => void
  setPlanProposal: (proposal: PlanProposal) => void
  clearPlanProposal: () => void
  addPendingEdit: (edit: Omit<FileChange, 'status'>) => void
  resolveEdit: (changeId: string, status: 'approved' | 'rejected') => void
  clearPendingEdits: () => void
  // Phase 3 actions
  appendTestRun: (run: TestRunView) => void
  updateTestRun: (id: string, update: Partial<TestRunView>) => void
  setRepairAttempt: (attempt: number) => void
  setTestApproval: (command: string) => void
  clearTestApproval: () => void
  // Phase 4 actions
  setPRApproval: (approval: { prTitle: string; prBody: string }) => void
  clearPRApproval: () => void
  setPROpened: (data: { prUrl: string; prNumber: number }) => void
}

let _traceSeq = 0

export const useAppStore = create<AppStore>()((set) => ({
  repos: [],
  selectedRepoId: null,
  activeRunId: null,
  traceEvents: [],
  runStatus: 'idle',
  planProposal: null,
  pendingEdits: [],
  testRuns: [],
  repairAttempt: 0,
  testApprovalCommand: null,
  prApproval: null,
  prUrl: null,
  prNumber: null,

  setRepos: (repos) => set({ repos }),

  addRepo: (repo) =>
    set((state) => ({
      repos: state.repos.some((r) => r.id === repo.id)
        ? state.repos
        : [...state.repos, repo],
    })),

  selectRepo: (id) =>
    set({ selectedRepoId: id, activeRunId: null, traceEvents: [], runStatus: 'idle', planProposal: null, pendingEdits: [], prApproval: null, prUrl: null, prNumber: null }),

  setActiveRun: (runId) => set({ activeRunId: runId, runStatus: 'running', prApproval: null, prUrl: null, prNumber: null }),

  // Cap at 500 entries — drop the oldest when the buffer is full
  appendTraceEvent: (event) =>
    set((state) => {
      const traced: TracedEvent = { ...event, _key: ++_traceSeq }
      return {
        traceEvents:
          state.traceEvents.length >= 500
            ? [...state.traceEvents.slice(1), traced]
            : [...state.traceEvents, traced],
      }
    }),

  clearTrace: () => set({ traceEvents: [], activeRunId: null, runStatus: 'idle' }),

  setRunStatus: (status) => set({ runStatus: status }),

  setPlanProposal: (proposal) => set({ planProposal: proposal }),

  clearPlanProposal: () => set({ planProposal: null }),

  addPendingEdit: (edit) =>
    set((state) => ({
      pendingEdits: [...state.pendingEdits, { ...edit, status: 'pending' }],
    })),

  resolveEdit: (changeId, status) =>
    set((state) => ({
      pendingEdits: state.pendingEdits.map((e) =>
        e.changeId === changeId ? { ...e, status } : e,
      ),
    })),

  clearPendingEdits: () => set({ pendingEdits: [] }),

  appendTestRun: (run) =>
    set((state) => ({ testRuns: [...state.testRuns, run] })),

  updateTestRun: (id, update) =>
    set((state) => {
      // Primary lookup by id; fall back to the in-flight row when the id was
      // stored as a pending sentinel and the real DB UUID arrives on completion.
      const target = state.testRuns.find((r) => r.id === id) ?? state.testRuns.find((r) => r.status === 'running')
      if (!target) return state
      return {
        testRuns: state.testRuns.map((r) => (r === target ? { ...r, ...update } : r)),
      }
    }),

  setRepairAttempt: (attempt) => set({ repairAttempt: attempt }),

  setTestApproval: (command) => set({ testApprovalCommand: command }),

  clearTestApproval: () => set({ testApprovalCommand: null }),

  // Phase 4: PR state actions
  setPRApproval: (approval) => set({ prApproval: approval }),

  clearPRApproval: () => set({ prApproval: null }),

  setPROpened: ({ prUrl, prNumber }) => set({ prUrl, prNumber, prApproval: null }),
}))

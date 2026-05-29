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

  // Cap at 500 entries — drop the oldest when the buffer is full
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

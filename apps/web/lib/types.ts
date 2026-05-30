export interface Repository {
  id: string
  owner: string
  name: string
  cloneUrl: string
  cloneStatus: string
  createdAt: string
}

export interface FileChange {
  changeId: string
  filePath: string
  diff: string
  originalContent: string
  proposedContent: string
  status: 'pending' | 'approved' | 'rejected'
}

export interface PlanProposal {
  planText: string
}

// AgentSSEEvent is the single authoritative definition from the shared package.
// Do NOT redefine it here — import only.
export type { AgentSSEEvent } from '@repo-pilot/shared'

export type RunStatus = 'idle' | 'running' | 'completed' | 'failed'

export interface ConnectRepoInput {
  githubRepoId: number
  owner: string
  name: string
  cloneUrl: string
  pat: string
}

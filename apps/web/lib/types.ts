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

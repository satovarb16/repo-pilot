import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MainPanel } from './MainPanel'

const mockStore = vi.fn()
vi.mock('@/lib/store', () => ({
  useAppStore: (sel: (s: Record<string, unknown>) => unknown) => sel(mockStore()),
}))
vi.mock('@/components/runs/TaskComposer', () => ({ TaskComposer: () => <div>TaskComposer</div> }))
vi.mock('@/components/runs/PlanApprovalCard', () => ({ PlanApprovalCard: () => <div>PlanApprovalCard</div> }))
vi.mock('@/components/runs/FileEditApproval', () => ({ FileEditApproval: () => <div>FileEditApproval</div> }))

describe('MainPanel', () => {
  it('shows TaskComposer when selectedRepoId is set and no plan or edits pending', () => {
    mockStore.mockReturnValue({
      selectedRepoId: 'repo-1',
      activeRunId: null,
      planProposal: null,
      pendingEdits: [],
      runStatus: 'idle',
    })
    render(<MainPanel />)
    expect(screen.getByText('TaskComposer')).toBeInTheDocument()
  })

  it('shows PlanApprovalCard when planProposal is set', () => {
    mockStore.mockReturnValue({
      selectedRepoId: 'repo-1',
      activeRunId: 'run-1',
      planProposal: { planText: 'Step 1: do it' },
      pendingEdits: [],
      runStatus: 'running',
    })
    render(<MainPanel />)
    expect(screen.getByText('PlanApprovalCard')).toBeInTheDocument()
  })

  it('shows FileEditApproval when pendingEdits has items', () => {
    mockStore.mockReturnValue({
      selectedRepoId: 'repo-1',
      activeRunId: 'run-1',
      planProposal: null,
      pendingEdits: [{ changeId: 'c1', filePath: 'src/foo.ts', diff: '', status: 'pending' }],
      runStatus: 'running',
    })
    render(<MainPanel />)
    expect(screen.getByText('FileEditApproval')).toBeInTheDocument()
  })

  it('shows select-repo prompt when no repo selected', () => {
    mockStore.mockReturnValue({
      selectedRepoId: null,
      activeRunId: null,
      planProposal: null,
      pendingEdits: [],
      runStatus: 'idle',
    })
    render(<MainPanel />)
    expect(screen.getByText(/select a repo/i)).toBeInTheDocument()
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MainPanel } from './MainPanel'

const mockStore = vi.fn()
vi.mock('@/lib/store', () => ({
  useAppStore: (sel: (s: Record<string, unknown>) => unknown) => sel(mockStore()),
}))
vi.mock('@/components/runs/TaskComposer', () => ({ TaskComposer: () => <div>TaskComposer</div> }))
vi.mock('@/components/runs/PlanApprovalCard', () => ({ PlanApprovalCard: () => <div>PlanApprovalCard</div> }))
vi.mock('@/components/runs/FileEditApproval', () => ({ FileEditApproval: () => <div>FileEditApproval</div> }))
vi.mock('@/components/runs/TestApprovalCard', () => ({ TestApprovalCard: () => <div>TestApprovalCard</div> }))
vi.mock('@/components/runs/TestOutputPanel', () => ({ TestOutputPanel: () => <div>TestOutputPanel</div> }))
vi.mock('@/lib/api', () => ({
  approveTestRun: vi.fn().mockResolvedValue(undefined),
  rejectTestRun: vi.fn().mockResolvedValue(undefined),
  fetchTestResults: vi.fn().mockResolvedValue([]),
}))

const baseStore = {
  selectedRepoId: null,
  activeRunId: null,
  planProposal: null,
  pendingEdits: [],
  runStatus: 'idle',
  testApprovalCommand: null,
  testRuns: [],
  repairAttempt: 0,
  traceEvents: [],
  clearTestApproval: vi.fn(),
}

describe('MainPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStore.mockReturnValue(baseStore)
  })

  it('shows select-repo prompt when no repo selected', () => {
    render(<MainPanel />)
    expect(screen.getByText(/select a repo/i)).toBeInTheDocument()
  })

  it('shows TaskComposer when selectedRepoId is set and no plan or edits pending', () => {
    mockStore.mockReturnValue({
      ...baseStore,
      selectedRepoId: 'repo-1',
      activeRunId: null,
    })
    render(<MainPanel />)
    expect(screen.getByText('TaskComposer')).toBeInTheDocument()
  })

  it('shows PlanApprovalCard when planProposal is set', () => {
    mockStore.mockReturnValue({
      ...baseStore,
      selectedRepoId: 'repo-1',
      activeRunId: 'run-1',
      planProposal: { planText: 'Step 1: do it' },
      runStatus: 'running',
    })
    render(<MainPanel />)
    expect(screen.getByText('PlanApprovalCard')).toBeInTheDocument()
  })

  it('shows FileEditApproval when pendingEdits has items', () => {
    mockStore.mockReturnValue({
      ...baseStore,
      selectedRepoId: 'repo-1',
      activeRunId: 'run-1',
      pendingEdits: [{ changeId: 'c1', filePath: 'src/foo.ts', diff: '', status: 'pending' }],
      runStatus: 'running',
    })
    render(<MainPanel />)
    expect(screen.getByText('FileEditApproval')).toBeInTheDocument()
  })

  it('shows TestApprovalCard when testApprovalCommand is set', () => {
    mockStore.mockReturnValue({
      ...baseStore,
      selectedRepoId: 'repo-1',
      activeRunId: 'run-1',
      testApprovalCommand: 'npm test',
      runStatus: 'running',
    })
    render(<MainPanel />)
    expect(screen.getByText('TestApprovalCard')).toBeInTheDocument()
  })

  it('shows TestOutputPanel when in running_tests state', () => {
    mockStore.mockReturnValue({
      ...baseStore,
      selectedRepoId: 'repo-1',
      activeRunId: 'run-1',
      traceEvents: [{ type: 'state_changed', state: 'running_tests', _key: 1 }],
      runStatus: 'running',
    })
    render(<MainPanel />)
    expect(screen.getByText('TestOutputPanel')).toBeInTheDocument()
  })
})

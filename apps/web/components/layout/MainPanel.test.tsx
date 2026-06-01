import React from 'react'
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
vi.mock('@/components/runs/PRApprovalCard', () => ({ PRApprovalCard: () => <div>PRApprovalCard</div> }))
vi.mock('@/components/EmptyState', () => ({ EmptyState: ({ title, hint }: { title: string; hint?: string }) => <div data-testid="empty-state">{title}{hint && ` — ${hint}`}</div> }))
vi.mock('@/components/ErrorBoundary', () => ({ ErrorBoundary: ({ children }: { children: React.ReactNode }) => <div data-testid="error-boundary">{children}</div> }))
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
  prApproval: null,
  prUrl: null,
  prNumber: null,
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

  it('uses EmptyState component for the no-repo-selected state', () => {
    render(<MainPanel />)
    expect(screen.getByTestId('empty-state')).toBeInTheDocument()
  })

  it('wraps the panel content in an ErrorBoundary', () => {
    render(<MainPanel />)
    expect(screen.getByTestId('error-boundary')).toBeInTheDocument()
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

  it('shows PRApprovalCard when prApproval is set and activeRunId is set', () => {
    mockStore.mockReturnValue({
      ...baseStore,
      selectedRepoId: 'repo-1',
      activeRunId: 'run-1',
      prApproval: { prTitle: 'feat: x', prBody: 'body' },
    })
    render(<MainPanel />)
    expect(screen.getByText('PRApprovalCard')).toBeInTheDocument()
  })

  it('does not show PRApprovalCard when prApproval is set but activeRunId is null', () => {
    mockStore.mockReturnValue({
      ...baseStore,
      selectedRepoId: 'repo-1',
      activeRunId: null,
      prApproval: { prTitle: 'feat: x', prBody: 'body' },
    })
    render(<MainPanel />)
    expect(screen.queryByText('PRApprovalCard')).not.toBeInTheDocument()
  })

  it('shows PR link when prUrl and prNumber are set', () => {
    mockStore.mockReturnValue({
      ...baseStore,
      selectedRepoId: 'repo-1',
      activeRunId: 'run-1',
      prUrl: 'https://github.com/owner/repo/pull/7',
      prNumber: 7,
      runStatus: 'completed',
    })
    render(<MainPanel />)
    expect(screen.getByText(/PR #7/)).toBeInTheDocument()
    const link = screen.getByRole('link')
    expect(link.getAttribute('href')).toBe('https://github.com/owner/repo/pull/7')
  })

  it('does not show PRApprovalCard when prUrl is set (already approved)', () => {
    mockStore.mockReturnValue({
      ...baseStore,
      selectedRepoId: 'repo-1',
      activeRunId: 'run-1',
      prUrl: 'https://github.com/owner/repo/pull/7',
      prNumber: 7,
      prApproval: null,
    })
    render(<MainPanel />)
    expect(screen.queryByText('PRApprovalCard')).not.toBeInTheDocument()
  })

  it('shows run-cancelled indicator when runStatus is cancelled', () => {
    mockStore.mockReturnValue({
      ...baseStore,
      selectedRepoId: 'repo-1',
      activeRunId: 'run-1',
      runStatus: 'cancelled',
    })
    render(<MainPanel />)
    expect(screen.getByText(/run cancelled/i)).toBeInTheDocument()
  })
})

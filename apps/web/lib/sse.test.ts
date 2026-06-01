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
    expect(MockEventSource.instances[0].url).toBe('http://localhost:3001/api/v1/agent/runs/run-123/stream')
  })

  it('appends parsed trace event to store on message', () => {
    renderHook(() => useAgentStream('run-123'))
    MockEventSource.instances[0].emit(
      JSON.stringify({ type: 'state_changed', state: 'analyzing_repo' }),
    )
    expect(useAppStore.getState().traceEvents).toHaveLength(1)
    expect(useAppStore.getState().traceEvents[0]).toMatchObject({
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

  it('dispatches approval_required event to setPlanProposal', () => {
    renderHook(() => useAgentStream('run-123'))
    const es = MockEventSource.instances[0]
    es.emit(JSON.stringify({ type: 'approval_required', approvalType: 'plan', planText: 'Step 1\nStep 2' }))
    expect(useAppStore.getState().planProposal).toEqual({ planText: 'Step 1\nStep 2' })
  })

  it('dispatches edit_proposed event to addPendingEdit', () => {
    renderHook(() => useAgentStream('run-123'))
    const es = MockEventSource.instances[0]
    es.emit(JSON.stringify({ type: 'edit_proposed', changeId: 'c1', filePath: 'src/foo.ts', diff: '--- a\n+++ b' }))
    expect(useAppStore.getState().pendingEdits).toHaveLength(1)
    expect(useAppStore.getState().pendingEdits[0]).toMatchObject({
      changeId: 'c1',
      filePath: 'src/foo.ts',
      diff: '--- a\n+++ b',
    })
  })

  it('dispatches test_run_started to appendTestRun with running status', () => {
    renderHook(() => useAgentStream('run-123'))
    const es = MockEventSource.instances[0]
    es.emit(JSON.stringify({ type: 'test_run_started', command: 'npm test' }))
    const { testRuns } = useAppStore.getState()
    expect(testRuns).toHaveLength(1)
    expect(testRuns[0].status).toBe('running')
    expect(testRuns[0].command).toBe('npm test')
  })

  it('dispatches test_run_completed to updateTestRun using status-based fallback', () => {
    renderHook(() => useAgentStream('run-123'))
    const es = MockEventSource.instances[0]
    // Start a run — the row is stored with the sentinel id 'running', not the real DB id.
    es.emit(JSON.stringify({ type: 'test_run_started', command: 'npm test' }))
    expect(useAppStore.getState().testRuns[0].id).toBe('running')

    // Completion arrives with the real DB CUID — it will NOT match 'running',
    // so updateTestRun must fall back to finding the row by status === 'running'.
    const realDbId = 'clxxx1234567890'
    es.emit(
      JSON.stringify({
        type: 'test_run_completed',
        testRunId: realDbId,
        status: 'passed',
        exitCode: 0,
        durationMs: 500,
        sandboxed: true,
        stdout: 'ok',
        stderr: '',
      }),
    )
    const { testRuns } = useAppStore.getState()
    expect(testRuns[0].status).toBe('passed')
    expect(testRuns[0].exitCode).toBe(0)
    expect(testRuns[0].stdout).toBe('ok')
    // Confirm the row now carries the real DB id
    expect(testRuns[0].id).toBe(realDbId)
  })

  it('dispatches repair_started to setRepairAttempt', () => {
    renderHook(() => useAgentStream('run-123'))
    const es = MockEventSource.instances[0]
    es.emit(JSON.stringify({ type: 'repair_started', attempt: 1, maxAttempts: 2 }))
    expect(useAppStore.getState().repairAttempt).toBe(1)
  })

  it('dispatches approval_required {approvalType:test_run} to setTestApproval', () => {
    renderHook(() => useAgentStream('run-123'))
    const es = MockEventSource.instances[0]
    es.emit(JSON.stringify({ type: 'approval_required', approvalType: 'test_run', command: 'npm test' }))
    expect(useAppStore.getState().testApprovalCommand).toBe('npm test')
  })

  it('dispatches approval_required {approvalType:pr} to setPRApproval', () => {
    renderHook(() => useAgentStream('run-123'))
    const es = MockEventSource.instances[0]
    es.emit(JSON.stringify({ type: 'approval_required', approvalType: 'pr', prTitle: 'feat: x', prBody: 'body text' }))
    expect(useAppStore.getState().prApproval).toEqual({ prTitle: 'feat: x', prBody: 'body text' })
  })

  it('dispatches pr_opened to setPROpened and clears prApproval', () => {
    useAppStore.setState({ prApproval: { prTitle: 'feat: x', prBody: 'body' } })
    renderHook(() => useAgentStream('run-123'))
    const es = MockEventSource.instances[0]
    es.emit(JSON.stringify({ type: 'pr_opened', prUrl: 'https://github.com/owner/repo/pull/7', prNumber: 7 }))
    expect(useAppStore.getState().prUrl).toBe('https://github.com/owner/repo/pull/7')
    expect(useAppStore.getState().prNumber).toBe(7)
    expect(useAppStore.getState().prApproval).toBeNull()
  })

  it('dispatches run_cancelled to clearPRApproval and sets runStatus cancelled', () => {
    useAppStore.setState({ prApproval: { prTitle: 'feat: x', prBody: 'body' } })
    renderHook(() => useAgentStream('run-123'))
    const es = MockEventSource.instances[0]
    es.emit(JSON.stringify({ type: 'run_cancelled' }))
    expect(useAppStore.getState().prApproval).toBeNull()
    expect(useAppStore.getState().runStatus).toBe('cancelled')
  })

  it('run_cancelled closes the EventSource', () => {
    renderHook(() => useAgentStream('run-123'))
    const es = MockEventSource.instances[0]
    es.emit(JSON.stringify({ type: 'run_cancelled' }))
    expect(es.closed).toBe(true)
  })

  it('onerror clears prApproval before setting runStatus failed', () => {
    useAppStore.setState({ prApproval: { prTitle: 'feat: x', prBody: 'body' } })
    renderHook(() => useAgentStream('run-123'))
    const es = MockEventSource.instances[0]
    es.onerror?.(new Event('error'))
    expect(useAppStore.getState().prApproval).toBeNull()
    expect(useAppStore.getState().runStatus).toBe('failed')
  })
})

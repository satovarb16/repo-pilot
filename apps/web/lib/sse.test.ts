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
    expect(MockEventSource.instances[0].url).toBe('/api/v1/agent/runs/run-123/stream')
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
})

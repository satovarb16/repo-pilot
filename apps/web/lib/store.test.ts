import { beforeEach, describe, expect, it } from 'vitest'
import { useAppStore } from './store'
import type { AgentSSEEvent, Repository } from './types'
import type { TracedEvent } from './store'

const testRepo: Repository = {
  id: 'repo-1',
  owner: 'test-owner',
  name: 'test-repo',
  cloneUrl: 'https://github.com/test-owner/test-repo.git',
  cloneStatus: 'pending',
  createdAt: '2026-05-29T00:00:00.000Z',
}

describe('AppStore', () => {
  beforeEach(() => {
    useAppStore.setState({
      repos: [],
      selectedRepoId: null,
      activeRunId: null,
      traceEvents: [],
      runStatus: 'idle',
    })
  })

  it('setRepos replaces the repos list', () => {
    useAppStore.getState().setRepos([testRepo])
    expect(useAppStore.getState().repos).toHaveLength(1)
    expect(useAppStore.getState().repos[0].id).toBe('repo-1')
  })

  it('addRepo appends without replacing existing repos', () => {
    useAppStore.getState().addRepo(testRepo)
    useAppStore.getState().addRepo({ ...testRepo, id: 'repo-2' })
    expect(useAppStore.getState().repos).toHaveLength(2)
  })

  it('selectRepo sets selectedRepoId and clears run state', () => {
    useAppStore.setState({
      activeRunId: 'run-1',
      traceEvents: [{ type: 'run_failed', error: 'x', _key: 0 }] as TracedEvent[],
      runStatus: 'failed',
    })
    useAppStore.getState().selectRepo('repo-1')
    expect(useAppStore.getState().selectedRepoId).toBe('repo-1')
    expect(useAppStore.getState().activeRunId).toBeNull()
    expect(useAppStore.getState().traceEvents).toHaveLength(0)
    expect(useAppStore.getState().runStatus).toBe('idle')
  })

  it('appendTraceEvent adds event to traceEvents', () => {
    const event: AgentSSEEvent = { type: 'state_changed', state: 'analyzing_repo' }
    useAppStore.getState().appendTraceEvent(event)
    expect(useAppStore.getState().traceEvents).toHaveLength(1)
    expect(useAppStore.getState().traceEvents[0]).toMatchObject(event)
  })

  it('appendTraceEvent caps at 500 entries dropping the oldest', () => {
    const events = Array.from({ length: 501 }, (_, i) => ({
      type: 'state_changed' as const,
      state: `state-${i}`,
    }))
    for (const event of events) {
      useAppStore.getState().appendTraceEvent(event)
    }
    expect(useAppStore.getState().traceEvents).toHaveLength(500)
    const first = useAppStore.getState().traceEvents[0] as { type: 'state_changed'; state: string }
    expect(first.state).toBe('state-1')
  })

  it('setActiveRun sets activeRunId and runStatus to running', () => {
    useAppStore.getState().setActiveRun('run-42')
    expect(useAppStore.getState().activeRunId).toBe('run-42')
    expect(useAppStore.getState().runStatus).toBe('running')
  })

  it('setRunStatus updates runStatus', () => {
    useAppStore.getState().setRunStatus('completed')
    expect(useAppStore.getState().runStatus).toBe('completed')
  })

  it('selectRepo(null) clears selectedRepoId', () => {
    useAppStore.setState({ selectedRepoId: 'repo-1' })
    useAppStore.getState().selectRepo(null)
    expect(useAppStore.getState().selectedRepoId).toBeNull()
  })

  it('clearTrace resets traceEvents, activeRunId, and runStatus', () => {
    useAppStore.setState({
      activeRunId: 'run-1',
      traceEvents: [{ type: 'run_failed', error: 'x', _key: 0 }] as TracedEvent[],
      runStatus: 'failed',
    })
    useAppStore.getState().clearTrace()
    expect(useAppStore.getState().traceEvents).toHaveLength(0)
    expect(useAppStore.getState().activeRunId).toBeNull()
    expect(useAppStore.getState().runStatus).toBe('idle')
  })
})

describe('plan proposal state', () => {
  it('setPlanProposal stores the proposal', () => {
    const { setPlanProposal } = useAppStore.getState()
    setPlanProposal({ planText: 'Step 1: analyze\nStep 2: edit' })
    expect(useAppStore.getState().planProposal).toEqual({ planText: 'Step 1: analyze\nStep 2: edit' })
  })

  it('clearPlanProposal sets planProposal to null', () => {
    const { setPlanProposal, clearPlanProposal } = useAppStore.getState()
    setPlanProposal({ planText: 'some plan' })
    clearPlanProposal()
    expect(useAppStore.getState().planProposal).toBeNull()
  })
})

describe('pending edits state', () => {
  it('addPendingEdit adds a FileChange with status pending', () => {
    useAppStore.setState({ pendingEdits: [] })
    const { addPendingEdit } = useAppStore.getState()
    addPendingEdit({ changeId: 'c1', filePath: 'src/foo.ts', diff: '--- a\n+++ b', originalContent: 'a', proposedContent: 'b' })
    const edits = useAppStore.getState().pendingEdits
    expect(edits).toHaveLength(1)
    expect(edits[0]).toEqual({ changeId: 'c1', filePath: 'src/foo.ts', diff: '--- a\n+++ b', originalContent: 'a', proposedContent: 'b', status: 'pending' })
  })

  it('resolveEdit updates the status of a specific edit', () => {
    useAppStore.setState({ pendingEdits: [] })
    const { addPendingEdit, resolveEdit } = useAppStore.getState()
    addPendingEdit({ changeId: 'c1', filePath: 'src/foo.ts', diff: '', originalContent: '', proposedContent: '' })
    addPendingEdit({ changeId: 'c2', filePath: 'src/bar.ts', diff: '', originalContent: '', proposedContent: '' })
    resolveEdit('c1', 'approved')
    const edits = useAppStore.getState().pendingEdits
    expect(edits.find((e) => e.changeId === 'c1')?.status).toBe('approved')
    expect(edits.find((e) => e.changeId === 'c2')?.status).toBe('pending')
  })

  it('clearPendingEdits resets to empty array', () => {
    const { addPendingEdit, clearPendingEdits } = useAppStore.getState()
    addPendingEdit({ changeId: 'c1', filePath: 'f.ts', diff: '', originalContent: '', proposedContent: '' })
    clearPendingEdits()
    expect(useAppStore.getState().pendingEdits).toHaveLength(0)
  })
})

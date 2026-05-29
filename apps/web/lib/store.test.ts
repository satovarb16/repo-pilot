import { beforeEach, describe, expect, it } from 'vitest'
import { useAppStore } from './store'
import type { AgentSSEEvent, Repository } from './types'

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
      traceEvents: [{ type: 'run_failed', error: 'x' }],
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
    expect(useAppStore.getState().traceEvents[0]).toEqual(event)
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
    expect(useAppStore.getState().traceEvents[0].state).toBe('state-1')
  })

  it('clearTrace resets traceEvents, activeRunId, and runStatus', () => {
    useAppStore.setState({
      activeRunId: 'run-1',
      traceEvents: [{ type: 'run_failed', error: 'x' }],
      runStatus: 'failed',
    })
    useAppStore.getState().clearTrace()
    expect(useAppStore.getState().traceEvents).toHaveLength(0)
    expect(useAppStore.getState().activeRunId).toBeNull()
    expect(useAppStore.getState().runStatus).toBe('idle')
  })
})

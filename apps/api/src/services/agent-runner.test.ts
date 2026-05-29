import { describe, it, expect } from 'vitest'
import { AgentRunner } from './agent-runner.js'

// We test only the approval mechanism — no real DB or process needed
const makeRunner = () =>
  new AgentRunner(
    {} as never,  // prisma — not used in these tests
    '/tmp/repos',
    'fake-api-key',
    '/fake/mcp-path',
  )

describe('AgentRunner approval mechanism', () => {
  it('resolvePlanApproval resolves the waitForPlanApproval promise with true', async () => {
    const runner = makeRunner()
    const promise = runner.waitForPlanApproval('run-1')
    runner.resolvePlanApproval('run-1', true)
    await expect(promise).resolves.toBe(true)
  })

  it('resolvePlanApproval resolves with false when rejected', async () => {
    const runner = makeRunner()
    const promise = runner.waitForPlanApproval('run-1')
    runner.resolvePlanApproval('run-1', false)
    await expect(promise).resolves.toBe(false)
  })

  it('resolveEditApprovals resolves the waitForEditApprovals promise', async () => {
    const runner = makeRunner()
    const promise = runner.waitForEditApprovals('run-1')
    runner.resolveEditApprovals('run-1', { approved: ['c1', 'c2'], rejected: ['c3'] })
    await expect(promise).resolves.toEqual({ approved: ['c1', 'c2'], rejected: ['c3'] })
  })

  it('resolvePlanApproval is a no-op for unknown runId', () => {
    const runner = makeRunner()
    expect(() => runner.resolvePlanApproval('unknown-run', true)).not.toThrow()
  })

  it('resolveEditApprovals is a no-op for unknown runId', () => {
    const runner = makeRunner()
    expect(() =>
      runner.resolveEditApprovals('unknown-run', { approved: [], rejected: [] }),
    ).not.toThrow()
  })
})

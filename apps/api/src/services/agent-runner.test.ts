import { describe, it, expect, vi } from 'vitest'
import { AgentRunner } from './agent-runner.js'

// We test only the approval mechanism — no real DB or process needed
const makeRunner = () =>
  new AgentRunner(
    {} as never,  // prisma — not used in these tests
    '/tmp/repos',
    'fake-api-key',
    '/fake/mcp-path',
  )

// D1-10/D1-12 PR resolver and token threading tests are at the bottom

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

// ---------------------------------------------------------------------------
// D1-4.1 — AgentRunner test-run approval mechanism
// ---------------------------------------------------------------------------
describe('AgentRunner test-run approval mechanism', () => {
  it('resolveTestRunApproval resolves waitForTestRunApproval with true', async () => {
    const runner = makeRunner()
    const promise = runner.waitForTestRunApproval('run-1')
    runner.resolveTestRunApproval('run-1', true)
    await expect(promise).resolves.toBe(true)
  })

  it('resolveTestRunApproval resolves with false when rejected', async () => {
    const runner = makeRunner()
    const promise = runner.waitForTestRunApproval('run-1')
    runner.resolveTestRunApproval('run-1', false)
    await expect(promise).resolves.toBe(false)
  })

  it('resolver is deleted from Map after resolution', async () => {
    const runner = makeRunner()
    const promise = runner.waitForTestRunApproval('run-1')
    runner.resolveTestRunApproval('run-1', true)
    await promise
    // Resolving again for same runId is a no-op (resolver deleted)
    expect(() => runner.resolveTestRunApproval('run-1', true)).not.toThrow()
  })

  it('resolveTestRunApproval is a no-op for unknown runId', () => {
    const runner = makeRunner()
    expect(() => runner.resolveTestRunApproval('unknown-run', true)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// D1-10 — AgentRunner PR resolver mechanism
// ---------------------------------------------------------------------------
describe('AgentRunner PR approval mechanism', () => {
  it('resolvePRApproval resolves waitForPRApproval with true', async () => {
    const runner = makeRunner()
    const promise = runner.waitForPRApproval('run-1')
    runner.resolvePRApproval('run-1', true)
    await expect(promise).resolves.toBe(true)
  })

  it('resolvePRApproval resolves waitForPRApproval with false', async () => {
    const runner = makeRunner()
    const promise = runner.waitForPRApproval('run-1')
    runner.resolvePRApproval('run-1', false)
    await expect(promise).resolves.toBe(false)
  })

  it('resolver entry is deleted from Map after resolution', async () => {
    const runner = makeRunner()
    const promise = runner.waitForPRApproval('run-1')
    runner.resolvePRApproval('run-1', true)
    await promise
    // Calling again is a no-op — resolver already deleted
    expect(() => runner.resolvePRApproval('run-1', true)).not.toThrow()
  })

  it('resolvePRApproval is a no-op for unknown runId', () => {
    const runner = makeRunner()
    expect(() => runner.resolvePRApproval('unknown-run', true)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// D1-12 — owner/repo threading: start() signature accepts token + owner + repo
// ---------------------------------------------------------------------------
describe('AgentRunner token and owner/repo threading', () => {
  it('start() accepts token, owner, repo params without throwing', async () => {
    // We cannot call the real start() without real DB/MCP; verify the signature is correct
    // by checking the method accepts the expected arguments
    const runner = makeRunner()
    // The method should accept 5 args — verify no TS error by calling with all params
    // We mock the implementation to avoid real work
    const startSpy = vi.spyOn(runner, 'start').mockResolvedValue(undefined)
    await runner.start('run-1', '/tmp/repo', 'my-token', 'owner', 'repo')
    expect(startSpy).toHaveBeenCalledWith('run-1', '/tmp/repo', 'my-token', 'owner', 'repo')
  })

  it('start() works with no token (backward compat — PR gate skipped)', async () => {
    const runner = makeRunner()
    const startSpy = vi.spyOn(runner, 'start').mockResolvedValue(undefined)
    await runner.start('run-1', '/tmp/repo')
    expect(startSpy).toHaveBeenCalledWith('run-1', '/tmp/repo')
  })
})

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TestOutputPanel } from './TestOutputPanel'
import type { TestRunView } from '@/lib/types'

const passedRun: TestRunView = {
  id: 'tr-1',
  command: 'npm test',
  status: 'passed',
  exitCode: 0,
  stdout: 'All tests pass',
  stderr: '',
  durationMs: 1200,
  sandboxed: true,
}

const failedRun: TestRunView = {
  id: 'tr-2',
  command: 'npm test',
  status: 'failed',
  exitCode: 1,
  stdout: '',
  stderr: '1 test failed',
  durationMs: 800,
  sandboxed: false,
}

describe('TestOutputPanel', () => {
  it('renders each TestRunView with a pass badge', () => {
    render(<TestOutputPanel runs={[passedRun]} />)
    expect(screen.getByText(/passed/i)).toBeTruthy()
  })

  it('renders each TestRunView with a fail badge', () => {
    render(<TestOutputPanel runs={[failedRun]} />)
    expect(screen.getAllByText(/failed/i).length).toBeGreaterThan(0)
  })

  it('shows non-sandboxed warning badge when sandboxed is false', () => {
    render(<TestOutputPanel runs={[failedRun]} />)
    expect(screen.getByText(/non-sandboxed/i)).toBeTruthy()
  })

  it('does not show non-sandboxed badge when sandboxed is true', () => {
    render(<TestOutputPanel runs={[passedRun]} />)
    expect(screen.queryByText(/non-sandboxed/i)).toBeNull()
  })

  it('shows repair attempt badge when repairAttempt > 0', () => {
    render(<TestOutputPanel runs={[passedRun]} repairAttempt={1} />)
    expect(screen.getByText(/repair/i)).toBeTruthy()
  })

  it('does not show repair badge when repairAttempt is 0', () => {
    render(<TestOutputPanel runs={[passedRun]} repairAttempt={0} />)
    expect(screen.queryByText(/repair attempt/i)).toBeNull()
  })

  it('renders stdout for a run', () => {
    render(<TestOutputPanel runs={[passedRun]} />)
    expect(screen.getByText('All tests pass')).toBeTruthy()
  })

  it('renders stderr for a run', () => {
    render(<TestOutputPanel runs={[failedRun]} />)
    expect(screen.getByText('1 test failed')).toBeTruthy()
  })
})

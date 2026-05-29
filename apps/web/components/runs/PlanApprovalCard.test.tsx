import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PlanApprovalCard } from './PlanApprovalCard'

const mockApprovePlan = vi.fn().mockResolvedValue(undefined)
const mockRejectPlan = vi.fn().mockResolvedValue(undefined)

vi.mock('@/lib/api', () => ({
  approvePlan: (...args: unknown[]) => mockApprovePlan(...args),
  rejectPlan: (...args: unknown[]) => mockRejectPlan(...args),
}))

describe('PlanApprovalCard', () => {
  beforeEach(() => {
    mockApprovePlan.mockClear()
    mockRejectPlan.mockClear()
    mockApprovePlan.mockResolvedValue(undefined)
    mockRejectPlan.mockResolvedValue(undefined)
  })

  it('renders plan text', () => {
    render(
      <PlanApprovalCard
        runId="run-1"
        planText="Step 1: analyze the repo\nStep 2: edit the files"
      />
    )
    expect(screen.getByText(/analyze the repo/i)).toBeTruthy()
  })

  it('calls approvePlan when Approve Plan button clicked', async () => {
    render(<PlanApprovalCard runId="run-1" planText="Step 1: do it" />)
    fireEvent.click(screen.getByTestId('approve-button'))
    await waitFor(() => expect(mockApprovePlan).toHaveBeenCalledWith('run-1'))
  })

  it('calls rejectPlan when Reject button clicked', async () => {
    render(<PlanApprovalCard runId="run-1" planText="Step 1: do it" />)
    fireEvent.click(screen.getByTestId('reject-button'))
    await waitFor(() => expect(mockRejectPlan).toHaveBeenCalledWith('run-1'))
  })

  it('disables buttons while loading', async () => {
    mockApprovePlan.mockImplementation(() => new Promise(() => {})) // never resolves
    render(<PlanApprovalCard runId="run-1" planText="Step 1: do it" />)
    fireEvent.click(screen.getByTestId('approve-button'))
    await waitFor(() => {
      expect((screen.getByTestId('approve-button') as HTMLButtonElement).disabled).toBe(true)
      expect((screen.getByTestId('reject-button') as HTMLButtonElement).disabled).toBe(true)
    })
  })
})

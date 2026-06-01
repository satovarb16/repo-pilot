import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PRApprovalCard } from './PRApprovalCard'
import * as api from '@/lib/api'

vi.mock('@/lib/api', () => ({
  approvePR: vi.fn(),
  rejectPR: vi.fn(),
}))

describe('PRApprovalCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.approvePR).mockResolvedValue(undefined)
    vi.mocked(api.rejectPR).mockResolvedValue(undefined)
  })

  it('renders prTitle and prBody', () => {
    render(
      <PRApprovalCard
        runId="run-1"
        prTitle="feat: new feature"
        prBody="Automated by RepoPilot\n\nTask: new feature"
      />,
    )
    expect(screen.getByText('feat: new feature')).toBeTruthy()
    expect(screen.getByText(/Automated by RepoPilot/)).toBeTruthy()
  })

  it('calls api.approvePR(runId) when Approve button is clicked', async () => {
    render(
      <PRApprovalCard
        runId="run-42"
        prTitle="feat: x"
        prBody="body"
      />,
    )
    fireEvent.click(screen.getByTestId('approve-pr-button'))
    await waitFor(() => expect(api.approvePR).toHaveBeenCalledWith('run-42'))
  })

  it('calls api.rejectPR(runId) when Reject button is clicked', async () => {
    render(
      <PRApprovalCard
        runId="run-42"
        prTitle="feat: x"
        prBody="body"
      />,
    )
    fireEvent.click(screen.getByTestId('reject-pr-button'))
    await waitFor(() => expect(api.rejectPR).toHaveBeenCalledWith('run-42'))
  })

  it('disables both buttons while API call is in-flight', async () => {
    // Make approvePR hang so we can inspect the in-flight state
    let resolveApprove!: () => void
    vi.mocked(api.approvePR).mockReturnValue(new Promise<void>((r) => { resolveApprove = r }))

    render(
      <PRApprovalCard
        runId="run-1"
        prTitle="feat: x"
        prBody="body"
      />,
    )

    const approveBtn = screen.getByTestId('approve-pr-button') as HTMLButtonElement
    const rejectBtn = screen.getByTestId('reject-pr-button') as HTMLButtonElement

    fireEvent.click(approveBtn)

    // While in-flight both buttons must be disabled
    await waitFor(() => expect(approveBtn.disabled).toBe(true))
    expect(rejectBtn.disabled).toBe(true)

    resolveApprove()
    await waitFor(() => expect(approveBtn.disabled).toBe(false))
  })

  it('calls onApprove callback after api.approvePR resolves', async () => {
    const onApprove = vi.fn()
    render(
      <PRApprovalCard
        runId="run-1"
        prTitle="feat: x"
        prBody="body"
        onApprove={onApprove}
      />,
    )
    fireEvent.click(screen.getByTestId('approve-pr-button'))
    await waitFor(() => expect(onApprove).toHaveBeenCalledOnce())
  })

  it('calls onReject callback after api.rejectPR resolves', async () => {
    const onReject = vi.fn()
    render(
      <PRApprovalCard
        runId="run-1"
        prTitle="feat: x"
        prBody="body"
        onReject={onReject}
      />,
    )
    fireEvent.click(screen.getByTestId('reject-pr-button'))
    await waitFor(() => expect(onReject).toHaveBeenCalledOnce())
  })
})

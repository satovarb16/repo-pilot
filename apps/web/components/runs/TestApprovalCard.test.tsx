import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TestApprovalCard } from './TestApprovalCard'

describe('TestApprovalCard', () => {
  it('renders the command text', () => {
    render(
      <TestApprovalCard
        command="npm test"
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    )
    expect(screen.getByText('npm test')).toBeTruthy()
  })

  it('calls onApprove when Approve button is clicked', () => {
    const onApprove = vi.fn()
    render(
      <TestApprovalCard
        command="npm test"
        onApprove={onApprove}
        onReject={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByTestId('approve-test-button'))
    expect(onApprove).toHaveBeenCalledOnce()
  })

  it('calls onReject when Reject button is clicked', () => {
    const onReject = vi.fn()
    render(
      <TestApprovalCard
        command="npm test"
        onApprove={vi.fn()}
        onReject={onReject}
      />,
    )
    fireEvent.click(screen.getByTestId('reject-test-button'))
    expect(onReject).toHaveBeenCalledOnce()
  })

  it('disables both buttons when disabled prop is true', () => {
    render(
      <TestApprovalCard
        command="npm test"
        onApprove={vi.fn()}
        onReject={vi.fn()}
        disabled={true}
      />,
    )
    const approveBtn = screen.getByTestId('approve-test-button') as HTMLButtonElement
    const rejectBtn = screen.getByTestId('reject-test-button') as HTMLButtonElement
    expect(approveBtn.disabled).toBe(true)
    expect(rejectBtn.disabled).toBe(true)
  })
})

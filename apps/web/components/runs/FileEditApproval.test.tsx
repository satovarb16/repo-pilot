import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { FileEditApproval } from './FileEditApproval'
import type { FileChange } from '@/lib/types'

const mockResolveEdit = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/api', () => ({
  resolveEdit: (...args: unknown[]) => mockResolveEdit(...args),
}))

const mockResolveEditStore = vi.fn()
vi.mock('@/lib/store', () => ({
  useAppStore: (sel: (s: { resolveEdit: typeof mockResolveEditStore }) => unknown) =>
    sel({ resolveEdit: mockResolveEditStore }),
}))

const makeEdit = (n: number): FileChange => ({
  changeId: `c${n}`,
  filePath: `src/file${n}.ts`,
  diff: `--- a/src/file${n}.ts\n+++ b/src/file${n}.ts\n@@ -1 +1 @@\n-old\n+new`,
  originalContent: 'old',
  proposedContent: 'new',
  status: 'pending',
})

describe('FileEditApproval', () => {
  beforeEach(() => {
    mockResolveEdit.mockClear()
    mockResolveEditStore.mockClear()
  })

  it('renders a tab for each pending edit', () => {
    render(
      <FileEditApproval
        runId="run-1"
        edits={[makeEdit(1), makeEdit(2)]}
      />
    )
    expect(screen.getByRole('tab', { name: /file1\.ts/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /file2\.ts/i })).toBeInTheDocument()
  })

  it('calls resolveEdit API and store when Approve clicked', async () => {
    render(
      <FileEditApproval
        runId="run-1"
        edits={[makeEdit(1)]}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /approve/i }))
    await waitFor(() => expect(mockResolveEdit).toHaveBeenCalledWith('run-1', 'c1', 'approve'))
    expect(mockResolveEditStore).toHaveBeenCalledWith('c1', 'approved')
  })

  it('calls resolveEdit with reject when Reject clicked', async () => {
    render(
      <FileEditApproval
        runId="run-1"
        edits={[makeEdit(1)]}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /reject/i }))
    await waitFor(() => expect(mockResolveEdit).toHaveBeenCalledWith('run-1', 'c1', 'reject'))
    expect(mockResolveEditStore).toHaveBeenCalledWith('c1', 'rejected')
  })

  it('advances to the next pending tab after resolving current', async () => {
    render(
      <FileEditApproval
        runId="run-1"
        edits={[makeEdit(1), makeEdit(2)]}
      />
    )
    // First tab active
    expect(screen.getByRole('tab', { name: /file1\.ts/i })).toHaveAttribute('data-state', 'active')
    fireEvent.click(screen.getByRole('button', { name: /approve/i }))
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /file2\.ts/i })).toHaveAttribute('data-state', 'active')
    })
  })
})

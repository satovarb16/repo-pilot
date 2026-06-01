import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RightPanel } from './RightPanel'

// Mock TraceLog to avoid SSE and scroll complications
vi.mock('@/components/runs/TraceLog', () => ({ TraceLog: () => <div>TraceLog</div> }))

// Mock store for token usage state
const mockStore = vi.fn()
vi.mock('@/lib/store', () => ({
  useAppStore: (sel: (s: Record<string, unknown>) => unknown) => sel(mockStore()),
}))

const baseStore = {
  tokenUsage: null,
}

describe('RightPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStore.mockReturnValue(baseStore)
  })

  // Security badge is always present regardless of run state
  it('always renders the "Redaction active" security badge', () => {
    render(<RightPanel />)
    expect(screen.getByText(/redaction active/i)).toBeInTheDocument()
  })

  // Token widget: null state shows zeros
  it('renders ↑0 ↓0 when tokenUsage is null', () => {
    render(<RightPanel />)
    expect(screen.getByText(/↑0/)).toBeInTheDocument()
    expect(screen.getByText(/↓0/)).toBeInTheDocument()
  })

  // Token widget: populated state shows actual values
  it('renders actual token counts when tokenUsage is set', () => {
    mockStore.mockReturnValue({
      ...baseStore,
      tokenUsage: { inputTokens: 1500, outputTokens: 320 },
    })
    render(<RightPanel />)
    expect(screen.getByText(/↑1500/)).toBeInTheDocument()
    expect(screen.getByText(/↓320/)).toBeInTheDocument()
  })

  // Token widget: security badge remains when token data is available
  it('renders security badge alongside token counts when tokenUsage is set', () => {
    mockStore.mockReturnValue({
      ...baseStore,
      tokenUsage: { inputTokens: 100, outputTokens: 50 },
    })
    render(<RightPanel />)
    expect(screen.getByText(/redaction active/i)).toBeInTheDocument()
    expect(screen.getByText(/↑100/)).toBeInTheDocument()
  })
})

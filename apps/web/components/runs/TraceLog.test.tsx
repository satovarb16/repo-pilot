import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TraceLog } from './TraceLog'

// jsdom does not implement scrollIntoView — stub it globally
window.HTMLElement.prototype.scrollIntoView = vi.fn()

// Mock store so we control state directly in each test
const mockStore = vi.fn()
vi.mock('@/lib/store', () => ({
  useAppStore: (sel: (s: Record<string, unknown>) => unknown) => sel(mockStore()),
}))

// Prevent SSE hook from opening real connections in tests
vi.mock('@/lib/sse', () => ({ useAgentStream: vi.fn() }))
vi.mock('@/components/EmptyState', () => ({ EmptyState: ({ title }: { title: string }) => <div data-testid="empty-state">{title}</div> }))

const baseStore = {
  activeRunId: null,
  traceEvents: [],
  runStatus: 'idle',
  connectionError: false,
  setConnectionError: vi.fn(),
}

describe('TraceLog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStore.mockReturnValue(baseStore)
  })

  // --- T17: EmptyState for no-run state ---

  it('renders EmptyState when there is no active run and no trace events', () => {
    // baseStore has activeRunId: null and traceEvents: []
    render(<TraceLog />)
    expect(screen.getByTestId('empty-state')).toBeInTheDocument()
  })

  // --- T12: expandable tool_called cards ---

  it('renders tool name in summary for tool_called events', () => {
    mockStore.mockReturnValue({
      ...baseStore,
      activeRunId: 'run-1',
      traceEvents: [
        { type: 'tool_called', name: 'read_file', input: { path: 'src/index.ts' }, output: 'contents', _key: 1 },
      ],
    })
    render(<TraceLog />)
    expect(screen.getByText(/read_file/)).toBeInTheDocument()
  })

  it('renders input and output JSON in a details element for tool_called events', () => {
    // jsdom renders <details> content in the DOM regardless of open state.
    // We verify the card structure is present with the right content.
    mockStore.mockReturnValue({
      ...baseStore,
      activeRunId: 'run-1',
      traceEvents: [
        { type: 'tool_called', name: 'read_file', input: { path: 'src/index.ts' }, output: 'contents', _key: 1 },
      ],
    })
    render(<TraceLog />)
    // Input and output are rendered inside <details> — present in the DOM
    expect(screen.getByText(/"path"/)).toBeInTheDocument()
    expect(screen.getByText(/contents/)).toBeInTheDocument()
    // The collapsible wrapper must be a native <details> element
    expect(document.querySelector('details')).not.toBeNull()
  })

  it('shows input and output JSON in tool_called card', () => {
    mockStore.mockReturnValue({
      ...baseStore,
      activeRunId: 'run-1',
      traceEvents: [
        { type: 'tool_called', name: 'read_file', input: { path: 'src/index.ts' }, output: 'file content here', _key: 1 },
      ],
    })
    render(<TraceLog />)
    // Both input JSON and output are rendered inside the <details> body
    expect(screen.getByText(/"path"/)).toBeInTheDocument()
    expect(screen.getByText(/file content here/)).toBeInTheDocument()
  })

  it('renders non-tool events as flat text lines (no details element)', () => {
    mockStore.mockReturnValue({
      ...baseStore,
      activeRunId: 'run-1',
      traceEvents: [
        { type: 'state_changed', state: 'analyzing_repo', _key: 2 },
      ],
    })
    render(<TraceLog />)
    expect(screen.getByText(/analyzing_repo/)).toBeInTheDocument()
    expect(document.querySelector('details')).toBeNull()
  })

  // --- T13: SSE disconnect banner ---

  it('shows disconnect banner when connectionError is true and run is running', () => {
    mockStore.mockReturnValue({
      ...baseStore,
      activeRunId: 'run-1',
      runStatus: 'running',
      connectionError: true,
    })
    render(<TraceLog />)
    expect(screen.getByText(/connection lost/i)).toBeInTheDocument()
  })

  it('does not show disconnect banner when connectionError is false', () => {
    mockStore.mockReturnValue({
      ...baseStore,
      activeRunId: 'run-1',
      runStatus: 'running',
      connectionError: false,
    })
    render(<TraceLog />)
    expect(screen.queryByText(/connection lost/i)).not.toBeInTheDocument()
  })

  it('does not show disconnect banner when run is completed (not running)', () => {
    mockStore.mockReturnValue({
      ...baseStore,
      activeRunId: 'run-1',
      runStatus: 'completed',
      connectionError: true,
    })
    render(<TraceLog />)
    expect(screen.queryByText(/connection lost/i)).not.toBeInTheDocument()
  })

  it('dismiss button calls setConnectionError(false)', () => {
    const setConnectionError = vi.fn()
    mockStore.mockReturnValue({
      ...baseStore,
      activeRunId: 'run-1',
      runStatus: 'running',
      connectionError: true,
      setConnectionError,
    })
    render(<TraceLog />)
    const dismissBtn = screen.getByRole('button', { name: /dismiss/i })
    fireEvent.click(dismissBtn)
    expect(setConnectionError).toHaveBeenCalledWith(false)
  })
})

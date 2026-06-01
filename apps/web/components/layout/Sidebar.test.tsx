import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Sidebar } from './Sidebar'

// Mock external deps to isolate the sidebar
vi.mock('@/lib/api', () => ({ listRepos: vi.fn().mockResolvedValue([]) }))
vi.mock('@/components/repos/RepoListItem', () => ({ RepoListItem: ({ repo }: { repo: { name: string } }) => <div>{repo.name}</div> }))
vi.mock('@/components/repos/ConnectRepoDialog', () => ({ ConnectRepoDialog: () => <div>ConnectRepoDialog</div> }))
vi.mock('@/components/ui/separator', () => ({ Separator: () => <hr /> }))
vi.mock('@/components/EmptyState', () => ({ EmptyState: ({ title, hint }: { title: string; hint?: string }) => <div data-testid="empty-state">{title}{hint && ` — ${hint}`}</div> }))

const mockStore = vi.fn()
vi.mock('@/lib/store', () => ({
  useAppStore: (sel: (s: Record<string, unknown>) => unknown) => sel(mockStore()),
}))

describe('Sidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStore.mockReturnValue({ repos: [], setRepos: vi.fn() })
  })

  it('uses EmptyState when repos list is empty', () => {
    render(<Sidebar />)
    expect(screen.getByTestId('empty-state')).toBeInTheDocument()
  })

  it('does not show EmptyState when repos are present', () => {
    mockStore.mockReturnValue({
      repos: [{ id: 'r1', owner: 'acme', name: 'my-repo', cloneUrl: '', cloneStatus: 'ready', createdAt: '' }],
      setRepos: vi.fn(),
    })
    render(<Sidebar />)
    expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument()
    expect(screen.getByText('my-repo')).toBeInTheDocument()
  })
})

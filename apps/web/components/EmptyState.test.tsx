import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EmptyState } from './EmptyState'

describe('EmptyState', () => {
  it('renders the title', () => {
    render(<EmptyState icon={<span>icon</span>} title="No repos yet" />)
    expect(screen.getByText('No repos yet')).toBeInTheDocument()
  })

  it('renders hint when provided', () => {
    render(<EmptyState icon={<span>icon</span>} title="No runs" hint="Start by composing a task" />)
    expect(screen.getByText('Start by composing a task')).toBeInTheDocument()
  })

  it('does not render hint element when hint is not provided', () => {
    render(<EmptyState icon={<span>icon</span>} title="No data" />)
    // Hint slot should be absent from the DOM
    expect(screen.queryByTestId('empty-state-hint')).not.toBeInTheDocument()
  })

  it('renders the icon', () => {
    render(<EmptyState icon={<span data-testid="custom-icon">★</span>} title="Empty" />)
    expect(screen.getByTestId('custom-icon')).toBeInTheDocument()
  })
})

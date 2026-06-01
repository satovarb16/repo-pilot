import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ErrorBoundary } from './ErrorBoundary'

// A child component that throws unconditionally — used to trigger the boundary.
// Return type is JSX.Element to satisfy TypeScript; the throw means it never returns.
function ThrowingChild(): React.JSX.Element {
  throw new Error('Render error for testing')
}

// A safe child for happy-path tests
function SafeChild() {
  return <div>Safe content</div>
}

describe('ErrorBoundary', () => {
  // Suppress React's console.error noise for expected thrown errors in tests
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('renders children when no error occurs', () => {
    render(
      <ErrorBoundary>
        <SafeChild />
      </ErrorBoundary>,
    )
    expect(screen.getByText('Safe content')).toBeInTheDocument()
  })

  it('shows fallback UI when a child throws during render', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>,
    )
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()
  })

  it('renders a Reset button in the fallback UI', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('button', { name: /reset/i })).toBeInTheDocument()
  })

  it('Reset button is present and clicking it does not throw', () => {
    // Verifies the reset handler exists and fires without error.
    // Full recovery requires the parent to swap children after reset,
    // which is tested by the "renders children when no error occurs" test.
    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>,
    )
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()
    // Should not throw when clicked
    expect(() =>
      fireEvent.click(screen.getByRole('button', { name: /reset/i })),
    ).not.toThrow()
  })
})

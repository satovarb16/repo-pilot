import React from 'react'

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

interface ErrorBoundaryProps {
  children: React.ReactNode
}

// Class component required for React's error boundary lifecycle methods.
// Wraps run-specific UI so a render crash doesn't take down the entire app.
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Non-fatal — log for debugging without crashing the app
    console.error('[ErrorBoundary] Caught render error:', error, info)
  }

  // Reset the boundary so children can attempt to re-render on next update
  handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      return (
        // Fallback UI: centered icon + message + reset button
        <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-6">
          <div className="flex items-center justify-center w-12 h-12 rounded-full bg-muted">
            <svg
              aria-hidden="true"
              className="w-6 h-6 text-muted-foreground"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
              />
            </svg>
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">Something went wrong</p>
            <p className="text-xs text-muted-foreground">
              A rendering error occurred in this panel.
            </p>
          </div>
          <button
            onClick={this.handleReset}
            className="text-xs font-medium px-3 py-1.5 rounded border border-border hover:bg-muted transition-colors"
          >
            Reset
          </button>
        </div>
      )
    }

    return this.props.children
  }
}

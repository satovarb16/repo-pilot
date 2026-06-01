import React from 'react'

interface EmptyStateProps {
  icon: React.ReactNode
  title: string
  hint?: string
}

// Shared empty-state component used wherever there is no data to display.
// Centered layout with generous whitespace — per CLAUDE.md design language.
export function EmptyState({ icon, title, hint }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-6 py-8">
      {/* Icon slot — accepts any React node; renders at muted color */}
      <div className="flex items-center justify-center w-10 h-10 rounded-full bg-muted text-muted-foreground">
        {icon}
      </div>

      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {/* Hint is optional — only rendered when provided */}
        {hint && (
          <p
            data-testid="empty-state-hint"
            className="text-xs text-muted-foreground"
          >
            {hint}
          </p>
        )}
      </div>
    </div>
  )
}

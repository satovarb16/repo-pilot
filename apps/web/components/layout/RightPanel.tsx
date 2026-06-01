'use client'

import { TraceLog } from '@/components/runs/TraceLog'
import { useAppStore } from '@/lib/store'

export function RightPanel() {
  // Read cumulative token usage — null until the first token_usage SSE event arrives
  const tokenUsage = useAppStore((s) => s.tokenUsage)

  const inputTokens = tokenUsage?.inputTokens ?? 0
  const outputTokens = tokenUsage?.outputTokens ?? 0

  return (
    <aside className="w-96 border-l border-border flex flex-col shrink-0">
      {/* Header: title + token counter widget + security indicator */}
      <div className="p-3 border-b border-border flex items-center justify-between gap-2">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Trace
        </h2>

        <div className="flex items-center gap-2 shrink-0">
          {/* Compact token usage widget — updates reactively via store */}
          <span className="text-[11px] font-mono text-muted-foreground tabular-nums">
            ↑{inputTokens} ↓{outputTokens}
          </span>

          {/* Static redaction active badge — redaction is always on */}
          <span className="flex items-center gap-0.5 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
            <svg
              aria-hidden="true"
              className="w-3 h-3 shrink-0"
              viewBox="0 0 16 16"
              fill="currentColor"
            >
              <path d="M8 1L2 3.5v5c0 3.1 2.5 6 6 7 3.5-1 6-3.9 6-7v-5L8 1z" />
            </svg>
            Redaction active
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        <TraceLog />
      </div>
    </aside>
  )
}

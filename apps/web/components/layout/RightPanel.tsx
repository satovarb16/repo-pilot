'use client'

import { TraceLog } from '@/components/runs/TraceLog'

export function RightPanel() {
  return (
    <aside className="w-96 border-l border-border flex flex-col shrink-0">
      <div className="p-3 border-b border-border">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Trace
        </h2>
      </div>
      <div className="flex-1 overflow-hidden">
        <TraceLog />
      </div>
    </aside>
  )
}

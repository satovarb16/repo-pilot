'use client'

import { useEffect, useRef } from 'react'
import { useAppStore } from '@/lib/store'
import { useAgentStream } from '@/lib/sse'
import type { AgentSSEEvent } from '@/lib/types'

function eventColor(event: AgentSSEEvent): string {
  switch (event.type) {
    case 'state_changed':
      return 'text-blue-400'
    case 'tool_called':
      return 'text-purple-400'
    case 'step_started':
    case 'step_completed':
      return 'text-amber-400'
    case 'approval_required':
      return 'text-amber-400'
    case 'run_completed':
      return 'text-green-400'
    case 'run_failed':
      return 'text-red-400'
    case 'edit_proposed':
      return 'text-cyan-400'
    default:
      return 'text-muted-foreground'
  }
}

function formatEvent(event: AgentSSEEvent): string {
  switch (event.type) {
    case 'state_changed':
      return `state → ${event.state}`
    case 'tool_called':
      return `tool: ${event.name}`
    case 'step_started':
      return `step: ${event.stepType} — ${event.description}`
    case 'step_completed':
      return `✓ ${event.stepType} (${event.durationMs}ms)`
    case 'approval_required':
      return '⚡ Plan ready for approval'
    case 'run_completed':
      return '✓ run completed'
    case 'run_failed':
      return `✗ run failed: ${event.error}`
    case 'edit_proposed':
      return `📝 Edit proposed: ${event.filePath}`
    default:
      return JSON.stringify(event)
  }
}

export function TraceLog() {
  const activeRunId = useAppStore((s) => s.activeRunId)
  const traceEvents = useAppStore((s) => s.traceEvents)
  const runStatus = useAppStore((s) => s.runStatus)
  const bottomRef = useRef<HTMLDivElement>(null)

  useAgentStream(activeRunId)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [traceEvents])

  if (!activeRunId && traceEvents.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-muted-foreground">No active run</p>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto font-mono text-xs p-2 space-y-0.5">
      {traceEvents.map((event) => (
        <div key={event._key} className={`leading-relaxed ${eventColor(event)}`}>
          {formatEvent(event)}
        </div>
      ))}
      {runStatus === 'running' && (
        <div className="flex items-center gap-1.5 text-muted-foreground pt-1">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          running...
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  )
}

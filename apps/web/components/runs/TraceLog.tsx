'use client'

import { useEffect, useRef } from 'react'
import { useAppStore } from '@/lib/store'
import { useAgentStream } from '@/lib/sse'
import { EmptyState } from '@/components/EmptyState'
import type { AgentSSEEvent } from '@/lib/types'
import type { TracedEvent } from '@/lib/store'

// Color map for each SSE event type — purple for tool calls, blue for state
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

// Flat one-line label for non-tool events
function formatEvent(event: AgentSSEEvent): string {
  switch (event.type) {
    case 'state_changed':
      return `state → ${event.state}`
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

// Expandable card for a tool_called event using native <details>/<summary>
// Duration is derived from adjacent step events when available; omitted otherwise.
function ToolCard({ event }: { event: TracedEvent & { type: 'tool_called' } }) {
  const inputJson = JSON.stringify(event.input, null, 2)
  const outputText = typeof event.output === 'string'
    ? event.output
    : JSON.stringify(event.output, null, 2)

  return (
    <details className="group">
      <summary className="cursor-pointer list-none flex items-center gap-1.5 text-purple-400 hover:text-purple-300">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-purple-400 shrink-0" />
        <span className="font-semibold">{event.name}</span>
      </summary>
      {/* Expanded body: input and output in <pre> blocks */}
      <div className="mt-1 ml-3 space-y-1">
        <p className="text-muted-foreground text-[10px] uppercase tracking-wider">Input</p>
        <pre className="text-[11px] bg-muted/40 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">{inputJson}</pre>
        <p className="text-muted-foreground text-[10px] uppercase tracking-wider">Output</p>
        <pre className="text-[11px] bg-muted/40 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">{outputText}</pre>
      </div>
    </details>
  )
}

export function TraceLog() {
  const activeRunId = useAppStore((s) => s.activeRunId)
  const traceEvents = useAppStore((s) => s.traceEvents)
  const runStatus = useAppStore((s) => s.runStatus)
  const connectionError = useAppStore((s) => s.connectionError)
  const setConnectionError = useAppStore((s) => s.setConnectionError)
  const bottomRef = useRef<HTMLDivElement>(null)

  useAgentStream(activeRunId)

  // Auto-scroll to the latest event as new ones arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [traceEvents])

  if (!activeRunId && traceEvents.length === 0) {
    return (
      <EmptyState
        icon={
          <svg aria-hidden="true" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776" />
          </svg>
        }
        title="No active run"
        hint="Select a run to see the trace log"
      />
    )
  }

  return (
    <div className="h-full overflow-y-auto font-mono text-xs p-2 space-y-0.5">
      {/* SSE disconnect banner — shown when connection dropped on an active run (runStatus is 'failed' by the time we render) */}
      {connectionError && runStatus === 'failed' && (
        <div className="flex items-center justify-between gap-2 px-2 py-1.5 mb-1 rounded bg-red-950/60 border border-red-800/50 text-red-300">
          <span>Connection lost — stream ended</span>
          <button
            aria-label="Dismiss"
            onClick={() => setConnectionError(false)}
            className="text-red-400 hover:text-red-200 text-[10px] uppercase tracking-wider"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Render each event: expandable card for tool calls, flat line otherwise */}
      {traceEvents.map((event) =>
        event.type === 'tool_called' ? (
          <ToolCard key={event._key} event={event as TracedEvent & { type: 'tool_called' }} />
        ) : (
          <div key={event._key} className={`leading-relaxed ${eventColor(event)}`}>
            {formatEvent(event)}
          </div>
        ),
      )}

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

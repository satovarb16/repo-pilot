'use client'

import type { TestRunView } from '@/lib/types'

interface TestOutputPanelProps {
  runs: TestRunView[]
  repairAttempt?: number
}

function StatusBadge({ status }: { status: TestRunView['status'] }) {
  if (status === 'passed') {
    return (
      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-emerald-500/15 text-emerald-400">
        passed
      </span>
    )
  }
  if (status === 'failed') {
    return (
      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-red-500/15 text-red-400">
        failed
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-zinc-500/15 text-zinc-400">
      running
    </span>
  )
}

export function TestOutputPanel({ runs, repairAttempt = 0 }: TestOutputPanelProps) {
  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-foreground">Test Results</span>
        {repairAttempt > 0 && (
          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-amber-500/15 text-amber-400">
            Repair attempt {repairAttempt}/2
          </span>
        )}
      </div>

      <div className="flex flex-col gap-3 flex-1 overflow-auto">
        {runs.map((run, idx) => (
          <div key={run.id} className="bg-muted rounded-md p-4 flex flex-col gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground font-mono">Run {idx + 1}</span>
              <StatusBadge status={run.status} />
              {!run.sandboxed && (
                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-yellow-500/15 text-yellow-400">
                  non-sandboxed
                </span>
              )}
              {run.durationMs !== null && (
                <span className="text-xs text-muted-foreground">{(run.durationMs / 1000).toFixed(1)}s</span>
              )}
              {run.exitCode !== null && (
                <span className="text-xs text-muted-foreground">exit {run.exitCode}</span>
              )}
            </div>

            {/* stdout */}
            {run.stdout && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">stdout</p>
                <pre className="text-xs font-mono bg-background rounded p-2 overflow-auto max-h-40 whitespace-pre-wrap">
                  {run.stdout}
                </pre>
              </div>
            )}

            {/* stderr */}
            {run.stderr && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">stderr</p>
                <pre className="text-xs font-mono bg-background rounded p-2 overflow-auto max-h-40 whitespace-pre-wrap text-red-400">
                  {run.stderr}
                </pre>
              </div>
            )}
          </div>
        ))}

        {runs.length === 0 && (
          <p className="text-sm text-muted-foreground">No test runs yet.</p>
        )}
      </div>
    </div>
  )
}

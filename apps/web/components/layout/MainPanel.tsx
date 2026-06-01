'use client'

import { useEffect } from 'react'
import { useAppStore } from '@/lib/store'
import { TaskComposer } from '@/components/runs/TaskComposer'
import { PlanApprovalCard } from '@/components/runs/PlanApprovalCard'
import { FileEditApproval } from '@/components/runs/FileEditApproval'
import { TestApprovalCard } from '@/components/runs/TestApprovalCard'
import { TestOutputPanel } from '@/components/runs/TestOutputPanel'
import { PRApprovalCard } from '@/components/runs/PRApprovalCard'
import { approveTestRun, rejectTestRun, fetchTestResults } from '@/lib/api'
import { EmptyState } from '@/components/EmptyState'
import { ErrorBoundary } from '@/components/ErrorBoundary'

const TEST_OUTPUT_STATES = new Set(['running_tests', 'reviewing', 'repairing'])

export function MainPanel() {
  const selectedRepoId = useAppStore((s) => s.selectedRepoId)
  const activeRunId = useAppStore((s) => s.activeRunId)
  const planProposal = useAppStore((s) => s.planProposal)
  const pendingEdits = useAppStore((s) => s.pendingEdits)
  const testApprovalCommand = useAppStore((s) => s.testApprovalCommand)
  const testRuns = useAppStore((s) => s.testRuns)
  const repairAttempt = useAppStore((s) => s.repairAttempt)
  const runStatus = useAppStore((s) => s.runStatus)
  const clearTestApproval = useAppStore((s) => s.clearTestApproval)
  // Phase 4: PR state
  const prApproval = useAppStore((s) => s.prApproval)
  const prUrl = useAppStore((s) => s.prUrl)
  const prNumber = useAppStore((s) => s.prNumber)

  // Derive machine state from SSE trace (last state_changed event)
  const traceEvents = useAppStore((s) => s.traceEvents)
  const lastStateEvent = [...traceEvents].reverse().find((e) => e.type === 'state_changed')
  const currentState = lastStateEvent?.type === 'state_changed' ? lastStateEvent.state : null

  const inTestOutputState = currentState !== null && TEST_OUTPUT_STATES.has(currentState)

  // On mount in test-output states, fetch persisted test results to hydrate after SSE disconnect/reload
  useEffect(() => {
    if (!activeRunId || !inTestOutputState) return
    fetchTestResults(activeRunId)
      .then((runs) => {
        if (runs.length > 0) {
          useAppStore.setState({ testRuns: runs })
        }
      })
      .catch(() => {
        // non-fatal: SSE may still hydrate via live events
      })
  }, [activeRunId, inTestOutputState])

  async function handleApproveTestRun() {
    if (!activeRunId) return
    clearTestApproval()
    await approveTestRun(activeRunId).catch(() => {})
  }

  async function handleRejectTestRun() {
    if (!activeRunId) return
    clearTestApproval()
    await rejectTestRun(activeRunId).catch(() => {})
  }

  return (
    <main className="flex-1 flex flex-col overflow-hidden">
      {/* ErrorBoundary wraps only the content area — sidebar stays navigable on error */}
      <ErrorBoundary>
      <div className="flex-1 overflow-auto p-6">
        {!selectedRepoId ? (
          <EmptyState
            icon={
              <svg aria-hidden="true" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
              </svg>
            }
            title="Select a repo from the sidebar to start a task"
          />
        ) : planProposal && activeRunId ? (
          <PlanApprovalCard runId={activeRunId} planText={planProposal.planText} />
        ) : pendingEdits.some((e) => e.status === 'pending') && activeRunId ? (
          <FileEditApproval runId={activeRunId} edits={pendingEdits} />
        ) : testApprovalCommand && activeRunId ? (
          <TestApprovalCard
            command={testApprovalCommand}
            onApprove={handleApproveTestRun}
            onReject={handleRejectTestRun}
          />
        ) : runStatus === 'cancelled' ? (
          // Terminal cancelled state — checked before approval/PR states to prevent stale gates
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
            <p className="text-sm text-muted-foreground">Run cancelled</p>
          </div>
        ) : prApproval && activeRunId ? (
          // PR gate — only reachable when run is active (not cancelled/failed)
          <PRApprovalCard runId={activeRunId} prTitle={prApproval.prTitle} prBody={prApproval.prBody} />
        ) : prUrl != null && prNumber != null ? (
          // PR was opened — surface a minimal link; no approval card needed
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">Pull request opened</p>
            <a
              href={prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-medium text-blue-400 hover:underline"
            >
              PR #{prNumber}
            </a>
          </div>
        ) : inTestOutputState && activeRunId ? (
          <TestOutputPanel runs={testRuns} repairAttempt={repairAttempt} />
        ) : (
          <TaskComposer />
        )}
      </div>
      </ErrorBoundary>
    </main>
  )
}

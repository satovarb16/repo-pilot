'use client'

import { useEffect } from 'react'
import { useAppStore } from '@/lib/store'
import { TaskComposer } from '@/components/runs/TaskComposer'
import { PlanApprovalCard } from '@/components/runs/PlanApprovalCard'
import { FileEditApproval } from '@/components/runs/FileEditApproval'
import { TestApprovalCard } from '@/components/runs/TestApprovalCard'
import { TestOutputPanel } from '@/components/runs/TestOutputPanel'
import { approveTestRun, rejectTestRun, fetchTestResults } from '@/lib/api'

const TEST_OUTPUT_STATES = new Set(['running_tests', 'reviewing', 'repairing'])

export function MainPanel() {
  const selectedRepoId = useAppStore((s) => s.selectedRepoId)
  const activeRunId = useAppStore((s) => s.activeRunId)
  const planProposal = useAppStore((s) => s.planProposal)
  const pendingEdits = useAppStore((s) => s.pendingEdits)
  const testApprovalCommand = useAppStore((s) => s.testApprovalCommand)
  const testRuns = useAppStore((s) => s.testRuns)
  const repairAttempt = useAppStore((s) => s.repairAttempt)
  const clearTestApproval = useAppStore((s) => s.clearTestApproval)

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
      <div className="flex-1 overflow-auto p-6">
        {!selectedRepoId ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
            <p className="text-sm text-muted-foreground">
              Select a repo from the sidebar to start a task
            </p>
          </div>
        ) : planProposal && activeRunId ? (
          <PlanApprovalCard runId={activeRunId} planText={planProposal.planText} />
        ) : pendingEdits.length > 0 && activeRunId ? (
          <FileEditApproval runId={activeRunId} edits={pendingEdits} />
        ) : testApprovalCommand && activeRunId ? (
          <TestApprovalCard
            command={testApprovalCommand}
            onApprove={handleApproveTestRun}
            onReject={handleRejectTestRun}
          />
        ) : inTestOutputState && activeRunId ? (
          <TestOutputPanel runs={testRuns} repairAttempt={repairAttempt} />
        ) : (
          <TaskComposer />
        )}
      </div>
    </main>
  )
}

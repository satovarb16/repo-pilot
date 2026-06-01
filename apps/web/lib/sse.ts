import { useEffect } from 'react'
import { useAppStore } from './store'
import type { AgentSSEEvent } from './types'

export function useAgentStream(runId: string | null): void {
  const appendTraceEvent = useAppStore((s) => s.appendTraceEvent)
  const setRunStatus = useAppStore((s) => s.setRunStatus)
  const setPlanProposal = useAppStore((s) => s.setPlanProposal)
  const addPendingEdit = useAppStore((s) => s.addPendingEdit)
  const appendTestRun = useAppStore((s) => s.appendTestRun)
  const updateTestRun = useAppStore((s) => s.updateTestRun)
  const setRepairAttempt = useAppStore((s) => s.setRepairAttempt)
  const setTestApproval = useAppStore((s) => s.setTestApproval)
  // Phase 4: PR event handlers
  const setPRApproval = useAppStore((s) => s.setPRApproval)
  const setPROpened = useAppStore((s) => s.setPROpened)
  const clearPRApproval = useAppStore((s) => s.clearPRApproval)
  // Phase 5: token usage + connection error handlers
  const setTokenUsage = useAppStore((s) => s.setTokenUsage)
  const setConnectionError = useAppStore((s) => s.setConnectionError)

  useEffect(() => {
    if (!runId) return

    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'
    const es = new EventSource(`${apiBase}/api/v1/agent/runs/${runId}/stream`)

    es.onmessage = (e: MessageEvent) => {
      const event = JSON.parse(e.data as string) as AgentSSEEvent
      appendTraceEvent(event)

      if (event.type === 'approval_required' && event.approvalType === 'plan') {
        setPlanProposal({ planText: event.planText })
      } else if (event.type === 'approval_required' && event.approvalType === 'test_run') {
        setTestApproval(event.command)
      } else if (event.type === 'approval_required' && event.approvalType === 'pr') {
        // Gate reached — show PR approval card
        setPRApproval({ prTitle: event.prTitle, prBody: event.prBody })
      } else if (event.type === 'pr_opened') {
        // PR created — surface the link and clear the approval card
        setPROpened({ prUrl: event.prUrl, prNumber: event.prNumber })
      } else if (event.type === 'run_cancelled') {
        // Run rejected — clear PR approval card, set terminal state, close stream
        clearPRApproval()
        setRunStatus('cancelled')
        es.close()
      } else if (event.type === 'edit_proposed') {
        console.log('[sse] edit_proposed', { origLen: event.originalContent?.length, propLen: event.proposedContent?.length })
        addPendingEdit({ changeId: event.changeId, filePath: event.filePath, diff: event.diff, originalContent: event.originalContent, proposedContent: event.proposedContent })
      } else if (event.type === 'test_run_started') {
        // Push a sentinel row — the real DB id arrives only on test_run_completed.
        // updateTestRun will match this row by status === 'running' and replace the id.
        appendTestRun({
          id: 'running',
          command: event.command,
          status: 'running',
          exitCode: null,
          stdout: '',
          stderr: '',
          durationMs: null,
          sandboxed: true,
        })
      } else if (event.type === 'test_run_completed') {
        updateTestRun(event.testRunId, {
          id: event.testRunId,
          status: event.status as 'passed' | 'failed',
          exitCode: event.exitCode,
          stdout: event.stdout,
          stderr: event.stderr,
          durationMs: event.durationMs,
          sandboxed: event.sandboxed,
        })
      } else if (event.type === 'repair_started') {
        setRepairAttempt(event.attempt)
      } else if (event.type === 'token_usage') {
        // Cumulative token totals from the latest Claude turn
        setTokenUsage({ inputTokens: event.inputTokens, outputTokens: event.outputTokens })
      } else if (event.type === 'run_completed') {
        setRunStatus('completed')
        es.close()
      } else if (event.type === 'run_failed') {
        setRunStatus('failed')
        es.close()
      }
    }

    es.onerror = () => {
      const currentStatus = useAppStore.getState().runStatus
      // Only act on errors while the run is active — a normal terminal close
      // (run_completed, run_failed, run_cancelled) already updated runStatus
      // via onmessage and called es.close(), so onerror arriving after that
      // must not overwrite the final status or show a spurious disconnect banner.
      if (currentStatus === 'running') {
        setConnectionError(true)
        // Clear all pending approval gates — the run is dead
        clearPRApproval()
        useAppStore.getState().clearPlanProposal()
        useAppStore.getState().clearTestApproval()
        setRunStatus('failed')
      }
      es.close()
    }

    return () => {
      es.close()
    }
  }, [runId, appendTraceEvent, setRunStatus, setPlanProposal, addPendingEdit, appendTestRun, updateTestRun, setRepairAttempt, setTestApproval, setPRApproval, setPROpened, clearPRApproval, setTokenUsage, setConnectionError])
}

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
      } else if (event.type === 'run_completed') {
        setRunStatus('completed')
        es.close()
      } else if (event.type === 'run_failed') {
        setRunStatus('failed')
        es.close()
      }
    }

    es.onerror = () => {
      setRunStatus('failed')
      es.close()
    }

    return () => {
      es.close()
    }
  }, [runId, appendTraceEvent, setRunStatus, setPlanProposal, addPendingEdit, appendTestRun, updateTestRun, setRepairAttempt, setTestApproval])
}

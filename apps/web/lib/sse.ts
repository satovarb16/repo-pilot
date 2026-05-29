import { useEffect } from 'react'
import { useAppStore } from './store'
import type { AgentSSEEvent } from './types'

export function useAgentStream(runId: string | null): void {
  const appendTraceEvent = useAppStore((s) => s.appendTraceEvent)
  const setRunStatus = useAppStore((s) => s.setRunStatus)
  const setPlanProposal = useAppStore((s) => s.setPlanProposal)
  const addPendingEdit = useAppStore((s) => s.addPendingEdit)

  useEffect(() => {
    if (!runId) return

    const es = new EventSource(`/api/v1/agent/runs/${runId}/stream`)

    es.onmessage = (e: MessageEvent) => {
      const event = JSON.parse(e.data as string) as AgentSSEEvent
      appendTraceEvent(event)

      if (event.type === 'approval_required' && event.approvalType === 'plan') {
        setPlanProposal({ planText: event.planText })
      } else if (event.type === 'edit_proposed') {
        addPendingEdit({ changeId: event.changeId, filePath: event.filePath, diff: event.diff })
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
  }, [runId, appendTraceEvent, setRunStatus, setPlanProposal, addPendingEdit])
}

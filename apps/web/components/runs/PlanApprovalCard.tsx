'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { approvePlan, rejectPlan } from '@/lib/api'

interface PlanApprovalCardProps {
  runId: string
  planText: string
}

export function PlanApprovalCard({ runId, planText }: PlanApprovalCardProps) {
  const [loading, setLoading] = useState(false)

  async function handleApprove() {
    setLoading(true)
    await approvePlan(runId).catch(() => {})
    setLoading(false)
  }

  async function handleReject() {
    setLoading(true)
    await rejectPlan(runId).catch(() => {})
    setLoading(false)
  }

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="text-sm font-medium text-amber-400">⚡ Plan ready for review</div>
      <div className="bg-muted rounded-md p-4 flex-1 overflow-auto">
        <pre className="text-sm text-foreground whitespace-pre-wrap">{planText}</pre>
      </div>
      <div className="flex gap-3">
        <Button
          className="flex-1"
          onClick={handleApprove}
          disabled={loading}
          data-testid="approve-button"
        >
          {loading ? 'Processing…' : 'Approve Plan'}
        </Button>
        <Button
          variant="destructive"
          className="flex-1"
          onClick={handleReject}
          disabled={loading}
          data-testid="reject-button"
        >
          Reject
        </Button>
      </div>
    </div>
  )
}

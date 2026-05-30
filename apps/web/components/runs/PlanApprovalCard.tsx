'use client'

import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { Button } from '@/components/ui/button'
import { approvePlan, rejectPlan } from '@/lib/api'
import { useAppStore } from '@/lib/store'

interface PlanApprovalCardProps {
  runId: string
  planText: string
}

export function PlanApprovalCard({ runId, planText }: PlanApprovalCardProps) {
  const [loading, setLoading] = useState(false)
  const clearPlanProposal = useAppStore((s) => s.clearPlanProposal)

  async function handleApprove() {
    setLoading(true)
    await approvePlan(runId).catch(() => {})
    clearPlanProposal()
    setLoading(false)
  }

  async function handleReject() {
    setLoading(true)
    await rejectPlan(runId).catch(() => {})
    clearPlanProposal()
    setLoading(false)
  }

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="text-sm font-medium text-amber-400">⚡ Plan ready for review</div>
      <div className="bg-muted rounded-md p-4 flex-1 overflow-auto">
        <div className="prose prose-sm prose-invert max-w-none">
          <ReactMarkdown>{planText}</ReactMarkdown>
        </div>
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

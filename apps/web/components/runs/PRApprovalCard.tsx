'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { approvePR, rejectPR } from '@/lib/api'

interface PRApprovalCardProps {
  runId: string
  prTitle: string
  prBody: string
  onApprove?: () => void
  onReject?: () => void
}

// Mirrors the pattern of TestApprovalCard and PlanApprovalCard.
// Both buttons are disabled while any API call is in-flight to prevent double-clicks.
export function PRApprovalCard({ runId, prTitle, prBody, onApprove, onReject }: PRApprovalCardProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleApprove() {
    setLoading(true)
    setError(null)
    try {
      await approvePR(runId)
      onApprove?.()
    } catch {
      setError('Failed to approve — please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handleReject() {
    setLoading(true)
    setError(null)
    try {
      await rejectPR(runId)
      onReject?.()
    } catch {
      setError('Failed to reject — please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="text-sm font-medium text-amber-400">Pull request ready to open</div>

      {/* PR title and body preview — neutral muted card to keep it minimal */}
      <div className="bg-muted rounded-md p-4 flex flex-col gap-2">
        <p className="text-xs text-muted-foreground">PR title</p>
        <p className="text-sm font-semibold text-foreground">{prTitle}</p>
        <p className="text-xs text-muted-foreground mt-2">PR body</p>
        <pre className="text-xs font-mono text-foreground whitespace-pre-wrap">{prBody}</pre>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {/* Action buttons — same layout as existing approval cards */}
      <div className="flex gap-3">
        <Button
          className="flex-1"
          onClick={handleApprove}
          disabled={loading}
          data-testid="approve-pr-button"
        >
          Approve &amp; Open PR
        </Button>
        <Button
          variant="destructive"
          className="flex-1"
          onClick={handleReject}
          disabled={loading}
          data-testid="reject-pr-button"
        >
          Reject
        </Button>
      </div>
    </div>
  )
}

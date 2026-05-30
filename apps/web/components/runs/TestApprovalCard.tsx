'use client'

import { Button } from '@/components/ui/button'

interface TestApprovalCardProps {
  command: string
  onApprove: () => void
  onReject: () => void
  disabled?: boolean
}

export function TestApprovalCard({ command, onApprove, onReject, disabled }: TestApprovalCardProps) {
  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="text-sm font-medium text-amber-400">Tests ready to run</div>
      <div className="bg-muted rounded-md p-4">
        <p className="text-xs text-muted-foreground mb-2">Command to execute</p>
        <code className="text-sm font-mono text-foreground">{command}</code>
      </div>
      <div className="flex gap-3">
        <Button
          className="flex-1"
          onClick={onApprove}
          disabled={disabled}
          data-testid="approve-test-button"
        >
          Approve &amp; Run Tests
        </Button>
        <Button
          variant="destructive"
          className="flex-1"
          onClick={onReject}
          disabled={disabled}
          data-testid="reject-test-button"
        >
          Reject
        </Button>
      </div>
    </div>
  )
}

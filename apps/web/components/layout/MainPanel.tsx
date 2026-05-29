'use client'

import { useAppStore } from '@/lib/store'
import { TaskComposer } from '@/components/runs/TaskComposer'
import { PlanApprovalCard } from '@/components/runs/PlanApprovalCard'
import { FileEditApproval } from '@/components/runs/FileEditApproval'

export function MainPanel() {
  const selectedRepoId = useAppStore((s) => s.selectedRepoId)
  const activeRunId = useAppStore((s) => s.activeRunId)
  const planProposal = useAppStore((s) => s.planProposal)
  const pendingEdits = useAppStore((s) => s.pendingEdits)

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
        ) : (
          <TaskComposer />
        )}
      </div>
    </main>
  )
}

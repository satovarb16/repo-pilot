'use client'

import { useAppStore } from '@/lib/store'
import { TaskComposer } from '@/components/runs/TaskComposer'

export function MainPanel() {
  const selectedRepoId = useAppStore((s) => s.selectedRepoId)

  return (
    <main className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-auto p-6">
        {selectedRepoId ? (
          <TaskComposer />
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
            <p className="text-sm text-muted-foreground">
              Select a repo from the sidebar to start a task
            </p>
          </div>
        )}
      </div>
    </main>
  )
}

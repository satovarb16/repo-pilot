'use client'

import { useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { DiffViewer } from './DiffViewer'
import { resolveEdit } from '@/lib/api'
import { useAppStore } from '@/lib/store'
import type { FileChange } from '@/lib/types'

interface FileEditApprovalProps {
  runId: string
  edits: FileChange[]
}

export function FileEditApproval({ runId, edits }: FileEditApprovalProps) {
  const resolveEditStore = useAppStore((s) => s.resolveEdit)
  const firstPending = edits.find((e) => e.status === 'pending')
  const [activeTab, setActiveTab] = useState(firstPending?.changeId ?? edits[0]?.changeId ?? '')
  const [loading, setLoading] = useState(false)

  async function handleAction(action: 'approve' | 'reject') {
    setLoading(true)
    await resolveEdit(runId, activeTab, action).catch(() => {})
    resolveEditStore(activeTab, action === 'approve' ? 'approved' : 'rejected')

    // Advance to next pending tab (edits prop is not mutated — status update lives in the store)
    const nextPending = edits.find((e) => e.changeId !== activeTab && e.status === 'pending')
    if (nextPending) {
      setActiveTab(nextPending.changeId)
    }
    setLoading(false)
  }

  const activeEdit = edits.find((e) => e.changeId === activeTab)

  return (
    <div className="flex flex-col h-full gap-3">
      <div className="text-sm font-medium text-blue-400">File edits proposed — review and approve</div>
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col flex-1 overflow-hidden">
        <TabsList className="shrink-0 justify-start overflow-x-auto">
          {edits.map((edit) => (
            <TabsTrigger key={edit.changeId} value={edit.changeId} className="gap-1.5">
              {edit.filePath.split('/').pop()}
              {edit.status === 'approved' && <span className="text-green-400 text-xs">&#10003;</span>}
              {edit.status === 'rejected' && <span className="text-red-400 text-xs">&#10007;</span>}
            </TabsTrigger>
          ))}
        </TabsList>

        {edits.map((edit) => (
          <TabsContent key={edit.changeId} value={edit.changeId} className="flex-1 overflow-auto mt-2">
            <DiffViewer
              oldContent={edit.diff
                .split('\n')
                .filter((l) => l.startsWith('-') && !l.startsWith('---'))
                .map((l) => l.slice(1))
                .join('\n')}
              newContent={edit.diff
                .split('\n')
                .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
                .map((l) => l.slice(1))
                .join('\n')}
              filename={edit.filePath}
            />
          </TabsContent>
        ))}
      </Tabs>

      {activeEdit?.status === 'pending' && (
        <div className="flex gap-3 shrink-0 border-t pt-3">
          <Button className="flex-1" onClick={() => handleAction('approve')} disabled={loading}>
            Approve
          </Button>
          <Button variant="destructive" className="flex-1" onClick={() => handleAction('reject')} disabled={loading}>
            Reject
          </Button>
        </div>
      )}
    </div>
  )
}

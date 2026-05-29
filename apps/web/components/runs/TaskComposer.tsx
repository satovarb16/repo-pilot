'use client'

import { useState } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/lib/store'
import { startRun, ApiError } from '@/lib/api'

export function TaskComposer() {
  const selectedRepoId = useAppStore((s) => s.selectedRepoId)
  const repos = useAppStore((s) => s.repos)
  const runStatus = useAppStore((s) => s.runStatus)
  const setActiveRun = useAppStore((s) => s.setActiveRun)

  const selectedRepo = repos.find((r) => r.id === selectedRepoId)

  const [task, setTask] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isRunning = runStatus === 'running'

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedRepoId || task.trim().length < 10) return
    setError(null)
    setLoading(true)
    try {
      const { runId } = await startRun(selectedRepoId, task.trim())
      setActiveRun(runId)
      setTask('')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to start run')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-3">
      {selectedRepo && (
        <p className="text-xs text-muted-foreground font-mono">
          {selectedRepo.owner}/{selectedRepo.name}
        </p>
      )}
      <form onSubmit={handleSubmit} className="space-y-2">
        <Textarea
          placeholder="Describe the task in plain English. The agent will inspect the repo first."
          value={task}
          onChange={(e) => setTask(e.target.value)}
          rows={4}
          disabled={isRunning}
          className="resize-none"
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button
          type="submit"
          className="w-full"
          disabled={isRunning || loading || task.trim().length < 10}
        >
          {loading ? 'Starting...' : isRunning ? 'Run in progress...' : 'Start Run →'}
        </Button>
      </form>
    </div>
  )
}

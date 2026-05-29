'use client'

import { useEffect } from 'react'
import { useAppStore } from '@/lib/store'
import { listRepos } from '@/lib/api'
import { RepoListItem } from '@/components/repos/RepoListItem'
import { ConnectRepoDialog } from '@/components/repos/ConnectRepoDialog'
import { Separator } from '@/components/ui/separator'

export function Sidebar() {
  const repos = useAppStore((s) => s.repos)
  const setRepos = useAppStore((s) => s.setRepos)

  useEffect(() => {
    listRepos().then(setRepos).catch(() => {})
  }, [setRepos])

  return (
    <aside className="w-64 border-r border-border flex flex-col shrink-0">
      <div className="p-4 border-b border-border">
        <h1 className="text-sm font-semibold tracking-tight">RepoPilot</h1>
      </div>
      <div className="flex-1 overflow-auto p-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-1 mb-2">
          Repos
        </p>
        {repos.length === 0 ? (
          <p className="text-xs text-muted-foreground px-1 mb-2">No repos connected</p>
        ) : (
          <div className="space-y-0.5 mb-2">
            {repos.map((repo) => (
              <RepoListItem key={repo.id} repo={repo} />
            ))}
          </div>
        )}
        <ConnectRepoDialog />
        <Separator className="my-4" />
      </div>
    </aside>
  )
}

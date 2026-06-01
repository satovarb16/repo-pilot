'use client'

import { useEffect } from 'react'
import { useAppStore } from '@/lib/store'
import { listRepos } from '@/lib/api'
import { RepoListItem } from '@/components/repos/RepoListItem'
import { ConnectRepoDialog } from '@/components/repos/ConnectRepoDialog'
import { Separator } from '@/components/ui/separator'
import { EmptyState } from '@/components/EmptyState'

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
          <EmptyState
            icon={
              <svg aria-hidden="true" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
              </svg>
            }
            title="No repos connected"
            hint="Connect a repo to get started"
          />
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
